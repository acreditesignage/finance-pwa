import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;

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
      `);
    },
    async addTransaction(userId, tx) {
      const id = crypto.randomUUID();
      const occurredAt = tx.occurredAt || new Date().toISOString();
      const { rows } = await pool.query(
        `INSERT INTO transactions(id,user_id,type,amount_cents,description,category,occurred_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, userId, tx.type, tx.amountCents, tx.description, tx.category, occurredAt]
      );
      const r = rows[0];
      return { id:r.id, userId:r.user_id, type:r.type, amountCents:r.amount_cents, description:r.description, category:r.category, occurredAt:r.occurred_at.toISOString() };
    },
    async listTransactions(userId, limit = 500) {
      const { rows } = await pool.query(
        `SELECT * FROM transactions WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT $2`, [userId, limit]
      );
      return rows.map(r => ({ id:r.id, userId:r.user_id, type:r.type, amountCents:r.amount_cents, description:r.description, category:r.category, occurredAt:r.occurred_at.toISOString() }));
    },
    async addChat(userId, role, content) {
      const id = crypto.randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO chat_messages(id,user_id,role,content) VALUES($1,$2,$3,$4) RETURNING *`, [id, userId, role, content]
      );
      const r=rows[0]; return { id:r.id, userId:r.user_id, role:r.role, content:r.content, createdAt:r.created_at.toISOString() };
    },
    async listChat(userId, limit = 100) {
      const { rows } = await pool.query(
        `SELECT * FROM (SELECT * FROM chat_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2) q ORDER BY created_at ASC`, [userId, limit]
      );
      return rows.map(r => ({ id:r.id, userId:r.user_id, role:r.role, content:r.content, createdAt:r.created_at.toISOString() }));
    },
    async ping() { await pool.query('SELECT 1'); return true; }
  };
}
