# Open Finance Pluggy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing Finance PWA to Pluggy so each authenticated user can connect/reuse bank connections, import accounts and transactions, reconcile bank data with manual/voice entries, and use those effective transactions in the existing dashboard and Radar.

**Architecture:** Keep permanent Pluggy credentials server-only in Railway. Add a small Pluggy HTTP client, persisted bank connection/account metadata, an idempotent sync/reconciliation service, authenticated Open Finance API routes, a public idempotent webhook endpoint, and a lightweight Open Finance panel in the existing single-page UI. PostgreSQL remains the application source of truth; Pluggy is the upstream banking-data provider.

**Tech Stack:** Node.js 20 ESM, built-in `fetch`, `node:http`, PostgreSQL via `pg`, vanilla HTML/CSS/JS PWA, GitHub Actions, Railway, Pluggy API + Pluggy Connect Widget.

**Spec:** `docs/superpowers/specs/2026-09-27-open-finance-pluggy-design.md`

## Global Constraints

- Keep `PLUGGY_CLIENT_ID` and `PLUGGY_CLIENT_SECRET` only in Railway; never commit them or return them to the browser.
- Do not persist or reuse the user-supplied temporary Pluggy API key; obtain API keys server-side with `POST /auth` and cache them only in memory for less than the documented 2-hour validity.
- Generate a fresh Connect Token for each connect/update flow; the documented token lifetime is 30 minutes.
- Put `clientUserId`, `webhookUrl`, and `avoidDuplicates` inside the `options` object when creating a Connect Token.
- Use `GET /accounts?itemId=...` for accounts and `GET /v2/transactions?accountId=...` with cursor pagination for transactions. Do not build new code on deprecated page-based `GET /transactions`.
- Prefer the Pluggy transaction `type` (`DEBIT` / `CREDIT`) for direction because Pluggy normalizes account-holder direction across bank and credit-card accounts.
- All bank connections, accounts, imported transactions, sync runs, and reconciliation decisions are user-scoped. Thiago and Rebeca data must never cross.
- Use integer cents internally.
- Never auto-delete a manual/voice record during reconciliation; link it to the bank transaction and exclude the duplicate from totals.
- Do not count transfers, card-bill payments, or investments as consumption expenses merely because money moved.
- Keep the current Railway `/api/health` healthcheck working.
- Use TDD for every production-code change.

## Review Focus

- Pluggy returns `403 LIST_ITEMS_FEATURE_NOT_ENABLED` for `GET /v2/items`: existing Itaú discovery must fall back to explicit reconnect without breaking Open Finance.
- A repeated sync returns the same provider transaction IDs: no duplicate transaction may be inserted or counted.
- Two manual expenses have the same amount within the reconciliation window: mark possible duplicate instead of auto-matching the wrong row.
- A Pluggy webhook is replayed with the same `eventId`: acknowledge harmlessly and do not repeat destructive work.
- A bank or card transaction is `CREDIT` even when its raw amount sign is surprising: direction must follow Pluggy `type`, not naive sign rules.

---

### Task 1: Pluggy Server Client

**Files:**
- Create: `lib/pluggy.js`
- Create: `test/pluggy.test.js`

**Interfaces:**
- Produces: `createPluggyClient({ clientId, clientSecret, baseUrl, fetchImpl, now })`
- Client methods: `getApiKey()`, `createConnectToken({ userId, itemId, webhookUrl })`, `getItem(itemId)`, `listItems({ clientUserId })`, `listAccounts(itemId)`, `listTransactions(accountId)`, `refreshItem(itemId)`.

- [ ] **Step 1: Write failing tests for API-key caching and credential secrecy**

Assert that two calls within the cache window perform one `POST /auth`, that the request body contains credentials only on `/auth`, and that returned application objects never expose `clientSecret`.

- [ ] **Step 2: Run `npm test -- test/pluggy.test.js` and verify RED**

Expected: fail because `lib/pluggy.js` does not exist.

- [ ] **Step 3: Implement `createPluggyClient(...)` with in-memory API-key caching**

Cache for 110 minutes maximum; on auth failure clear cache and propagate a sanitized provider error.

- [ ] **Step 4: Add failing tests for Connect Token body and pagination**

Assert `POST /connect_token` sends `options.clientUserId`, `options.webhookUrl`, `options.avoidDuplicates=true`, and optional root `itemId`. Assert `listTransactions` follows each opaque `next` URL until `next === null` without rebuilding cursor parameters.

- [ ] **Step 5: Implement the remaining Pluggy methods using `X-API-KEY`**

Use `/v2/items`, `/accounts`, `/v2/transactions`, `/items/{id}`, and `PATCH /items/{id}`.

- [ ] **Step 6: Run `npm test` and verify the full suite is green**

- [ ] **Step 7: Commit `feat: add Pluggy server client`**

---

### Task 2: Open Finance Persistence and Idempotency

**Files:**
- Modify: `lib/store.js`
- Create: `test/store-open-finance.test.js`

**Interfaces:**
- Produces store methods: `upsertBankConnection(userId, data)`, `listBankConnections(userId)`, `getBankConnection(userId, id)`, `getBankConnectionByProviderItemId(itemId)`, `upsertBankAccount(userId, data)`, `listBankAccounts(userId)`, `upsertImportedTransaction(userId, tx)`, `findReconciliationCandidates(userId, criteria)`, `markReconciled(userId, manualId, bankId)`, `recordWebhookEvent(eventId)`, `hasWebhookEvent(eventId)`, `recordSyncRun(userId, data)`.

- [ ] **Step 1: Write failing tests for user isolation and provider idempotency**

Use a temporary PostgreSQL test database when available; otherwise keep SQL-shape tests isolated behind a store test harness. Assert provider item ownership is unique, provider transaction identity cannot duplicate, and Thiago queries cannot return Rebeca rows.

- [ ] **Step 2: Run the targeted store tests and verify RED**

- [ ] **Step 3: Extend `init()` with additive safe migrations**

Create `bank_connections`, `bank_accounts`, `bank_sync_runs`, `pluggy_webhook_events`; add transaction columns with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; add partial unique index on `(provider, provider_transaction_id)` when provider ID is non-null.

- [ ] **Step 4: Implement the store methods**

Every public method that accepts a user context must filter or validate `user_id`; `getBankConnectionByProviderItemId` is server-internal for webhook ownership resolution only.

- [ ] **Step 5: Run `npm test` and verify green**

- [ ] **Step 6: Commit `feat: persist Open Finance data`**

---

### Task 3: Sync, Normalization, and Reconciliation

**Files:**
- Create: `lib/open-finance.js`
- Create: `test/open-finance.test.js`
- Modify: `lib/finance.js`

**Interfaces:**
- Consumes: Pluggy client from Task 1; store methods from Task 2.
- Produces: `normalizePluggyTransaction(raw, account)`, `findBestReconciliationCandidate(imported, candidates)`, `syncConnection({ userId, connection, store, pluggy, now })`, `isEffectiveTransaction(tx)`.

- [ ] **Step 1: Write failing normalization tests**

Assert `DEBIT -> expense`, `CREDIT -> income`, integer-cent conversion, `merchant.name` preference when present, provider ID preservation, and Sao-Paulo-safe occurrence timestamp handling.

- [ ] **Step 2: Run targeted tests and verify RED**

- [ ] **Step 3: Implement normalization and categorization**

Feed provider description plus merchant into the existing deterministic `classifyCategory`. Preserve provider category only as metadata; do not make the app depend on a paid Pluggy enrichment tier.

- [ ] **Step 4: Write failing reconciliation tests**

Rules: same user, same type, exact amount, unreconciled manual/voice source, date within ±3 calendar days. One high-confidence candidate auto-links; multiple candidates return `possible_duplicate`; zero candidates import normally.

- [ ] **Step 5: Implement reconciliation without deletion**

Bank row remains canonical; manual/voice row remains for audit but receives reconciliation linkage and is excluded by `isEffectiveTransaction`.

- [ ] **Step 6: Write failing sync tests**

Assert accounts upsert, cursor-paginated transactions import, repeated sync is idempotent, failed provider refresh preserves old data, and card-bill payment/transfer-like movements are not treated as consumption expenses in consumption summaries.

- [ ] **Step 7: Implement `syncConnection(...)`**

Record sanitized sync outcome and update `last_sync_at` only after a successful sync boundary.

- [ ] **Step 8: Update finance summary/query helpers to count only effective transactions**

- [ ] **Step 9: Run `npm test` and verify green**

- [ ] **Step 10: Commit `feat: sync and reconcile bank transactions`**

---

### Task 4: Authenticated Open Finance API

**Files:**
- Modify: `server.js`
- Create: `test/open-finance-api.test.js`

**Interfaces:**
- Produces routes: `GET /api/open-finance`, `POST /api/open-finance/connect-token`, `POST /api/open-finance/attach-item`, `POST /api/open-finance/sync`, optional `POST /api/open-finance/discover` for Thiago's pre-existing Item discovery.

- [ ] **Step 1: Write failing auth/isolation tests for all four routes**

Unauthenticated requests return `401`; authenticated responses return only that session user's connections/accounts.

- [ ] **Step 2: Write failing Connect Token tests**

Assert browser response contains only `accessToken`; verify no permanent credential value is serialized or logged.

- [ ] **Step 3: Implement Pluggy client initialization from Railway env vars**

Require `PLUGGY_CLIENT_ID` and `PLUGGY_CLIENT_SECRET` only when Open Finance endpoints are used so unrelated health/login behavior remains diagnosable.

- [ ] **Step 4: Implement `GET /api/open-finance` and `POST /connect-token`**

Use session user as `clientUserId`; use production webhook URL `https://finance-pwa-app-production.up.railway.app/api/webhooks/pluggy`.

- [ ] **Step 5: Implement safe Item association**

`POST /attach-item` retrieves the Item server-side before ownership assignment. Never accept browser-supplied `userId` as ownership authority.

- [ ] **Step 6: Implement existing-Itaú discovery fallback**

Attempt `GET /v2/items?clientUserId=thiago`; if Pluggy returns `LIST_ITEMS_FEATURE_NOT_ENABLED`, return a typed `reconnect_required` state rather than an application error. Never guess between multiple Items.

- [ ] **Step 7: Implement manual sync endpoint with a simple in-process debounce/rate guard**

- [ ] **Step 8: Run `npm test` and verify green**

- [ ] **Step 9: Commit `feat: add Open Finance API routes`**

---

### Task 5: Pluggy Webhook Handling

**Files:**
- Modify: `server.js`
- Modify: `lib/open-finance.js`
- Modify: `lib/store.js`
- Create: `test/pluggy-webhook.test.js`

**Interfaces:**
- Produces: `POST /api/webhooks/pluggy`.

- [ ] **Step 1: Write failing replay/idempotency tests**

Same `eventId` twice must return success both times but schedule/process one logical refresh only.

- [ ] **Step 2: Write failing ownership tests**

Resolve user only from stored `provider_item_id`; ignore any body field that tries to select a Finance PWA user.

- [ ] **Step 3: Implement supported event handling**

Accept relevant `item/*` and `transactions/*` events, reject oversized/invalid JSON, persist `eventId`, acknowledge quickly, and trigger safe sync for the mapped connection.

- [ ] **Step 4: Add optional shared-header verification if a Railway `PLUGGY_WEBHOOK_SECRET` is configured**

Configure matching custom header in Pluggy when registering the webhook. If no secret is configured yet, rely on item mapping + event id + HTTPS and document the reduced verification level until the header is configured.

- [ ] **Step 5: Run `npm test` and verify green**

- [ ] **Step 6: Commit `feat: handle Pluggy webhooks`**

---

### Task 6: Open Finance UI and Pluggy Connect Widget

**Files:**
- Modify: `index.html`
- Modify: `test/ui.test.js`

**Interfaces:**
- Consumes: Open Finance routes from Task 4.
- Produces: visible `Open Finance` action and panel with connection state, institution, account names, balances, last sync, connect/reconnect, sync, and connect-another-bank actions.

- [ ] **Step 1: Write failing static UI regression tests**

Assert Open Finance entry exists, permanent credentials are absent from HTML, and connect flow requests `/api/open-finance/connect-token` before constructing `PluggyConnect`.

- [ ] **Step 2: Add Pluggy Connect browser script using the current official CDN version verified at implementation time**

Do not hardcode credentials. Initialize with returned `accessToken`; on success send returned Item ID to `/api/open-finance/attach-item`, then trigger sync and refresh UI.

- [ ] **Step 3: Implement panel states**

States: not connected, connecting, syncing, active, reconnect required, consent/action required, temporary provider failure, last sync failed with historical data still visible.

- [ ] **Step 4: Wire existing-Itaú recovery**

If discovery succeeds with one unambiguous Item, show it; if discovery is disabled/ambiguous, show one explicit `Conectar/Reautorizar Itaú` action.

- [ ] **Step 5: Run `npm test` and verify green**

- [ ] **Step 6: Commit `feat: add Open Finance interface`**

---

### Task 7: Production Verification and Rollout

**Files:**
- No product-code change unless verification exposes a defect.

**Interfaces:**
- Consumes all prior tasks.

- [ ] **Step 1: Run the full GitHub Actions test suite on the feature branch**

Expected: zero failing tests.

- [ ] **Step 2: Verify Railway variable names without printing values**

Required: `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, existing database/session variables. Do not store the previously pasted temporary API key.

- [ ] **Step 3: Deploy the exact tested commit to `finance-pwa-app` only**

Do not touch old preview/web services or any dental repository/service.

- [ ] **Step 4: Verify Railway deployment commit SHA, status, runtime logs, and `/api/health`**

Expected: exact merged commit, `SUCCESS`, server listening on port 3000, healthcheck passed.

- [ ] **Step 5: Validate Open Finance status as Thiago**

Attempt safe discovery of the pre-existing Itaú Item. If the Pluggy account has item listing disabled, use the Finance PWA connect/re-authorize flow once and store the resulting Item ID.

- [ ] **Step 6: Import Itaú accounts and transactions, then compare visible totals with Pluggy/Itaú for a small known period**

Do not declare live banking import complete until at least one account and transaction set are verified.

- [ ] **Step 7: Re-run the same sync and verify transaction count/totals do not increase from duplicates**

- [ ] **Step 8: Verify Rebeca's session cannot see Thiago's bank connection or accounts**

- [ ] **Step 9: Rotate the Pluggy client secret because the original secret was pasted into chat, update Railway directly, and verify one fresh server-side authentication succeeds**

- [ ] **Step 10: Report the live Open Finance URL and actual verified state**
