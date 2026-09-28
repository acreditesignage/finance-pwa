# Chat Financeiro 2.0 — Design

Date: 2026-09-28

## Goal

Transform the current rule-driven finance chat into a natural-language personal finance assistant that can:

- understand free-form Portuguese without requiring fixed phrases;
- answer contextual follow-up questions;
- analyze real transaction and Open Finance data deterministically;
- compare periods, categories, merchants, recurring spending, and cash flow;
- create and track financial goals;
- simulate savings and investments without inventing calculations;
- provide educational investment guidance using current financial indicators when needed;
- proactively surface only material financial opportunities;
- support new user registration with invite codes and secure email/password login;
- preserve strict per-user isolation across chat, profile, transactions, Open Finance, goals, and alerts.

The product remains a finance PWA. Open Finance and the existing deterministic parser remain part of the system; they are not replaced.

## Product behavior

### Conversation modes

The assistant switches automatically between three behaviors:

1. **Normal conversation** — understands colloquial free-form Portuguese, including incomplete follow-ups.
2. **Financial analyst** — queries real user data and performs deterministic comparisons and calculations.
3. **Educational investment consultant** — asks only the minimum necessary questions about goal, time horizon, liquidity, risk tolerance, and contribution capacity, then explains and simulates suitable classes/strategies.

The user never needs to select a mode manually.

Examples that must work:

- “Como fui essa semana?”
- “E na passada?”
- “Qual categoria aumentou mais?”
- “Quanto foi só de iFood?”
- “Se eu cortar pela metade?”
- “Investe essa diferença por cinco anos.”
- “Tenho R$ 15 mil parados. O que posso estudar?”
- “Quanto preciso aportar por mês para chegar em R$ 100 mil?”

### Proactive insights

The system may proactively suggest an opportunity only when it is materially relevant. It must not nag the user about trivial variance.

Examples of valid triggers:

- category spending rises materially versus the user’s own recent baseline;
- a recurring cost changes materially;
- a sustained monthly surplus is detected;
- a meaningful amount could be redirected toward a saved goal;
- a current spending pattern threatens a saved budget/goal.

Proactive insights are generated from deterministic signals, then phrased by the model. The model does not invent a trigger from raw intuition.

## Architecture

### High-level flow

`User text/voice -> authenticated /api/chat -> LLM orchestrator -> approved finance tools -> PostgreSQL/Open Finance/current-rate source -> LLM final response -> structured conversation context update`

The model is an orchestrator and language layer. PostgreSQL and deterministic finance functions remain the source of truth for user-specific numbers.

### LLM integration

Initial implementation uses the OpenAI Responses API with function calling.

The application exposes a bounded set of server-owned tools. The model may request tool calls, but it never receives unrestricted SQL access and never receives credentials.

The API key exists only in Railway as `OPENAI_API_KEY`.

A provider wrapper keeps the rest of the application independent from the exact model name and allows fallback behavior when the model service is unavailable.

### Tool boundary

The model never supplies a trusted `userId`. Every tool receives the authenticated user from the server-side session context.

Initial tool set:

- `get_spending_summary(period)`
- `compare_periods(periodA, periodB)`
- `get_spending_by_category(period, category?)`
- `get_top_spending(period, limit)`
- `search_transactions(period, query, category?)`
- `get_cash_flow(period)`
- `create_transaction(draft)`
- `get_goals()`
- `create_goal(draft)`
- `update_goal(draft)`
- `simulate_savings(amount, cadence, duration)`
- `simulate_investment(initialCents, monthlyCents, months, annualRate, taxAssumption?)`
- `get_financial_profile()`
- `propose_profile_change(change)`
- `get_current_financial_indicators(indicators)`
- `get_relevant_financial_opportunities()`

No tool accepts arbitrary SQL, table names, file paths, URLs, secrets, or another user identifier.

### Reads vs writes

Read-only analysis may run automatically.

Financial writes must retain an explicit confirmation boundary whenever intent is ambiguous or the action is consequential.

Examples:

- “Padaria 50” can continue using the existing deterministic direct-entry behavior.
- “Acho que paguei uns 500 na oficina” should result in a proposed draft when confidence is insufficient.
- deleting transactions, changing a saved investment-risk profile, or modifying an existing goal requires explicit confirmation.

The existing deterministic parser remains available as a fallback for simple supported commands if the LLM provider is unavailable.

## Conversation context

### Short-term context

The app stores structured state for the active conversation, separate from the raw transcript.

Suggested fields:

- `current_topic`
- `current_period`
- `current_category`
- `current_merchant`
- `reference_amount_cents`
- `current_goal_id`
- `current_simulation`
- `updated_at`

This allows follow-ups such as “e no mês passado?”, “metade disso”, and “por dez anos?” without requiring the user to repeat the original question.

### Persistent financial profile

Persistent profile is stored per user and may include:

- main financial objectives;
- risk tolerance;
- liquidity preference;
- time horizon;
- emergency-reserve target/current value when provided;
- typical intended monthly contribution;
- preferred alert behavior.

The assistant may suggest profile changes during conversation, but meaningful profile attributes are saved only after confirmation.

Casual statements do not silently rewrite the user’s investment profile.

## Investment guidance and simulations

### Guidance model

The assistant can:

- explain investment classes and concepts;
- compare risk, liquidity, taxation, and time horizon;
- suggest classes/strategies to investigate based on the saved goal/profile;
- run deterministic future-value scenarios;
- compare hypothetical conservative/intermediate/higher-volatility scenarios;
- connect spending reductions to potential contribution amounts.

It must distinguish clearly between:

- actual user data;
- current market/reference data;
- assumptions;
- projections.

It must not present projected return as guaranteed.

### Current rates

Changing figures such as CDI, Selic, IPCA, and Treasury reference rates are not hardcoded.

When a response materially depends on a current rate, the server fetches current data from an approved source and returns the reference value and date to the model. If a fresh value cannot be obtained, the assistant must say that the simulation is using an explicitly stated hypothetical rate instead of implying it is current.

### Calculation engine

Investment calculations are deterministic application code, not mental arithmetic delegated to the model.

The simulation result returns at least:

- total contributions;
- estimated earnings;
- projected ending value;
- annual rate assumption;
- duration;
- tax assumption if applicable.

Money remains integer cents at the application boundary.

## Goals

Add persistent financial goals per user.

Suggested fields:

- `id`
- `user_id`
- `name`
- `target_cents`
- `current_cents`
- `target_date` nullable
- `goal_type`
- `status`
- `created_at`
- `updated_at`

The chat can create a goal conversationally after required fields are known and confirmed when necessary.

Examples:

- reserve target;
- travel;
- car;
- home down payment;
- long-term wealth target.

## User accounts and invite-only beta

### New authentication model

Replace hardcoded `thiago`/`rebeca` PIN-only identity with a persistent `users` table and secure email/password login.

Suggested `users` fields:

- `id UUID PRIMARY KEY`
- `legacy_key TEXT UNIQUE NULL`
- `name TEXT NOT NULL`
- `email TEXT UNIQUE NOT NULL`
- `password_hash TEXT NOT NULL`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Passwords are never stored or logged in plaintext. Use a modern password-hashing algorithm with per-password salt and appropriate work factor.

### Invite codes

During beta, registration requires an invite code.

Suggested `invite_codes` fields:

- `id UUID`
- `code_hash TEXT UNIQUE`
- `max_uses INTEGER`
- `uses INTEGER`
- `expires_at TIMESTAMPTZ NULL`
- `is_active BOOLEAN`
- `created_at TIMESTAMPTZ`

The application does not store reusable invite codes in plaintext after creation; only a hash is persisted. Codes may be single-use or multi-use.

### Registration

Registration flow:

`name + email + password + password confirmation + invite code -> validate -> create user -> create session`

Initial onboarding asks only the user’s primary intent, such as spending control, budgeting, investing, reserve building, goal saving, or all of them. A long mandatory financial questionnaire is explicitly out of scope.

### Legacy migration

Existing Thiago and Rebeca data must be preserved.

Migration creates database users with stable UUIDs and maps existing string `user_id` values to those users. All existing transactions, chats, bank connections, bank accounts, sync history, and reconciliation links remain attached to the correct owner.

The migration is transactional and idempotent.

The old PIN path may remain temporarily behind a migration compatibility path only until both legacy accounts have working email/password credentials; it is then removed.

## Session and account security

- session cookie remains `HttpOnly`, `Secure`, `SameSite=Lax`;
- session payload changes from legacy username to database user UUID;
- login and registration receive rate limiting;
- email is normalized before uniqueness checks;
- password reset architecture is prepared with one-time, expiring, hashed tokens;
- no bank credentials are ever collected or stored;
- Pluggy/Open Finance records stay server-scoped by authenticated `user_id`;
- all tool calls derive user identity from the session, never browser-supplied arguments;
- logs must redact provider/API secrets and must not print passwords, reset tokens, or full sensitive financial payloads.

## Database changes

New tables:

- `users`
- `invite_codes`
- `password_reset_tokens`
- `financial_profiles`
- `financial_goals`
- `conversation_context`
- `financial_opportunities`

Existing user-owned tables are migrated from string owner keys toward UUID foreign keys. Migration must preserve existing data and may use temporary compatibility columns if needed for a safe rollout.

All user-owned tables must have an indexed owner column.

## Financial opportunities / Radar integration

The Radar becomes a producer of structured opportunities rather than only display text.

Example opportunity record:

- type: `category_spike`
- category: `Alimentos`
- baseline_cents
- current_cents
- difference_cents
- period
- significance_score
- status: `new | shown | dismissed | resolved`

The chat may mention an opportunity when the significance threshold is met and the user has not dismissed it.

Tiny fluctuations do not create opportunities.

## Latency and cost controls

The assistant should feel conversational and avoid unnecessary model calls.

Rules:

1. deterministic fast paths remain for obvious simple commands and writes;
2. only the minimum relevant conversation window and structured context are sent to the model;
3. transaction lists are aggregated by server tools before returning them to the model whenever possible;
4. do not send the user’s full financial history to the model for questions that need only a summary;
5. use a lower-cost/low-latency model for ordinary intent routing and conversation where quality is sufficient, with an escalation path for complex financial analysis if required;
6. current-rate web/provider lookup runs only when freshness materially affects the answer;
7. tool output size is bounded;
8. model failures fall back to deterministic supported functionality rather than breaking entry of basic expenses/income.

No autonomous recurring model call is introduced merely to “think” about user finances. Proactive opportunities are computed from deterministic jobs or user-triggered refreshes.

## Error handling

- LLM unavailable: use deterministic parser for supported operations and return a concise degraded-mode message for unsupported questions.
- tool failure: final answer states that the required data could not be retrieved; it must not fabricate a number.
- stale current-rate source: use an explicit hypothetical rate or decline to call the value current.
- ambiguous write: request confirmation instead of guessing.
- failed migration: rollback transaction and leave existing production login/data intact.
- malformed model tool arguments: validate JSON schema and reject the tool call safely.
- Open Finance disconnected: analysis continues with available manual/imported data and clearly indicates limits when material.

## API shape

Existing endpoints remain where possible.

Changes/additions include:

- `POST /api/register`
- `POST /api/login` -> email/password primary authentication
- `POST /api/logout`
- `GET /api/me`
- `POST /api/password-reset/request`
- `POST /api/password-reset/confirm`
- `GET /api/profile`
- `PATCH /api/profile`
- `GET /api/goals`
- `POST /api/goals`
- `PATCH /api/goals/:id`
- `POST /api/chat` -> orchestrated Chat Financeiro 2.0

Open Finance endpoints continue to use the authenticated session owner.

## UI changes

Login screen becomes:

- email;
- password;
- Entrar;
- Criar conta;
- Esqueci minha senha.

Beta registration screen includes invite code.

The chat UI remains the principal interface. A lightweight “Meu Perfil” view exposes saved profile, goals, and alert preferences for manual editing.

The interface must not require the user to understand tool names, model modes, or internal risk/profile fields.

## Voice

The existing voice input remains supported. Upgrading browser SpeechRecognition to server-side push-to-talk transcription is a separate bounded follow-up unless implementation naturally requires a shared input abstraction. Chat Financeiro 2.0 must work identically with typed text and the existing transcribed text path.

## Testing strategy

All production changes use TDD.

Required automated coverage includes:

### Authentication

- invite required for beta registration;
- invite use count and expiry;
- duplicate normalized email rejected;
- password hash never equals plaintext;
- bad password rejected;
- session resolves UUID user;
- login/registration rate-limit behavior;
- legacy data migration idempotency and isolation.

### Chat orchestration

- free-form intent invokes correct deterministic tool;
- follow-up uses stored structured context;
- model cannot override authenticated `userId`;
- malformed tool arguments rejected;
- model cannot invoke undeclared functions;
- simple deterministic fallback works when AI provider fails.

### Finance calculations

- period boundaries use America/Sao_Paulo;
- reconciled duplicates remain excluded;
- non-consumption movements remain excluded from spending;
- investment simulation uses deterministic math and integer-cent inputs;
- comparison calculations are reproducible.

### Privacy

- one user cannot query another user’s profile, goals, transactions, chat context, Open Finance connections, or opportunities;
- tool layer always injects owner from session;
- invite/password/reset secrets are not returned in API responses or logs.

### Radar

- material spike creates an opportunity;
- trivial variance does not;
- dismissed opportunity does not nag repeatedly.

## Rollout

1. Add schema and account model behind compatibility support.
2. Migrate legacy users and all owned records transactionally.
3. Enable email/password login while preserving a tested emergency compatibility path for the two legacy accounts.
4. Add finance tool service and deterministic simulations.
5. Add LLM orchestrator behind a feature flag.
6. Add conversation context/profile/goals.
7. Connect Radar opportunities.
8. Enable invite registration.
9. Run full CI and migration verification on PostgreSQL.
10. Deploy exact tested commit to existing `finance-pwa-app` only.
11. Verify legacy login/data/Open Finance ownership before removing compatibility path.
12. Enable Chat Financeiro 2.0 in production.

## Acceptance criteria

The feature is accepted when all of the following hold:

- a beta user can register with a valid invite, then log in with email/password;
- existing users retain all historical transactions and Open Finance ownership;
- different users remain fully isolated;
- free-form Portuguese questions work without fixed phrase templates;
- contextual follow-ups work across at least period, category, amount, and simulation references;
- all user-specific numeric answers come from deterministic tools/data, not invented model values;
- investment simulations show contributions, estimated earnings, final value, duration, and explicit rate assumptions;
- current-rate answers include a reference date or clearly state that a hypothetical rate is being used;
- proactive insights only appear from structured material opportunities;
- the assistant can explain and compare investment classes but does not present projected returns as guaranteed;
- simple expense/income entry still works if the LLM service is unavailable;
- Open Finance remains functional and per-user scoped;
- full CI passes before deployment;
- Railway runs the exact merged commit and `/api/health` passes.
