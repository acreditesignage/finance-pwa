import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;

function iso(value) { return value ? new Date(value).toISOString() : null; }
function int(value) { return value == null ? null : Number(value); }

function mapTransaction(r) {
  return {
    id:r.id, userId:r.user_id, type:r.type, amountCents:Number(r.amount_cents), description:r.description,
    category:r.category, occurredAt:iso(r.occurred_at), source:r.source || 'manual', provider:r.provider || null,
    providerTransactionId:r.provider_transaction_id || null, bankAccountId:r.bank_account_id || null,
    externalStatus:r.external_status || null, merchantName:r.merchant_name || null,
    reconciliationStatus:r.reconciliation_status || 'not_needed', reconciledTransactionId:r.reconciled_transaction_id || null
  };
}

function mapConnection(r) {
  return {
    id:r.id, userId:r.user_id, provider:r.provider, providerItemId:r.provider_item_id,
    institutionName:r.institution_name || null, status:r.status, lastSyncAt:iso(r.last_sync_at),
    lastErrorCode:r.last_error_code || null, lastErrorMessage:r.last_error_message || null,
    createdAt:iso(r.created_at), updatedAt:iso(r.updated_at)
  };
}

function mapAccount(r) {
  return {
    id:r.id, userId:r.user_id, connectionId:r.connection_id, providerAccountId:r.provider_account_id,
    type:r.type || null, subtype:r.subtype || null, name:r.name || null, institutionName:r.institution_name || null,
    currency:r.currency || 'BRL', balanceCents:int(r.balance_cents), creditLimitCents:int(r.credit_limit_cents),
    lastSyncedAt:iso(r.last_synced_at), rawMetadata:r.raw_metadata || null
  };
}

export function createPostgresStore(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS transactions (
          id UUID PRIMARY KEY,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('income','expense')),
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          occurred_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, occurred_at DESC);

        CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user','assistant')),
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_chat_user_date ON chat_messages(user_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS bank_connections (
          id UUID PRIMARY KEY,
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_item_id TEXT NOT NULL,
          institution_name TEXT,
          status TEXT NOT NULL,
          last_sync_at TIMESTAMPTZ,
          last_error_code TEXT,
          last_error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(provider, provider_item_id),
          UNIQUE(id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_bank_connections_user ON bank_connections(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS bank_accounts (
          id UUID PRIMARY KEY,
          user_id TEXT NOT NULL,
          connection_id UUID NOT NULL,
          provider_account_id TEXT NOT NULL UNIQUE,
          type TEXT,
          subtype TEXT,
          name TEXT,
          institution_name TEXT,
          currency TEXT NOT NULL DEFAULT 'BRL',
          balance_cents BIGINT,
          credit_limit_cents BIGINT,
          last_synced_at TIMESTAMPTZ,
          raw_metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(id, user_id),
          FOREIGN KEY(connection_id, user_id) REFERENCES bank_connections(id, user_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS bank_sync_runs (
          id UUID PRIMARY KEY,
          user_id TEXT NOT NULL,
          connection_id UUID NOT NULL,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          finished_at TIMESTAMPTZ,
          status TEXT NOT NULL,
          accounts_seen INTEGER NOT NULL DEFAULT 0,
          transactions_seen INTEGER NOT NULL DEFAULT 0,
          transactions_inserted INTEGER NOT NULL DEFAULT 0,
          transactions_updated INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          FOREIGN KEY(connection_id, user_id) REFERENCES bank_connections(id, user_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pluggy_webhook_events (
          event_id TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider TEXT;
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT;
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_account_id UUID;
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_status TEXT;
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_name TEXT;
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'not_needed';
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reconciled_transaction_id UUID;
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_provider_id
          ON transactions(provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_transactions_reconciliation
          ON transactions(user_id, amount_cents, occurred_at) WHERE reconciliation_status <> 'reconciled';

        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transactions_bank_account_user_fk') THEN
            ALTER TABLE transactions ADD CONSTRAINT transactions_bank_account_user_fk
              FOREIGN KEY(bank_account_id, user_id) REFERENCES bank_accounts(id, user_id);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transactions_reconciled_fk') THEN
            ALTER TABLE transactions ADD CONSTRAINT transactions_reconciled_fk
              FOREIGN KEY(reconciled_transaction_id) REFERENCES transactions(id);
          END IF;
        END $$;
      `);
    },

    async addTransaction(userId, tx) {
      const id = crypto.randomUUID();
      const occurredAt = tx.occurredAt || new Date().toISOString();
      const { rows } = await pool.query(
        `INSERT INTO transactions(id,user_id,type,amount_cents,description,category,occurred_at,source,provider,provider_transaction_id,bank_account_id,external_status,merchant_name,reconciliation_status,reconciled_transaction_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [id,userId,tx.type,tx.amountCents,tx.description,tx.category,occurredAt,tx.source||'manual',tx.provider||null,tx.providerTransactionId||null,tx.bankAccountId||null,tx.externalStatus||null,tx.merchantName||null,tx.reconciliationStatus||'not_needed',tx.reconciledTransactionId||null]
      );
      return mapTransaction(rows[0]);
    },

    async listTransactions(userId, limit = 500) {
      const { rows } = await pool.query(`SELECT * FROM transactions WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT $2`, [userId, limit]);
      return rows.map(mapTransaction);
    },

    async addChat(userId, role, content) {
      const id = crypto.randomUUID();
      const { rows } = await pool.query(`INSERT INTO chat_messages(id,user_id,role,content) VALUES($1,$2,$3,$4) RETURNING *`, [id,userId,role,content]);
      const r=rows[0]; return { id:r.id, userId:r.user_id, role:r.role, content:r.content, createdAt:iso(r.created_at) };
    },

    async listChat(userId, limit = 100) {
      const { rows } = await pool.query(`SELECT * FROM (SELECT * FROM chat_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2) q ORDER BY created_at ASC`, [userId, limit]);
      return rows.map(r => ({ id:r.id, userId:r.user_id, role:r.role, content:r.content, createdAt:iso(r.created_at) }));
    },

    async upsertBankConnection(userId, data) {
      const id = data.id || crypto.randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO bank_connections(id,user_id,provider,provider_item_id,institution_name,status,last_sync_at,last_error_code,last_error_message)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(provider,provider_item_id) DO UPDATE SET
           institution_name=EXCLUDED.institution_name,status=EXCLUDED.status,last_sync_at=COALESCE(EXCLUDED.last_sync_at,bank_connections.last_sync_at),
           last_error_code=EXCLUDED.last_error_code,last_error_message=EXCLUDED.last_error_message,updated_at=NOW()
         WHERE bank_connections.user_id=EXCLUDED.user_id
         RETURNING *`,
        [id,userId,data.provider||'pluggy',data.providerItemId,data.institutionName||null,data.status||'UNKNOWN',data.lastSyncAt||null,data.lastErrorCode||null,data.lastErrorMessage||null]
      );
      if (!rows[0]) throw new Error('provider_item_owned_by_other_user');
      return mapConnection(rows[0]);
    },

    async listBankConnections(userId) {
      const { rows } = await pool.query(`SELECT * FROM bank_connections WHERE user_id=$1 ORDER BY updated_at DESC`, [userId]);
      return rows.map(mapConnection);
    },

    async getBankConnection(userId, id) {
      const { rows } = await pool.query(`SELECT * FROM bank_connections WHERE user_id=$1 AND id=$2`, [userId,id]);
      return rows[0] ? mapConnection(rows[0]) : null;
    },

    async getBankConnectionByProviderItemId(itemId) {
      const { rows } = await pool.query(`SELECT * FROM bank_connections WHERE provider='pluggy' AND provider_item_id=$1`, [itemId]);
      return rows[0] ? mapConnection(rows[0]) : null;
    },

    async upsertBankAccount(userId, data) {
      const id = data.id || crypto.randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO bank_accounts(id,user_id,connection_id,provider_account_id,type,subtype,name,institution_name,currency,balance_cents,credit_limit_cents,last_synced_at,raw_metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(provider_account_id) DO UPDATE SET
           type=EXCLUDED.type,subtype=EXCLUDED.subtype,name=EXCLUDED.name,institution_name=EXCLUDED.institution_name,currency=EXCLUDED.currency,
           balance_cents=EXCLUDED.balance_cents,credit_limit_cents=EXCLUDED.credit_limit_cents,last_synced_at=EXCLUDED.last_synced_at,
           raw_metadata=EXCLUDED.raw_metadata,updated_at=NOW()
         WHERE bank_accounts.user_id=EXCLUDED.user_id AND bank_accounts.connection_id=EXCLUDED.connection_id
         RETURNING *`,
        [id,userId,data.connectionId,data.providerAccountId,data.type||null,data.subtype||null,data.name||null,data.institutionName||null,data.currency||'BRL',data.balanceCents??null,data.creditLimitCents??null,data.lastSyncedAt||null,data.rawMetadata?JSON.stringify(data.rawMetadata):null]
      );
      if (!rows[0]) throw new Error('provider_account_owned_by_other_user');
      return mapAccount(rows[0]);
    },

    async listBankAccounts(userId) {
      const { rows } = await pool.query(`SELECT * FROM bank_accounts WHERE user_id=$1 ORDER BY updated_at DESC`, [userId]);
      return rows.map(mapAccount);
    },

    async upsertImportedTransaction(userId, tx) {
      const id = tx.id || crypto.randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO transactions(id,user_id,type,amount_cents,description,category,occurred_at,source,provider,provider_transaction_id,bank_account_id,external_status,merchant_name,reconciliation_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,'open_finance',$8,$9,$10,$11,$12,$13)
         ON CONFLICT(provider,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL DO UPDATE SET
           type=EXCLUDED.type,amount_cents=EXCLUDED.amount_cents,description=EXCLUDED.description,category=EXCLUDED.category,occurred_at=EXCLUDED.occurred_at,
           bank_account_id=EXCLUDED.bank_account_id,external_status=EXCLUDED.external_status,merchant_name=EXCLUDED.merchant_name,updated_at=NOW()
         WHERE transactions.user_id=EXCLUDED.user_id
         RETURNING *`,
        [id,userId,tx.type,tx.amountCents,tx.description,tx.category,tx.occurredAt,tx.provider||'pluggy',tx.providerTransactionId,tx.bankAccountId||null,tx.externalStatus||null,tx.merchantName||null,tx.reconciliationStatus||'unmatched']
      );
      if (!rows[0]) throw new Error('provider_transaction_owned_by_other_user');
      return mapTransaction(rows[0]);
    },

    async findReconciliationCandidates(userId, { type, amountCents, occurredAt, windowDays=3 }) {
      const { rows } = await pool.query(
        `SELECT * FROM transactions WHERE user_id=$1 AND type=$2 AND amount_cents=$3
           AND source IN ('manual','voice') AND reconciliation_status <> 'reconciled'
           AND occurred_at BETWEEN $4::timestamptz - ($5::int * interval '1 day') AND $4::timestamptz + ($5::int * interval '1 day')
         ORDER BY ABS(EXTRACT(EPOCH FROM (occurred_at - $4::timestamptz))) ASC`,
        [userId,type,amountCents,occurredAt,windowDays]
      );
      return rows.map(mapTransaction);
    },

    async markReconciled(userId, manualId, bankId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const manual = await client.query(
          `UPDATE transactions SET reconciliation_status='reconciled',reconciled_transaction_id=$3,updated_at=NOW()
           WHERE user_id=$1 AND id=$2 AND source IN ('manual','voice') RETURNING id`, [userId,manualId,bankId]);
        const bank = await client.query(
          `UPDATE transactions SET reconciliation_status='matched',reconciled_transaction_id=$3,updated_at=NOW()
           WHERE user_id=$1 AND id=$2 AND source='open_finance' RETURNING id`, [userId,bankId,manualId]);
        if (manual.rowCount !== 1 || bank.rowCount !== 1) throw new Error('invalid_reconciliation_pair');
        await client.query('COMMIT');
        return true;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
    },

    async recordWebhookEvent(eventId) {
      const { rows } = await pool.query(`INSERT INTO pluggy_webhook_events(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id`, [eventId]);
      return rows.length === 1;
    },

    async hasWebhookEvent(eventId) {
      const { rowCount } = await pool.query(`SELECT 1 FROM pluggy_webhook_events WHERE event_id=$1`, [eventId]);
      return rowCount > 0;
    },

    async recordSyncRun(userId, data) {
      const id = crypto.randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO bank_sync_runs(id,user_id,connection_id,started_at,finished_at,status,accounts_seen,transactions_seen,transactions_inserted,transactions_updated,error_code)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id,userId,data.connectionId,data.startedAt||new Date().toISOString(),data.finishedAt||null,data.status||'unknown',data.accountsSeen||0,data.transactionsSeen||0,data.transactionsInserted||0,data.transactionsUpdated||0,data.errorCode||null]
      );
      return rows[0];
    },

    async ping() { await pool.query('SELECT 1'); return true; },
    async close() { await pool.end(); }
  };
}
