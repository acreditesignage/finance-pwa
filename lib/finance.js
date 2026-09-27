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

  if (/imprevist|inesperad|emerg[eê]ncia|quebrou|quebra|urgente|gasto adicional n[aã]o previsto/.test(s)) return 'Gastos não previstos';
  if (/iptu|imposto predial/.test(s)) return 'IPTU';
  if (/conta de luz|enel|energia el[eé]trica|eletricidade/.test(s)) return 'Luz';
  if (/conta de [aá]gua|cedae|saneamento/.test(s)) return 'Água';
  if (/internet|fibra|banda larga|wi-?fi/.test(s)) return 'Internet';
  if (/aluguel|loca[cç][aã]o mensal/.test(s)) return 'Aluguel';

  if (/chatgpt|openai|claude|runway|canva|adobe|notion|github|railway|google workspace|microsoft 365|software|licen[cç]a de sistema|hospedagem|hosting|dom[ií]nio/.test(s)) return 'Software';
  if (/cinema|show|parque|lazer|divers[aã]o|boliche|teatro|passeio/.test(s)) return 'Diversão';
  if (/mercado livre|shopee|amazon|magalu|magazine luiza|compra online/.test(s)) return 'Compras';
  if (/supermercado|atacad[aã]o|assai|assa[ií]|guanabara|carrefour|hortifruti|mercearia|mercadinho|\bmercado\b/.test(s)) return 'Supermercado';
  if (/ifood|delivery|restaurante|lanche|pizza|café|cafe|padaria|hamb[uú]rguer|sorvete|almo[cç]o|jantar/.test(s)) return 'Alimentos';
  if (/diesel|gasolina|etanol|posto|combust/.test(s)) return 'Combustível';
  if (/farm|rem[eé]dio|medic|consulta|dentista|exame|hospital|plano de sa[uú]de/.test(s)) return 'Saúde';
  if (/uber|99\b|ped[aá]gio|estacionamento|passagem|[oô]nibus|metro|metr[oô]|taxi|t[aá]xi/.test(s)) return 'Transporte';
  if (/netflix|spotify|disney|prime video|hbo|max\b|assinatura/.test(s)) return 'Assinaturas';
  if (/escola|curso|faculdade|livro|material escolar|educa[cç][aã]o/.test(s)) return 'Educação';
  if (/roupa|camisa|cal[cç]a|sapato|t[eê]nis|vestu[aá]rio/.test(s)) return 'Roupas';
  if (/manuten[cç][aã]o|revis[aã]o|conserto|oficina|reparo/.test(s)) return 'Manutenção';
  if (/hotel|hospedagem de viagem|passagem a[eé]rea|avi[aã]o|viagem|airbnb/.test(s)) return 'Viagem';
  if (/ipva|darf|taxa|tributo|imposto/.test(s)) return 'Impostos e taxas';
  if (/pet|ra[cç][aã]o|veterin[aá]rio|cachorro|gato/.test(s)) return 'Pets';
  if (/presente|anivers[aá]rio|lembran[cç]a/.test(s)) return 'Presentes';
  if (/investimento|aporte|tesouro|cdb|a[cç][aã]o|fundo|cripto/.test(s)) return 'Investimentos';
  if (/condom[ií]nio|telefone|celular|g[aá]s/.test(s)) return 'Casa';
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
