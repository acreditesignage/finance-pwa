import crypto from 'node:crypto';

function moneyTokenToNumber(raw) {
  if (!raw) return NaN;
  const value = String(raw).replace(/\s/g, '');
  let normalized;
  if (value.includes(',')) normalized = value.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) normalized = value.replace(/\./g, '');
  else normalized = value;
  return Number(normalized);
}

export function parseMoneyCents(text) {
  const input = String(text || '');
  const words = input.match(/(\d{1,3}(?:\.\d{3})*|\d+)\s*reai?s(?:\s+e\s+(\d{1,2})\s*centavo?s)?/i);
  if (words) {
    const whole = moneyTokenToNumber(words[1]);
    const cents = Number(words[2] || 0);
    if (Number.isFinite(whole) && Number.isFinite(cents)) return Math.round(whole * 100) + cents;
  }
  const match = input.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
  if (!match) return 0;
  const value = moneyTokenToNumber(match[1]);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export const EXPENSE_TAXONOMY = [
  { type:'Gasto inesperado', category:'Gastos não previstos', pattern:/imprevist|inesperad|emerg[eê]ncia|quebrou|quebra urgente|gasto adicional n[aã]o previsto/i },
  { type:'IPTU', category:'IPTU', pattern:/\biptu\b|imposto predial/i },
  { type:'Energia elétrica', category:'Luz', pattern:/conta de luz|\benel\b|energia el[eé]trica|eletricidade/i },
  { type:'Água', category:'Água', pattern:/conta de [aá]gua|\bcedae\b|saneamento/i },
  { type:'Internet', category:'Internet', pattern:/internet|fibra|banda larga|wi-?fi/i },
  { type:'Aluguel', category:'Aluguel', pattern:/aluguel|loca[cç][aã]o mensal/i },
  { type:'Padaria', category:'Alimentos', pattern:/padaria|p[aã]o|confeitaria/i },
  { type:'Açougue', category:'Alimentos', pattern:/a[cç]ougue|frigor[ií]fico|carne bovina|carne su[ií]na/i },
  { type:'Hortifruti', category:'Alimentos', pattern:/hortifruti|sacol[aã]o|verduras?|frutas?/i },
  { type:'Supermercado', category:'Supermercado', pattern:/supermercado|atacad[aã]o|assa[ií]|guanabara|carrefour|mercearia|mercadinho|\bmercado\b/i },
  { type:'Restaurante', category:'Alimentos', pattern:/restaurante|almo[cç]o|jantar/i },
  { type:'Delivery', category:'Alimentos', pattern:/ifood|rappi|delivery/i },
  { type:'Lanchonete', category:'Alimentos', pattern:/lanchonete|lanche|hamb[uú]rguer|pastel/i },
  { type:'Pizzaria', category:'Alimentos', pattern:/pizzaria|pizza/i },
  { type:'Cafeteria', category:'Alimentos', pattern:/cafeteria|\bcaf[eé]\b/i },
  { type:'Combustível', category:'Combustível', pattern:/diesel|gasolina|etanol|posto de combust|combust[ií]vel|\bposto\b/i },
  { type:'Pedágio', category:'Transporte', pattern:/ped[aá]gio|sem parar/i },
  { type:'Estacionamento', category:'Transporte', pattern:/estacionamento|parqu[ií]metro/i },
  { type:'Aplicativo de transporte', category:'Transporte', pattern:/\buber\b|\b99\b|t[aá]xi|taxi/i },
  { type:'Transporte público', category:'Transporte', pattern:/[oô]nibus|metr[oô]|trem|passagem urbana/i },
  { type:'Manutenção do carro', category:'Veículo', pattern:/oficina do carro|mec[aâ]nico|troca de [oó]leo|pneu|revis[aã]o do carro/i },
  { type:'Seguro do carro', category:'Veículo', pattern:/seguro do carro|seguro auto|seguro autom[oó]vel|prote[cç][aã]o veicular/i },
  { type:'IPVA e licenciamento', category:'Impostos e taxas', pattern:/\bipva\b|licenciamento|\bdetran\b/i },
  { type:'Farmácia', category:'Saúde', pattern:/farm[aá]cia|drogasil|droga raia|drogaria/i },
  { type:'Medicamentos', category:'Saúde', pattern:/rem[eé]dio|medicamento/i },
  { type:'Consulta médica', category:'Saúde', pattern:/consulta m[eé]dica|consulta com m[eé]dic|\bm[eé]dico\b/i },
  { type:'Exames', category:'Saúde', pattern:/exame de sangue|laborat[oó]rio|exame m[eé]dico|resson[aâ]ncia|tomografia/i },
  { type:'Dentista', category:'Saúde', pattern:/dentista|odontologia|odontol[oó]gic/i },
  { type:'Academia', category:'Saúde', pattern:/academia|smart fit|crossfit|mensalidade fitness/i },
  { type:'Plano de saúde', category:'Saúde', pattern:/plano de sa[uú]de|conv[eê]nio m[eé]dico/i },
  { type:'Pet shop', category:'Pets', pattern:/pet shop|petshop|ra[cç][aã]o/i },
  { type:'Veterinário', category:'Pets', pattern:/veterin[aá]rio|vacina do cachorro|vacina do gato/i },
  { type:'Condomínio', category:'Casa', pattern:/condom[ií]nio/i },
  { type:'Gás', category:'Casa', pattern:/botij[aã]o de g[aá]s|conta de g[aá]s|g[aá]s encanado/i },
  { type:'Telefone e celular', category:'Comunicação', pattern:/conta do celular|telefone|plano de celular|\bvivo\b.*celular|\bclaro\b.*celular|\btim\b.*celular/i },
  { type:'Manutenção residencial', category:'Casa', pattern:/encanador|eletricista|manuten[cç][aã]o residencial|reparo em casa/i },
  { type:'Móveis e eletrodomésticos', category:'Casa', pattern:/geladeira|fog[aã]o|televis[aã]o|sof[aá]|m[oó]vel|eletrodom[eé]stico/i },
  { type:'Software', category:'Software', pattern:/chatgpt|openai|claude|runway|canva|adobe|notion|github|railway|google workspace|microsoft 365|software|licen[cç]a de sistema/i },
  { type:'Nuvem e armazenamento', category:'Software', pattern:/icloud|google one|dropbox|armazenamento em nuvem/i },
  { type:'Streaming', category:'Assinaturas', pattern:/netflix|spotify|disney|prime video|hbo|\bmax\b/i },
  { type:'Outras assinaturas', category:'Assinaturas', pattern:/assinatura mensal|mensalidade de aplicativo|clube de assinatura|assinatura/i },
  { type:'Cursos', category:'Educação', pattern:/curso online|curso presencial|treinamento|capacita[cç][aã]o/i },
  { type:'Escola e faculdade', category:'Educação', pattern:/escola|faculdade|universidade|mensalidade escolar/i },
  { type:'Livros e material escolar', category:'Educação', pattern:/livro|caderno|material escolar|papelaria/i },
  { type:'Roupas', category:'Roupas', pattern:/camisa|cal[cç]a|roupa|vestu[aá]rio|jaqueta/i },
  { type:'Calçados', category:'Roupas', pattern:/t[eê]nis|sapato|sand[aá]lia|cal[cç]ado/i },
  { type:'Salão e barbearia', category:'Cuidados pessoais', pattern:/barbearia|barbeiro|sal[aã]o de beleza|manicure|cabeleireiro/i },
  { type:'Cinema e lazer', category:'Diversão', pattern:/cinema|show|parque|lazer|divers[aã]o|boliche|teatro|passeio/i },
  { type:'Viagem e hospedagem', category:'Viagem', pattern:/hotel|pousada|passagem a[eé]rea|avi[aã]o|viagem|airbnb/i },
  { type:'Presentes', category:'Presentes', pattern:/presente|anivers[aá]rio|lembran[cç]a/i }
];

export function classifyCategory(text) {
  const s = String(text || '').toLowerCase();
  for (const item of EXPENSE_TAXONOMY) if (item.pattern.test(s)) return item.category;
  if (/mercado livre|shopee|amazon|magalu|magazine luiza|compra online/.test(s)) return 'Compras';
  if (/darf|tributo|imposto|taxa/.test(s)) return 'Impostos e taxas';
  if (/presente|lembran[cç]a/.test(s)) return 'Presentes';
  return 'Outros';
}

export function formatBRL(cents) {
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(cents / 100);
}

export function monthKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit' }).formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  return `${year}-${month}`;
}

export function isCountedTransaction(tx) {
  return tx?.reconciliationStatus !== 'reconciled' && tx?.isConsumption !== false;
}

export function createMemoryStore() {
  const transactions = [];
  const chats = [];
  return {
    async addTransaction(userId, tx) {
      const row = { id:crypto.randomUUID(), userId, occurredAt:tx.occurredAt || new Date().toISOString(), source:'manual', isConsumption:true, reconciliationStatus:'not_needed', ...tx };
      transactions.push(row);
      return row;
    },
    async listTransactions(userId) {
      return transactions.filter(x => x.userId === userId).sort((a,b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    },
    async addChat(userId, role, content) {
      const row = { id:crypto.randomUUID(), userId, role, content, createdAt:new Date().toISOString() };
      chats.push(row);
      return row;
    },
    async listChat(userId) { return chats.filter(x => x.userId === userId); }
  };
}

function queryTerm(text) {
  const lower = text.toLowerCase();
  const m = lower.match(/quanto\s+(?:eu\s+)?gastei(?:\s+(?:com|de|no|na))?\s*(.+?)(?:\s+(?:este|esse|neste)\s+m[eê]s)?[?.!]*$/i);
  if (!m) return '';
  return m[1].replace(/\b(este|esse|neste)\s+m[eê]s\b/g, '').trim();
}

function isNonExpenseMovement(text) {
  return /transfer(?:i|[eê]ncia)|paguei?.*(?:fatura|cart[aã]o)|(?:fatura|cart[aã]o).*pag|apliquei|investi|aporte|resgate|\bcdb\b|tesouro direto/.test(text);
}

function hasExplicitExpenseIntent(text) {
  return /gastei|paguei|comprei|abasteci|saiu|anota(?:\s+a[ií])?|registra|registre|coloca(?:\s+a[ií])?|desembolsei|custou|foram?\s+\d|passei no cart[aã]o|pix de/.test(text);
}

export async function processMessage({ userId, text, store, now=new Date() }) {
  const clean = String(text || '').trim();
  if (!clean) return { reply:'Escreva uma entrada, gasto ou pergunta financeira.' };
  await store.addChat?.(userId, 'user', clean);
  const lower = clean.toLowerCase();
  const currentMonth = monthKey(now);
  const all = await store.listTransactions(userId);
  const monthRows = all.filter(x => isCountedTransaction(x) && monthKey(new Date(x.occurredAt)) === currentMonth);

  if (/quanto.*(?:entrou|recebi|entrada)/.test(lower)) {
    const total = monthRows.filter(x => x.type === 'income').reduce((s,x) => s + x.amountCents, 0);
    const reply = `Entrou ${formatBRL(total)} neste mês.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply };
  }

  if (/saldo/.test(lower)) {
    const income = monthRows.filter(x => x.type === 'income').reduce((s,x) => s + x.amountCents, 0);
    const expense = monthRows.filter(x => x.type === 'expense').reduce((s,x) => s + x.amountCents, 0);
    const reply = `Seu saldo do mês está em ${formatBRL(income - expense)}.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply };
  }

  if (/quanto.*gast/.test(lower)) {
    const term = queryTerm(clean);
    let rows = monthRows.filter(x => x.type === 'expense');
    if (term) rows = rows.filter(x => `${x.description} ${x.category}`.toLowerCase().includes(term));
    const total = rows.reduce((s,x) => s + x.amountCents, 0);
    const reply = term ? `Você gastou ${formatBRL(total)} com ${term} neste mês.` : `Você gastou ${formatBRL(total)} neste mês.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply };
  }

  const amountCents = parseMoneyCents(clean);
  if (amountCents > 0 && /recebi|entrou|ganhei|caiu|vendi/.test(lower)) {
    const transaction = await store.addTransaction(userId, { type:'income', amountCents, description:clean, category:'Entradas', occurredAt:now.toISOString(), source:'manual', isConsumption:true });
    const reply = `Registrei ${formatBRL(amountCents)} como entrada.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply, transaction };
  }

  const category = classifyCategory(clean);
  const knownDescriptor = category !== 'Outros';
  if (amountCents > 0 && !isNonExpenseMovement(lower) && (hasExplicitExpenseIntent(lower) || knownDescriptor)) {
    const transaction = await store.addTransaction(userId, { type:'expense', amountCents, description:clean, category, occurredAt:now.toISOString(), source:'manual', isConsumption:true });
    const reply = `Registrei ${formatBRL(amountCents)} como despesa em ${transaction.category}.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply, transaction };
  }

  if (amountCents > 0) {
    const reply = `Entendi ${formatBRL(amountCents)}. O que foi esse valor? Ex.: “${formatBRL(amountCents)} na padaria”.`;
    await store.addChat?.(userId, 'assistant', reply);
    return { reply };
  }

  const reply = 'Não consegui transformar isso em lançamento. Tente: “R$ 80,00 no mercado” ou pergunte “quanto gastei este mês?”.';
  await store.addChat?.(userId, 'assistant', reply);
  return { reply };
}
