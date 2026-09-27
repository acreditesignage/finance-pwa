# Finance PWA — Open Finance via Pluggy

Date: 2026-09-27
Status: design approved in chat; implementation not started

## 1. Goal

Add Open Finance to the existing Finance PWA so Thiago and Rebeca can connect financial institutions, import accounts, balances and transactions, and use those data inside the existing dashboard, chat and Radar without mixing one user's data with the other's.

Initial target: reuse Thiago's existing Itaú connection in Pluggy when possible. If that existing item cannot be discovered safely through the API, the fallback is one explicit reconnect through the Finance PWA Open Finance button, after which the Pluggy item identifier is stored and reused.

## 2. Scope

### In scope for v1

- Keep an Open Finance button in the Finance PWA.
- Pluggy integration only through the backend.
- Generate Pluggy API keys server-side from `PLUGGY_CLIENT_ID` and `PLUGGY_CLIENT_SECRET`.
- Generate short-lived Connect Tokens server-side for the Pluggy Connect Widget.
- Associate each Pluggy item with exactly one Finance PWA user (`thiago` or `rebeca`).
- Import financial accounts.
- Import account balances.
- Import transactions.
- Persist imported data in the existing PostgreSQL database.
- Idempotent sync: the same provider transaction must never be inserted twice.
- Reconcile imported transactions with manually/voice-created transactions.
- Expose connection status, last sync and imported accounts in the Open Finance area.
- Provide manual refresh/sync.
- Receive Pluggy webhooks and trigger background refresh work.
- Feed imported transactions into the existing dashboard and Radar.
- Preserve current category classification for imported transactions, with room for merchant/category learning later.
- Maintain strict Thiago/Rebeca data isolation.

### Out of scope for v1

- Payment initiation or Pix initiation.
- Money movement.
- Bank credential storage.
- Automatic destructive editing of bank-origin data.
- Investment portfolio analytics beyond basic future extensibility.
- Multi-tenant public signup.
- Production billing/subscription logic for external customers.

## 3. User experience

### Open Finance entry point

The existing app gets a visible `Open Finance` action. Opening it shows:

- connection status;
- connected institution name;
- account/card names returned by the provider;
- current balance when available;
- last successful sync time;
- sync/reconnect button;
- connect-another-bank button.

If no connection exists, the primary action is `Conectar banco`.

### Connect flow

1. Authenticated Finance PWA user taps `Conectar banco`.
2. Frontend requests a Connect Token from the Finance PWA backend.
3. Backend authenticates with Pluggy using server-side credentials and requests a user-scoped Connect Token.
4. Frontend opens Pluggy Connect Widget using only the short-lived token.
5. User chooses the institution and completes bank/Open Finance consent in the institution/provider flow.
6. Pluggy returns/creates an Item.
7. Backend stores the Item ID against the authenticated Finance PWA user.
8. Initial sync imports accounts and transactions.
9. UI reports connection as active only after the first successful provider sync.

The browser never receives `PLUGGY_CLIENT_SECRET`.

## 4. Architecture

```text
Finance PWA browser
       |
       | authenticated session
       v
Finance PWA Node backend (Railway)
       |
       | Pluggy API auth / Connect Token / sync / webhook
       v
Pluggy
       |
       v
Bank/Open Finance institution

Finance PWA backend
       |
       v
PostgreSQL (Railway volume)
```

All bank/provider integration logic lives behind the existing backend. The frontend never calls Pluggy endpoints using permanent credentials.

## 5. Secrets and configuration

Railway service variables to add:

- `PLUGGY_CLIENT_ID`
- `PLUGGY_CLIENT_SECRET`
- `PLUGGY_API_BASE_URL` only if environment override becomes necessary
- `PLUGGY_WEBHOOK_SECRET` if Pluggy account/webhook configuration supports or requires shared verification secret

Existing variables remain unchanged:

- `DATABASE_URL`
- `SESSION_SECRET`
- `THIAGO_PIN`
- `REBECA_PIN`
- `PORT`

Secrets must never be committed to GitHub, returned by API responses, placed in browser JavaScript, or written to application logs.

## 6. Data model

### `bank_connections`

- `id` UUID primary key
- `user_id` text not null
- `provider` text not null, initial value `pluggy`
- `provider_item_id` text not null unique
- `institution_name` text
- `status` text not null
- `last_sync_at` timestamptz
- `last_error_code` text nullable
- `last_error_message` text nullable, sanitized
- `created_at` timestamptz
- `updated_at` timestamptz

Invariant: every connection belongs to exactly one Finance PWA user.

### `bank_accounts`

- `id` UUID primary key
- `user_id` text not null
- `connection_id` UUID not null
- `provider_account_id` text not null unique
- `type` text
- `subtype` text
- `name` text
- `institution_name` text
- `currency` text default `BRL`
- `balance_cents` bigint nullable
- `credit_limit_cents` bigint nullable
- `last_synced_at` timestamptz
- `raw_metadata` jsonb nullable, restricted to non-sensitive provider metadata required for debugging
- `created_at` timestamptz
- `updated_at` timestamptz

### Extend `transactions`

Add columns:

- `source` text not null default `manual` (`manual`, `voice`, `open_finance`)
- `provider` text nullable
- `provider_transaction_id` text nullable
- `bank_account_id` UUID nullable
- `external_status` text nullable
- `merchant_name` text nullable
- `reconciliation_status` text not null default `not_needed`
- `reconciled_transaction_id` UUID nullable
- `updated_at` timestamptz default now()

Unique partial constraint/index on provider transaction identity, for example `(provider, provider_transaction_id)` when `provider_transaction_id` is not null.

This makes sync idempotent and prevents duplicate bank imports.

### Optional `bank_sync_runs`

Recommended for observability:

- `id`
- `user_id`
- `connection_id`
- `started_at`
- `finished_at`
- `status`
- `accounts_seen`
- `transactions_seen`
- `transactions_inserted`
- `transactions_updated`
- `error_code`

No bank secrets or access tokens are stored in this table.

## 7. API surface

All routes except webhook require the existing authenticated Finance PWA session.

### `GET /api/open-finance`

Returns only the authenticated user's connection summary and accounts.

### `POST /api/open-finance/connect-token`

Creates a short-lived Pluggy Connect Token tied to the authenticated Finance PWA user context.

Response contains only what the frontend needs to open the Pluggy widget.

### `POST /api/open-finance/attach-item`

Associates a newly created/reconnected Pluggy Item with the authenticated user after validating that the Item is accessible by the configured Pluggy application.

### `POST /api/open-finance/sync`

Triggers a sync for the authenticated user's connection. Must be rate-limited/debounced to prevent accidental repeated provider calls.

### `POST /api/webhooks/pluggy`

Public provider callback endpoint. It must:

- validate webhook authenticity using the strongest mechanism supported by the configured Pluggy account;
- accept only known event types;
- never trust a user ID from the request body;
- resolve the Finance PWA user through the stored `provider_item_id` mapping;
- be idempotent;
- acknowledge quickly and perform sync work without blocking unnecessarily.

## 8. Provider authentication

The backend requests a Pluggy API Key using `PLUGGY_CLIENT_ID` and `PLUGGY_CLIENT_SECRET`.

The API Key is cached in memory only for less than its provider validity period and refreshed when needed. Permanent app credentials remain exclusively in Railway variables.

For the browser connection flow, the backend generates a Connect Token. The browser gets the Connect Token but never the permanent client secret.

## 9. Existing Itaú connection

Initial goal is to reuse Thiago's already connected Itaú Item.

Discovery strategy:

1. Attempt provider-supported Item listing only if the Pluggy account has that capability enabled.
2. If an accessible existing Itaú Item can be identified unambiguously, explicitly associate it with Thiago before any import.
3. If discovery is unavailable or ambiguous, do not guess.
4. Show `Conectar/Reautorizar Itaú` in the Open Finance area.
5. User completes one widget flow.
6. Store the resulting Item ID for Thiago and use it thereafter.

No imported Item is ever automatically assigned to Rebeca.

## 10. Sync algorithm

For each active bank connection:

1. Load provider Item status.
2. If provider reports reconnect/consent action required, persist status and stop importing stale data as current.
3. Fetch accounts for the Item.
4. Upsert each account by provider account ID.
5. For each supported account, fetch transactions using the provider's pagination/date window.
6. Normalize amounts to integer cents.
7. Normalize direction into existing `income`/`expense` semantics.
8. Normalize provider transaction date/time to a stable timestamp; display remains America/Sao_Paulo.
9. Upsert by provider transaction ID.
10. Run automatic category classification for new imported transactions.
11. Run reconciliation against eligible manual/voice transactions.
12. Update account balances and `last_sync_at` only after a successful sync boundary.
13. Record sanitized sync outcome.

A provider failure must not erase previously imported data.

## 11. Reconciliation

Purpose: a voice/manual entry and the later bank transaction for the same purchase must not count as two expenses.

### Candidate rules

An imported transaction may be compared with unreconciled manual/voice transactions for the same user when:

- same transaction type;
- same amount in cents;
- occurred within a configurable date window, initial target ±3 calendar days;
- manual transaction has no existing bank match.

Description/category similarity can raise confidence but must not be the only matching criterion.

### Automatic match

Auto-reconcile only when there is exactly one high-confidence candidate.

On auto-reconcile:

- preserve the bank-origin transaction as the canonical financial event;
- link the manual/voice transaction to it;
- exclude the linked manual/voice row from totals;
- retain the original spoken/manual description for audit/history;
- never delete either row automatically.

### Ambiguous match

If zero candidates exist: import normally.

If multiple plausible candidates exist: mark `possible_duplicate` and surface it for review. Do not guess.

## 12. Totals and dashboard behavior

The existing dashboard, category totals and Radar must operate on effective financial events:

- bank transactions that are not duplicates;
- manual/voice transactions that have not been reconciled to a bank transaction.

A reconciled manual transaction must not contribute to totals a second time.

Imported historical transactions are included according to their occurrence date, not import date.

## 13. Categorization of bank transactions

Imported expenses pass through the same category engine used for manual/voice entries, with provider description + merchant information as input.

Existing categories include, among others:

- Alimentos
- Supermercado
- Combustível
- Diversão
- Software
- Gastos não previstos
- Luz
- Água
- Internet
- Aluguel
- IPTU
- Saúde
- Transporte
- Assinaturas
- Educação
- Roupas
- Manutenção
- Viagem
- Impostos e taxas
- Pets
- Presentes
- Investimentos
- Compras
- Casa
- Outros

Later phases may add per-user merchant/category memory, but v1 uses deterministic classification plus user correction capability when added.

## 14. User isolation and authorization

Every connection, account, sync job and imported transaction stores `user_id`.

Every authenticated API query filters by the session user before returning or mutating data.

Provider webhook requests never choose a Finance PWA user directly. User ownership is resolved server-side from the stored provider Item mapping.

A database-level foreign-key/constraint strategy should prevent attaching a bank account from one user to a connection owned by another.

## 15. Security requirements

- Never collect or store internet-banking passwords.
- Never expose Pluggy permanent credentials to the frontend.
- Use HTTPS only.
- Keep current HttpOnly/Secure/SameSite session cookie pattern.
- Validate all provider IDs before persisting ownership.
- Log provider error codes, not secrets or full sensitive payloads.
- Limit retained raw provider JSON to the minimum needed.
- Add request body size limits to webhook/connect endpoints.
- Add rate limiting/debounce to manual sync.
- Idempotency for webhook and provider imports.
- Do not trust institution names, user IDs or ownership passed from the browser.

## 16. Failure and recovery states

Open Finance UI states:

- not connected;
- connecting;
- syncing;
- active;
- reconnect required;
- consent expired/action required;
- provider temporarily unavailable;
- last sync failed while historical data remains available.

Errors should be actionable and avoid displaying raw provider stack traces.

## 17. Webhooks

Configure a Pluggy webhook URL pointing to:

`https://finance-pwa-app-production.up.railway.app/api/webhooks/pluggy`

Relevant events should trigger or schedule refresh of the mapped Item. Duplicate webhook deliveries must be harmless.

Webhook support complements, but does not replace, manual sync and initial sync after connection.

## 18. Testing strategy

### Unit tests

- Pluggy response normalization.
- Integer-cent conversion.
- imported income/expense direction.
- category classification from bank descriptions.
- reconciliation candidate matching.
- ambiguous duplicate behavior.
- effective-total calculation excludes reconciled manual duplicates.

### Integration tests with mocked Pluggy HTTP

- API key creation.
- Connect Token route never leaks client secret.
- Item-to-user ownership validation.
- account upsert.
- repeated sync produces no duplicate transactions.
- webhook resolves user by Item mapping.
- Thiago cannot read Rebeca connection/account data and vice versa.

### Deployment verification

- GitHub Actions green.
- Railway build successful.
- `/api/health` successful.
- authenticated Open Finance status endpoint successful.
- Connect Token endpoint tested without logging secret values.
- sandbox/test institution connected before relying on live banking data.

## 19. Rollout plan

### Phase A — infrastructure and sandbox

- database migrations;
- Pluggy backend client;
- Railway secrets;
- Connect Token endpoint;
- Open Finance UI;
- test connection and import using Pluggy development/sandbox capability.

### Phase B — Thiago Itaú

- attempt safe reuse of existing Item;
- otherwise one reconnect through Finance PWA;
- import accounts/balances/transactions;
- verify against visible Itaú data;
- keep Rebeca untouched.

### Phase C — reconciliation

- enable matching against manual/voice entries;
- show possible duplicates for ambiguous cases;
- update dashboard/Radar to use effective transactions.

### Phase D — Rebeca and additional banks

- allow Rebeca to connect her own institutions from her isolated session;
- support multiple Items per user;
- validate isolation again with real multi-user data.

## 20. Acceptance criteria

The feature is considered complete for v1 when:

1. Thiago can open Open Finance from the Finance PWA.
2. A Pluggy connection can be created/reused without exposing permanent credentials.
3. Itaú accounts and transactions can be imported into PostgreSQL.
4. Re-running sync does not duplicate bank transactions.
5. Imported expenses are categorized.
6. A manual/voice purchase followed by the matching bank transaction is not double-counted.
7. Ambiguous duplicate candidates are not auto-merged.
8. Dashboard and Radar include imported banking data.
9. Rebeca cannot see or use Thiago's banking connection.
10. Webhook events can refresh the correct user's connection without trusting a user ID from the webhook body.
11. All automated tests pass and Railway healthcheck remains successful.

## 21. Explicit decisions

- Provider: Pluggy for v1.
- Existing connected Itaú account is treated as Thiago's only after explicit server-side association; never inferred for Rebeca.
- Open Finance button stays in the app.
- Provider credentials remain backend-only.
- PostgreSQL is the canonical application store for imported data.
- Bank transaction IDs provide import idempotency.
- Reconciliation links records rather than deleting history.
- Ambiguity requires user review instead of automatic guessing.
- No money movement is part of this version.
