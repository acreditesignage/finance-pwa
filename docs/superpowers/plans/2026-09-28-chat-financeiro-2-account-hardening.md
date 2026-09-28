# Chat Financeiro 2.0 Account Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the account-security requirements around the Chat Financeiro 2.0 rollout: rate limiting, password reset architecture, and minimal onboarding without delaying the primary chat release.

**Architecture:** Extend the persistent account model created by the main Chat Financeiro 2.0 plan. Keep security state in PostgreSQL, hash all reset/invite secrets before persistence, derive identity only from the authenticated session, and make onboarding optional/short so registration stays fast.

**Tech Stack:** Node.js 20+, `node:test`, PostgreSQL 16, `pg`, Node `crypto`, existing Finance PWA HTTP server.

**Spec:** `docs/superpowers/specs/2026-09-28-chat-financeiro-2-design.md`

## Global Constraints

- Passwords and reset tokens are never stored or logged in plaintext.
- Reset tokens are single-use, expiring, and user-scoped.
- Login and registration are rate-limited server-side.
- The onboarding flow asks only the primary intent and never blocks later profile editing.
- All responses avoid account-enumeration leaks where practical.
- Existing Thiago/Rebeca compatibility login remains available until their persistent credentials are confirmed.

## Review Focus

1. Replayed password-reset token must fail after first successful use.
2. Expired token must fail without changing the password.
3. Reset request for an unknown email must return the same public response shape as a known email.
4. Rate limiting must key on both IP/request source and normalized account identifier where available, so one dimension alone does not trivially bypass it.
5. Onboarding intent must remain isolated by authenticated user and cannot be set for another user through request body IDs.

---

### Task 1: Password Reset Tokens and Service

**Files:**
- Modify: `lib/store.js`
- Modify: `lib/accounts.js`
- Test: `test/password-reset.test.js`

**Interfaces:**
- Produces store methods: `createPasswordResetToken(userId,tokenHash,expiresAt)`, `consumePasswordResetToken(tokenHash,now)`, `invalidatePasswordResetTokens(userId)`.
- Produces service: `requestPasswordReset({store,email,now,tokenFactory}) -> {deliveryToken?:string,user?:object}` for server-side delivery integration only.
- Produces service: `confirmPasswordReset({store,token,newPassword,now}) -> Promise<boolean>`.

- [ ] **Step 1: Write failing token lifecycle tests**

Assert stored token value is a hash, expiry is enforced, successful consume is single-use, replay fails, and invalid/expired token leaves password unchanged.

- [ ] **Step 2: Add `password_reset_tokens` schema**

Fields: UUID id, UUID user owner, SHA-256 token hash unique, expiry, consumed timestamp nullable, created timestamp. Index active tokens by owner/expiry.

- [ ] **Step 3: Implement reset services**

Generate at least 32 random bytes for plaintext delivery token; persist only the hash. Password replacement uses Task 1 `hashPassword` from the main plan and invalidates all remaining reset tokens for that user after success.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/password-reset.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/store.js lib/accounts.js test/password-reset.test.js
git commit -m "feat: add secure password reset tokens"
```

---

### Task 2: Reset APIs and Enumeration-Safe Responses

**Files:**
- Modify: `lib/app.js`
- Test: `test/auth-api.test.js`

**Interfaces:**
- Produces: `POST /api/password-reset/request` body `{email}`.
- Produces: `POST /api/password-reset/confirm` body `{token,password,passwordConfirmation}`.
- Delivery is injected through a server dependency `sendPasswordReset({user,token})`; when no email provider is configured in beta, the request endpoint still uses the same public response and does not expose the token.

- [ ] **Step 1: Write failing API tests**

Known and unknown email reset requests return the same 202 response shape; token never appears in response/log fixture; valid confirmation changes password; invalid/expired/replayed token returns generic invalid-token error.

- [ ] **Step 2: Implement reset request endpoint**

Normalize email, invoke reset service only when account exists, call injected delivery when configured, and always return `{ok:true}` with status 202.

- [ ] **Step 3: Implement reset confirm endpoint**

Require matching password confirmation and minimum password rules; consume token transactionally with password update.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/auth-api.test.js test/password-reset.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/app.js test/auth-api.test.js test/password-reset.test.js
git commit -m "feat: add password reset endpoints"
```

---

### Task 3: Login and Registration Rate Limiting

**Files:**
- Create: `lib/rate-limit.js`
- Modify: `lib/app.js`
- Test: `test/auth-api.test.js`

**Interfaces:**
- Produces: `createRateLimiter({windowMs,maxAttempts,now})` with `check(key) -> {allowed,retryAfterSeconds}` and `reset(key)`.
- Initial limits: login 8 failed attempts per 15 minutes per combined normalized-email/IP key; registration 5 attempts per 30 minutes per IP; reset request 5 per 30 minutes per normalized-email/IP key.

- [ ] **Step 1: Write failing rate-limit tests**

Assert successful login resets the failure bucket; ninth failed login inside the window is 429; a window expiry permits attempts again; registration and reset request have their own buckets.

- [ ] **Step 2: Implement bounded in-process limiter**

Use a capped Map with periodic stale-entry cleanup for the first release; keep the interface swappable for Redis/PostgreSQL if multi-replica scaling later requires shared state. Railway currently runs one app replica.

- [ ] **Step 3: Wire auth endpoints**

Return 429 with `Retry-After`; never include password, token, or invite data in limiter keys/logs beyond normalized email hash and request IP string.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/auth-api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rate-limit.js lib/app.js test/auth-api.test.js
git commit -m "feat: rate limit account endpoints"
```

---

### Task 4: Minimal Onboarding Intent

**Files:**
- Modify: `lib/store.js`
- Modify: `lib/app.js`
- Modify: `index.html`
- Test: `test/profile-goals-api.test.js`
- Test: `test/ui.test.js`

**Interfaces:**
- Adds profile field `primary_intent` enum: `spending`, `budgeting`, `investing`, `reserve`, `goal`, `all`.
- Produces: `POST /api/onboarding` body `{primaryIntent}` for authenticated user only.

- [ ] **Step 1: Write failing isolation/validation tests**

Invalid values rejected; body `userId` ignored; one user's onboarding cannot change another user's profile.

- [ ] **Step 2: Add onboarding field/store method**

Store through the same per-user financial profile row used by the main plan.

- [ ] **Step 3: Add one-screen post-registration onboarding**

Show six primary-intent choices and a `Pular por enquanto` action. Do not introduce a long questionnaire.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/profile-goals-api.test.js test/ui.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/store.js lib/app.js index.html test/profile-goals-api.test.js test/ui.test.js
git commit -m "feat: add lightweight finance onboarding"
```

---

### Task 5: Integration Gate

**Files:**
- No new production files unless integration tests expose a defect.

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: PASS with account, reset, rate-limit, onboarding, Open Finance, chat, and existing finance tests.

- [ ] **Step 2: Verify no secret leakage**

Search branch diff for plaintext beta invite, reset token fixtures outside tests, API key strings, PIN values, and password values.

- [ ] **Step 3: Fold this plan into the same Chat Financeiro 2.0 PR**

The account-hardening tasks ship in the same tested exact-SHA rollout unless they reveal an external email-delivery dependency; in that case the secure reset backend still ships and the UI marks email recovery as unavailable until delivery is configured rather than exposing tokens.
