import crypto from 'node:crypto';

export function parseMoneyCents(text) {
  const match = String(text).match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
  if (!match) return 0;
  const raw = match[1];
  let normalized;
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(?:\.|$)/.test(raw)) normalized = raw.replace(/\./g, '');
  else normalized = raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function classifyCategory(text) {
  const s = String(text).toLowerCase();
  if (/ifood|delivery|restaurante|lanche|pizza|café|cafe/.test(s)) return 'Alimentação';
  if (/diesel|gasolina|posto|combust/.test(s)) return 'Combustível';
  if (/mercado|supermercado|hortifruti/.test(s)) return 'Mercado';
  if (/farm|rem[eé]dio|medic|consulta/.test(s)) return 'Saúde';
  if (/uber|99\b|ped[aá]gio|estacionamento/.test(s)) return 'Transporte';
  if (/netflix|spotify|assinatura|icloud/.test(s)) return 'Assinaturas';
  if (/luz|energia|água|agua|internet|telefone|aluguel|condom[ií]nio/.test(s)) return 'Casa';
  return 'Outros';
}

export function formatBRL(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function monthKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit'
  }).formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  return `${year}-${month}`;
}

export function createMemoryStore() {
  const transactions = [];
  const chats = [];
  return {
    async addTransaction(userId, tx) {
      const row = { id: crypto.randomUUID(), userId, occurredAt: tx.occurredAt || new Date().toISOString(), ...tx };
      transactions.push(row);
      return row;
    },
    async listTransactions(userId) {
      return transactions.filter(x => x.userId === userId).sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    },
    async addChat(userId, role, content) {
      const row = { id: crypto.randomUUID(), userId, role, content, createdAt: new Date().toISOString() };
      chats.push(row);
      return row;
    },
    async listChat(userId) {
      return chats.filter(x => x.userId === userId);
    }
  };
}

function queryTerm(text) {
  const lower = text.toLowerCase();
  const m = lower.match(/quanto\s+(?:eu\s+)?gastei(?:\s+(?:com|de|no|na))?\s*(.+?)(?:\s+(?:este|esse|neste)\s+m[eê]s)?[?.!]*$/i);
  if (!m) return '';
  return m[1].replace(/\b(este|esse|neste)\s+m[eê]s\b/g, '').trim();
}

export async function processMessage({ userId, text, store, now = new Date() }) {
  const clean = String(text || '').trim();
  if (!clean) return { reply: 'Escreva uma entrada, gasto ou pergunta financeira.' };
  await store.addChat?.(userId, 'user', clean);
  const lower = clean.toLowerCase();
  const currentMonth = monthKey(now);
  const all = await store.listTransactions(userId);
  const monthRows = all.filter(x => String(x.occurredAt).slice(0, 7) === currentMonth);

  if (/quanto.*(?:entrou|recebi|entrada)/.test(lower)) {
    const total = monthRows.filter(x => x.type === 'income').reduce((s, x) => s + x.amountCents, 0);
    const reply = `Entrou ${formatBRL(total)} neste mês.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply };
  }

  if (/saldo/.test(lower)) {
    const income = monthRows.filter(x => x.type === 'income').reduce((s, x) => s + x.amountCents, 0);
    const expense = monthRows.filter(x => x.type === 'expense').reduce((s, x) => s + x.amountCents, 0);
    const reply = `Seu saldo do mês está em ${formatBRL(income - expense)}.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply };
  }

  if (/quanto.*gast/.test(lower)) {
    const term = queryTerm(clean);
    let rows = monthRows.filter(x => x.type === 'expense');
    if (term) rows = rows.filter(x => `${x.description} ${x.category}`.toLowerCase().includes(term));
    const total = rows.reduce((s, x) => s + x.amountCents, 0);
    const reply = term ? `Você gastou ${formatBRL(total)} com ${term} neste mês.` : `Você gastou ${formatBRL(total)} neste mês.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply };
  }

  const amountCents = parseMoneyCents(clean);
  if (amountCents > 0 && /gastei|paguei|comprei|abasteci|saiu/.test(lower)) {
    const transaction = await store.addTransaction(userId, {
      type: 'expense', amountCents, description: clean, category: classifyCategory(clean), occurredAt: now.toISOString()
    });
    const reply = `Registrei ${formatBRL(amountCents)} como despesa em ${transaction.category}.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply, transaction };
  }

  if (amountCents > 0 && /recebi|entrou|ganhei|caiu|vendi/.test(lower)) {
    const transaction = await store.addTransaction(userId, {
      type: 'income', amountCents, description: clean, category: 'Entradas', occurredAt: now.toISOString()
    });
    const reply = `Registrei ${formatBRL(amountCents)} como entrada.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply, transaction };
  }

  const reply = 'Não consegui transformar isso em lançamento. Tente: “Gastei R$ 80 no mercado” ou pergunte “quanto gastei este mês?”.';
  await store.addChat?.(userId, 'assistant', reply);
  return { reply };
}
