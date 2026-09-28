# Chat Financeiro 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an invite-only multi-user Finance PWA with natural-language financial chat, deterministic finance tools, contextual follow-ups, goals/profile support, investment simulations, current-rate lookups, and safe proactive insights while preserving existing Thiago/Rebeca data and Open Finance ownership.

**Architecture:** Keep PostgreSQL and deterministic finance code as the source of truth. Add persistent user accounts and a server-side LLM orchestrator that can call only whitelisted finance tools; the authenticated session injects ownership into every tool call. Preserve the current rule parser as a fast path/fallback and roll the new chat behind a feature flag until migration, isolation, and Open Finance regression tests pass.

**Tech Stack:** Node.js 20+, native `fetch`, `node:test`, PostgreSQL 16, `pg`, Node `crypto.scrypt` for password hashing, OpenAI Responses API via HTTPS, Pluggy Open Finance, Railway.

**Spec:** `docs/superpowers/specs/2026-09-28-chat-financeiro-2-design.md`

## Global Constraints

- Money remains integer cents at application boundaries.
- Financial period logic uses `America/Sao_Paulo`.
- The model never receives unrestricted SQL access.
- The model never supplies a trusted `userId`; ownership always comes from the authenticated server session.
- Existing Thiago/Rebeca transactions, chats, bank connections, bank accounts, sync history, and reconciliation links must remain attached to the correct owner.
- Open Finance must continue to work and remain per-user scoped.
- Passwords, invite codes, reset tokens, API secrets, and bank credentials are never stored or logged in plaintext.
- Session cookies remain `HttpOnly; Secure; SameSite=Lax`.
- Simple supported expense/income entry must still work when the LLM provider is unavailable.
- Current market/reference values must carry a reference date; if fresh data is unavailable, the assistant must label any rate as hypothetical.
- No autonomous payment initiation or bank-write capability is added.
- Deploy only the exact tested merged commit to the existing Railway service `finance-pwa-app`.

## Review Focus

1. **Legacy owner migration:** an interrupted/repeated startup migration must not duplicate users or orphan Thiago/Rebeca financial/Open Finance records; Task 2 pins idempotency and rollback behavior.
2. **Cross-user tool injection:** model/browser attempts to pass another user identifier must be ignored and the session owner enforced; Tasks 3 and 5 pin this.
3. **Ambiguous writes:** free-form phrases that could be discussion rather than a transaction must not silently write money records; Task 5 pins confirmation/fallback behavior.
4. **Stale/current rates:** market-data failure must never be presented as a current CDI/Selic/IPCA value; Task 7 pins reference dates and hypothetical fallback.
5. **LLM outage or malformed tool call:** ordinary transaction entry and summary commands must remain usable, and invalid tool JSON must not crash the request; Task 5 pins degraded-mode behavior.

---

## File Structure

New focused modules:

- `lib/password.js` — email normalization, password hashing/verification, secret hashing.
- `lib/accounts.js` — account/invite registration service and legacy-account claiming helpers.
- `lib/finance-periods.js` — period resolution in `America/Sao_Paulo`.
- `lib/finance-tools.js` — whitelisted deterministic tool implementations and strict argument validation.
- `lib/investments.js` — deterministic savings/investment projection math.
- `lib/openai-client.js` — Responses API HTTP wrapper; no business logic.
- `lib/chat-orchestrator.js` — model/tool loop, context assembly, fallback to `processMessage`.
- `lib/market-data.js` — approved public current-rate fetches with reference dates and stale/error handling.
- `lib/opportunities.js` — deterministic opportunity scoring for Radar/proactive chat.

Existing modules modified:

- `lib/store.js` — schema, migration, accounts, profile/goals/context/opportunity persistence.
- `lib/app.js` — new account/profile/goals routes and orchestrated `/api/chat`.
- `lib/finance.js` — retain parser fallback; export reusable deterministic helpers where needed.
- `server.js` — initialize account migration, OpenAI client, feature flags, and new handler dependencies.
- `index.html` — email/password login, invite registration, profile/goals UI, existing chat/Open Finance preserved.
- `.github/workflows/test.yml` — keep PostgreSQL-backed CI and add any required env defaults for new tests.

Tests created/expanded:

- `test/accounts.test.js`
- `test/auth-api.test.js`
- `test/legacy-migration.test.js`
- `test/finance-periods.test.js`
- `test/finance-tools.test.js`
- `test/investments.test.js`
- `test/chat-orchestrator.test.js`
- `test/profile-goals-api.test.js`
- `test/market-data.test.js`
- `test/opportunities.test.js`
- `test/ui.test.js`
- existing Open Finance/store tests remain mandatory regression coverage.

---

### Task 1: Secure Account and Invite Primitives

**Files:**
- Create: `lib/password.js`
- Create: `lib/accounts.js`
- Modify: `lib/store.js`
- Test: `test/accounts.test.js`

**Interfaces:**
- Produces: `normalizeEmail(email) -> string`
- Produces: `hashPassword(password) -> Promise<string>`
- Produces: `verifyPassword(password, encodedHash) -> Promise<boolean>`
- Produces: `hashSecret(secret) -> string`
- Produces store methods: `createUser(data)`, `getUserByEmail(email)`, `getUserById(id)`, `createInvite(data)`, `consumeInvite(codeHash, now)`, `createLegacyUser(data)`.
- Produces service: `registerAccount({store,name,email,password,inviteCode,now}) -> Promise<{user}>`.

- [ ] **Step 1: Write failing account primitive tests**

Add tests asserting: email normalization lowercases/trims; password hash never equals plaintext; correct password verifies; wrong password fails; same password hashes differently because of salt; invite secret hashing is deterministic and one-way at storage boundary.

- [ ] **Step 2: Run account primitive tests and verify failure**

Run: `npm test -- --test-name-pattern="password|invite|normalize email"`
Expected: FAIL because account/password helpers and schema methods do not exist.

- [ ] **Step 3: Implement `lib/password.js`**

Use Node `crypto.scrypt` with a random 16-byte salt and a versioned encoded format containing algorithm parameters, salt, and derived key. Use timing-safe comparison after decoding. `hashSecret` uses SHA-256 for high-entropy invite/reset tokens; never use it for passwords.

- [ ] **Step 4: Add account/invite schema and store methods**

Create `users` with UUID primary key, nullable unique `legacy_key`, unique normalized `email`, `password_hash`, `status`, timestamps. Create `invite_codes` with hashed code, usage limits, expiry, active flag. Add indexes on normalized email/status and invite hash.

- [ ] **Step 5: Implement `registerAccount`**

Validate non-empty name, normalized email, password minimum length 10, active/unexpired invite with remaining uses, then create user and consume invite in one database transaction exposed by a store-level `registerUserWithInvite(...)` method so invite overuse cannot race.

- [ ] **Step 6: Add race/expiry/duplicate tests**

Assert duplicate normalized email fails; expired invite fails; inactive invite fails; exhausted invite fails; concurrent/simulated repeated consumption cannot exceed `max_uses`.

- [ ] **Step 7: Run account tests**

Run: `npm test -- test/accounts.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/password.js lib/accounts.js lib/store.js test/accounts.test.js
git commit -m "feat: add secure user accounts and beta invites"
```

---

### Task 2: Legacy Users, UUID Ownership Compatibility, and Session Auth

**Files:**
- Modify: `lib/store.js`
- Modify: `lib/app.js`
- Modify: `server.js`
- Test: `test/legacy-migration.test.js`
- Test: `test/auth-api.test.js`
- Test: existing `test/open-finance-api.test.js`, `test/store-open-finance.test.js`

**Interfaces:**
- Consumes Task 1 account/password functions.
- Produces: `store.ensureLegacyUsers([{legacyKey,name}]) -> Promise<Map<string,string>>` mapping legacy key to UUID.
- Produces: `store.resolveOwnerId(sessionSubject) -> Promise<string|null>`.
- Produces email/password `POST /api/login` while retaining temporary legacy PIN compatibility for `thiago`/`rebeca` until they claim credentials.
- Session signing continues through `sign(subject)` but the primary subject becomes database user UUID.

- [ ] **Step 1: Write failing legacy migration tests**

Create PostgreSQL tests with representative legacy rows in `transactions`, `chat_messages`, `bank_connections`, `bank_accounts`, and `bank_sync_runs`. Assert repeated `ensureLegacyUsers()` returns the same UUIDs and every legacy-owned record resolves to the same owner after migration/compatibility backfill.

- [ ] **Step 2: Add owner compatibility columns and migration**

Add nullable `owner_id UUID` to every user-owned table, indexed. Backfill from `users.legacy_key` for legacy rows. Add foreign keys to `users(id)` where safe without removing existing `user_id` columns yet. New writes set both the UUID owner column and compatibility `user_id` text during this rollout.

- [ ] **Step 3: Update store methods to prefer UUID owner**

All user-owned queries accept a resolved UUID and filter `owner_id`. Keep compatibility lookup only inside store migration/legacy resolution code; business functions no longer decide owner keys.

- [ ] **Step 4: Write failing email/password auth API tests**

Assert `/api/login` with normalized email/password returns session; bad password is 401; `/api/me` returns the database UUID/name; browser-supplied user IDs do not affect ownership; temporary legacy PIN login still maps to the correct UUID owner.

- [ ] **Step 5: Implement session UUID auth and temporary legacy compatibility**

`sessionUser()` validates signed cookie then resolves a database user. Primary login body is `{email,password}`. Legacy body remains accepted only for the two configured PIN users and immediately signs the corresponding UUID subject after `legacy_key` resolution.

- [ ] **Step 6: Pin migration rollback behavior**

Add a test that forces a migration error mid-transaction and verifies original legacy rows remain readable with no partial owner reassignment.

- [ ] **Step 7: Run auth, migration, and Open Finance regression tests**

Run: `npm test -- test/legacy-migration.test.js test/auth-api.test.js test/open-finance-api.test.js test/store-open-finance.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/store.js lib/app.js server.js test/legacy-migration.test.js test/auth-api.test.js test/open-finance-api.test.js test/store-open-finance.test.js
git commit -m "feat: migrate sessions to persistent user ownership"
```

---

### Task 3: Invite Registration and Login UI

**Files:**
- Modify: `lib/app.js`
- Modify: `index.html`
- Modify: `server.js`
- Test: `test/auth-api.test.js`
- Test: `test/ui.test.js`

**Interfaces:**
- Consumes `registerAccount(...)` and UUID session auth.
- Produces: `POST /api/register` with `{name,email,password,passwordConfirmation,inviteCode}`.
- Produces beta bootstrap from `BETA_INVITE_CODE` into a hashed DB invite on startup with configurable `BETA_INVITE_MAX_USES` default `20`.

- [ ] **Step 1: Write failing registration endpoint tests**

Assert invalid/missing invite is rejected; mismatched confirmation rejected; successful registration immediately creates authenticated session; API response never returns password hash/invite hash.

- [ ] **Step 2: Implement beta invite bootstrap**

On startup, if `BETA_INVITE_CODE` is configured, hash it and idempotently ensure one active invite row exists. Do not log the plaintext code.

- [ ] **Step 3: Implement `/api/register`**

Call `registerAccount`, sign the new UUID user, and return only `{user:{id,name,email}}`.

- [ ] **Step 4: Write failing UI tests**

Assert login screen contains email/password, `Criar conta`, and beta registration fields including invite code; legacy quick-login controls remain available only in a compatibility section while migration is active.

- [ ] **Step 5: Implement login/register UI**

Default to email/password form. Add compact registration panel. Preserve app shell/navigation and Open Finance UI. Do not expose invite/bootstrap secrets in HTML.

- [ ] **Step 6: Run API/UI tests**

Run: `npm test -- test/auth-api.test.js test/ui.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/app.js index.html server.js test/auth-api.test.js test/ui.test.js
git commit -m "feat: add invite-only user registration"
```

---

### Task 4: Deterministic Finance Periods, Tools, and Investment Math

**Files:**
- Create: `lib/finance-periods.js`
- Create: `lib/finance-tools.js`
- Create: `lib/investments.js`
- Modify: `lib/finance.js`
- Test: `test/finance-periods.test.js`
- Test: `test/finance-tools.test.js`
- Test: `test/investments.test.js`

**Interfaces:**
- Produces: `resolvePeriod(input, now) -> {start,end,label}` using `America/Sao_Paulo`.
- Produces: `simulateInvestment({initialCents,monthlyCents,months,annualRatePct,taxRatePct?}) -> {contributionsCents,earningsCents,endingCents,annualRatePct,months,taxRatePct}`.
- Produces: `createFinanceTools({store,marketData?,now}) -> {definitions,execute(name,args,context)}`.
- `context.userId` is injected by server orchestration and cannot be overridden by `args`.

- [ ] **Step 1: Write failing period tests**

Cover today, this week, last week, current month, previous month, last 30 days, and a UTC month-boundary instant that is still prior day/month in `America/Sao_Paulo`.

- [ ] **Step 2: Implement `resolvePeriod`**

Return ISO instants for inclusive start/exclusive end. Reject unsupported unbounded natural-language periods rather than guessing.

- [ ] **Step 3: Write failing investment tests**

Pin zero-rate behavior, monthly compounding, initial+monthly contributions, negative/invalid rate rejection, integer-cent rounding, and optional tax applied only to positive earnings.

- [ ] **Step 4: Implement deterministic investment math**

Convert annual percentage to effective monthly rate via `(1+r)^(1/12)-1`; compound initial principal then monthly end-of-period contributions; round only returned monetary values to integer cents.

- [ ] **Step 5: Write failing finance tool tests**

Cover spending summary, period comparison, category filtering, top spending, transaction search, cash flow, investment simulation, and the cross-user injection case where `args.userId` is supplied but ignored.

- [ ] **Step 6: Implement read-only tool registry**

Tool definitions use strict JSON schemas with bounded strings/limits. Aggregate rows before returning them to the model. Exclude reconciled duplicates and `isConsumption:false` movements from spending totals using existing finance rules.

- [ ] **Step 7: Add safe transaction-draft tool**

`create_transaction` produces either a confirmed deterministic write when intent/amount are explicit or a draft requiring confirmation; it never treats a bare number or discussion about a hypothetical investment as a transaction.

- [ ] **Step 8: Run finance tests**

Run: `npm test -- test/finance-periods.test.js test/finance-tools.test.js test/investments.test.js test/finance.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/finance-periods.js lib/finance-tools.js lib/investments.js lib/finance.js test/finance-periods.test.js test/finance-tools.test.js test/investments.test.js test/finance.test.js
git commit -m "feat: add deterministic finance tools and simulations"
```

---

### Task 5: OpenAI Responses Orchestrator and Contextual Chat

**Files:**
- Create: `lib/openai-client.js`
- Create: `lib/chat-orchestrator.js`
- Modify: `lib/store.js`
- Modify: `lib/app.js`
- Modify: `server.js`
- Test: `test/chat-orchestrator.test.js`
- Test: `test/finance-tools.test.js`

**Interfaces:**
- Produces store methods: `getConversationContext(userId)`, `upsertConversationContext(userId,patch)`, `clearConversationContext(userId)`.
- Produces: `createOpenAIClient({apiKey,model,fetchImpl})` with `respond({instructions,input,tools})`.
- Produces: `createChatOrchestrator({store,financeTools,llm,fallbackProcessMessage,now})` with `handle({userId,text}) -> Promise<{reply,transaction?,context?}>`.
- Server env: `OPENAI_API_KEY`, `OPENAI_MODEL`, `CHAT_AI_ENABLED`.

- [ ] **Step 1: Write failing context persistence tests**

Assert context is isolated by user and stores bounded fields: current topic, period, category, merchant, reference amount, goal, last simulation.

- [ ] **Step 2: Add `conversation_context` schema/store methods**

Use one row per user with JSONB bounded state and timestamp. Reject oversized context payloads at store/service boundary.

- [ ] **Step 3: Write failing orchestrator tests with fake LLM**

Pin: free-form analysis invokes the expected tool; “e na passada?” uses stored period context; “metade disso” reuses reference amount; undeclared tool name is rejected; malformed JSON arguments are rejected; browser/model `userId` is ignored; tool failure produces a truthful no-data reply; LLM failure falls back to `processMessage` for supported simple commands.

- [ ] **Step 4: Implement `lib/openai-client.js`**

Call `POST https://api.openai.com/v1/responses` using native fetch with Bearer auth. Send only bounded recent conversation plus structured context and tool schemas. Parse text and function calls without exposing API credentials to browser/logs.

- [ ] **Step 5: Implement orchestration loop**

Allow a bounded maximum of 6 model/tool turns per user request. Execute only declared tools. Validate every tool argument before execution. Feed tool results back to the model and persist only approved structured context fields.

- [ ] **Step 6: Add concise financial system instructions**

Instructions require: use tools for user-specific numbers; distinguish actual/current/hypothetical/projected values; do not promise returns; ask minimal clarifying questions only when required; avoid nagging; never claim access to another user or raw bank credentials.

- [ ] **Step 7: Wire `/api/chat` behind feature flag**

If `CHAT_AI_ENABLED=true` and LLM configured, use orchestrator. Otherwise preserve current `processMessage`. Any provider outage triggers fallback only for supported deterministic operations; unsupported requests get a concise degraded-mode message.

- [ ] **Step 8: Run chat/tool regression tests**

Run: `npm test -- test/chat-orchestrator.test.js test/finance-tools.test.js test/finance.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/openai-client.js lib/chat-orchestrator.js lib/store.js lib/app.js server.js test/chat-orchestrator.test.js test/finance-tools.test.js
git commit -m "feat: add contextual AI finance chat"
```

---

### Task 6: Financial Profile and Goals

**Files:**
- Modify: `lib/store.js`
- Modify: `lib/finance-tools.js`
- Modify: `lib/app.js`
- Modify: `index.html`
- Test: `test/profile-goals-api.test.js`
- Test: `test/chat-orchestrator.test.js`
- Test: `test/ui.test.js`

**Interfaces:**
- Produces store methods: `getFinancialProfile(userId)`, `updateFinancialProfile(userId,patch)`, `listGoals(userId)`, `createGoal(userId,data)`, `updateGoal(userId,id,patch)`.
- Produces APIs: `GET/PATCH /api/profile`, `GET/POST /api/goals`, `PATCH /api/goals/:id`.
- Adds finance tools: `get_financial_profile`, `get_goals`, `create_goal`, `update_goal`, `propose_profile_change`.

- [ ] **Step 1: Write failing schema/isolation tests**

Assert profile and goals are per-user; one user cannot read/update another user's goal ID; target/current values are non-negative integer cents.

- [ ] **Step 2: Add profile/goals schema and store methods**

Create one profile row per user and goal rows with target/current cents, nullable target date, type, status, timestamps.

- [ ] **Step 3: Write failing confirmation tests**

Assert conversational risk-profile changes are returned as proposals until user explicitly confirms; casual statements do not silently change profile. Goal creation may auto-save only when name/amount intent is explicit; destructive/ambiguous goal changes require confirmation.

- [ ] **Step 4: Implement tool/API confirmation rules**

Persist confirmation state in conversation context with short-lived action payload hashes; confirmation must match the pending action and authenticated user.

- [ ] **Step 5: Add lightweight “Meu Perfil” UI**

Expose saved objectives, risk tolerance, liquidity preference, horizon, monthly intended contribution, and goals. Keep chat as primary interface.

- [ ] **Step 6: Run profile/goals/UI tests**

Run: `npm test -- test/profile-goals-api.test.js test/chat-orchestrator.test.js test/ui.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/store.js lib/finance-tools.js lib/app.js index.html test/profile-goals-api.test.js test/chat-orchestrator.test.js test/ui.test.js
git commit -m "feat: add financial profiles and goals"
```

---

### Task 7: Current Market Data With Explicit Reference Dates

**Files:**
- Create: `lib/market-data.js`
- Modify: `lib/finance-tools.js`
- Test: `test/market-data.test.js`
- Test: `test/chat-orchestrator.test.js`

**Interfaces:**
- Produces: `createMarketDataClient({fetchImpl,now})`.
- Produces: `getIndicators(names) -> Promise<Array<{name,value,unit,referenceDate,source}>>`.
- Initial approved official sources: Banco Central do Brasil SGS for Selic target series `432` and IPCA series `433`.
- CDI is not inferred from Selic. Until an approved CDI source is implemented, a CDI request returns `unavailable_current_value` so the assistant must use an explicitly hypothetical rate or explain the limitation.

- [ ] **Step 1: Write failing market-data tests**

Fake official responses and assert parsing includes `referenceDate` and source; network failure returns typed unavailable result; stale/malformed payload is never labeled current; CDI is not synthesized from Selic.

- [ ] **Step 2: Implement BCB SGS client**

Fetch only the recent bounded date range needed for the latest official value. Parse Brazilian date/value format safely and expose the latest valid observation.

- [ ] **Step 3: Add `get_current_financial_indicators` tool**

Return only requested allowed indicators. Include source/reference date. Reject arbitrary URLs or series numbers supplied by the model.

- [ ] **Step 4: Add orchestrator freshness tests**

Assert current-rate responses include reference date; unavailable data leads to an explicit hypothetical simulation label rather than a fabricated current number.

- [ ] **Step 5: Run tests**

Run: `npm test -- test/market-data.test.js test/chat-orchestrator.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/market-data.js lib/finance-tools.js test/market-data.test.js test/chat-orchestrator.test.js
git commit -m "feat: add dated official market indicators"
```

---

### Task 8: Material Financial Opportunities and Radar Integration

**Files:**
- Create: `lib/opportunities.js`
- Modify: `lib/store.js`
- Modify: `lib/finance-tools.js`
- Modify: `lib/app.js`
- Modify: `index.html`
- Test: `test/opportunities.test.js`
- Test: `test/chat-orchestrator.test.js`

**Interfaces:**
- Produces: `computeOpportunities({currentRows,baselineRows,goals,now}) -> Opportunity[]`.
- Produces store methods: `upsertOpportunity(userId,data)`, `listOpportunities(userId,status?)`, `dismissOpportunity(userId,id)`.
- Adds finance tool: `get_relevant_financial_opportunities`.

- [ ] **Step 1: Write failing opportunity tests**

Pin material category spike behavior, trivial variance suppression, recurring-cost increase, sustained surplus candidate, goal-threat signal, and dismissed-opportunity non-repetition.

- [ ] **Step 2: Implement deterministic significance scoring**

Use server-side thresholds combining absolute cents and percentage change so tiny base amounts do not trigger. Keep threshold constants in `lib/opportunities.js` and cover them with tests.

- [ ] **Step 3: Add persistence**

Create `financial_opportunities` with type, structured payload, significance score, period, status, timestamps, and a stable deduplication key.

- [ ] **Step 4: Integrate Radar**

`/api/radar` returns structured active opportunities plus legacy alerts during transition. Dismissed items do not reappear unless a materially new dedupe key/period is generated.

- [ ] **Step 5: Integrate proactive chat behavior**

The orchestrator may mention at most one high-significance new opportunity in a reply where context is appropriate. It never interrupts every basic transaction confirmation with an unrelated suggestion.

- [ ] **Step 6: Run tests**

Run: `npm test -- test/opportunities.test.js test/chat-orchestrator.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/opportunities.js lib/store.js lib/finance-tools.js lib/app.js index.html test/opportunities.test.js test/chat-orchestrator.test.js
git commit -m "feat: add material finance opportunities"
```

---

### Task 9: Production Configuration, Full Regression, and Exact-SHA Rollout

**Files:**
- Modify: `server.js`
- Modify: `.github/workflows/test.yml` only if test env wiring requires it
- Modify: `test/ui.test.js` / existing tests only for final integration assertions
- No production code outside `finance-pwa` repository.

**Interfaces:**
- Consumes all prior tasks.
- Railway env names: `OPENAI_API_KEY`, `OPENAI_MODEL`, `CHAT_AI_ENABLED`, `BETA_INVITE_CODE`, `BETA_INVITE_MAX_USES` plus existing DB/session/Pluggy variables.

- [ ] **Step 1: Add final configuration validation tests**

Assert app starts with AI disabled and no OpenAI key; when AI enabled without key, startup/chat fails safe without breaking deterministic finance/Open Finance; beta registration can be disabled by omitting invite bootstrap code while existing accounts still log in.

- [ ] **Step 2: Run the entire suite locally/CI**

Run: `npm test`
Expected: all tests PASS, including existing Open Finance reconciliation/webhook/UI tests.

- [ ] **Step 3: Push branch and open PR**

PR title: `Chat Financeiro 2.0 and beta accounts`.
PR body must call out migration, new env vars, Open Finance regression results, and fallback behavior.

- [ ] **Step 4: Wait for GitHub Actions and inspect exact failing logs if any**

Expected: PostgreSQL CI job PASS with no skipped migration/isolation tests.

- [ ] **Step 5: Review branch diff before merge**

Verify no secrets, PINs, API keys, invite plaintext, or unrelated OdontoView files are present. Confirm only `acreditesignage/finance-pwa` changed.

- [ ] **Step 6: Merge only after green CI and review**

Record exact merge SHA.

- [ ] **Step 7: Configure Railway secrets without exposing them in chat/GitHub**

Set/verify `OPENAI_API_KEY`, `OPENAI_MODEL`, `CHAT_AI_ENABLED=true`, `BETA_INVITE_CODE`, `BETA_INVITE_MAX_USES`. Preserve all existing Pluggy/Postgres/session variables.

- [ ] **Step 8: Deploy exact merge SHA to `finance-pwa-app`**

Do not use a stale snapshot redeploy. Confirm deployment metadata `commitHash` equals the merge SHA.

- [ ] **Step 9: Verify runtime and health**

Check deployment `SUCCESS`, `/api/health` success, server startup logs, and no migration errors.

- [ ] **Step 10: Live smoke test**

Verify: legacy Thiago login/data; Rebeca isolation; beta registration with invite; new-user isolation; free-form chat; contextual follow-up; deterministic investment simulation; AI outage fallback; Open Finance page still loads and user ownership remains correct.

- [ ] **Step 11: Rotate any previously exposed third-party secret separately**

After the feature is stable, rotate the Pluggy client secret that was previously shared in chat and update Railway directly; never paste the replacement secret into conversation or repository.

- [ ] **Step 12: Final production commit/deploy evidence**

Record CI run ID, merge SHA, Railway deployment ID/status, and smoke-test results before claiming completion.
