import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyCents, classifyCategory, createMemoryStore, processMessage, EXPENSE_TAXONOMY } from '../lib/finance.js';

test('parses Brazilian money to integer cents', () => {
  assert.equal(parseMoneyCents('Gastei R$ 100 de diesel'), 10000);
  assert.equal(parseMoneyCents('Recebi R$ 2.500,50'), 250050);
  assert.equal(parseMoneyCents('52 reais e 30 centavos na padaria'), 5230);
  assert.equal(parseMoneyCents('R$ 52,30 padaria'), 5230);
  assert.equal(parseMoneyCents('Aluguel 1.500 reais'), 150000);
});

const taxonomyCases = [
  ['padaria','Alimentos'],['açougue','Alimentos'],['hortifruti','Alimentos'],['supermercado','Supermercado'],['restaurante','Alimentos'],
  ['ifood','Alimentos'],['lanchonete','Alimentos'],['pizzaria','Alimentos'],['cafeteria','Alimentos'],['diesel no posto','Combustível'],
  ['pedágio','Transporte'],['estacionamento','Transporte'],['uber','Transporte'],['metrô','Transporte'],['oficina do carro','Veículo'],
  ['seguro do carro','Veículo'],['IPVA','Impostos e taxas'],['farmácia','Saúde'],['remédio','Saúde'],['consulta médica','Saúde'],
  ['exame de sangue','Saúde'],['dentista','Saúde'],['academia','Saúde'],['plano de saúde','Saúde'],['pet shop','Pets'],
  ['veterinário','Pets'],['aluguel','Aluguel'],['condomínio','Casa'],['conta de luz Enel','Luz'],['conta de água','Água'],
  ['botijão de gás','Casa'],['internet fibra','Internet'],['conta do celular','Comunicação'],['IPTU','IPTU'],['encanador em casa','Casa'],
  ['geladeira nova','Casa'],['ChatGPT','Software'],['iCloud','Software'],['Netflix','Assinaturas'],['assinatura mensal','Assinaturas'],
  ['curso online','Educação'],['faculdade','Educação'],['material escolar','Educação'],['camisa','Roupas'],['tênis novo','Roupas'],
  ['barbearia','Cuidados pessoais'],['cinema','Diversão'],['hotel na viagem','Viagem'],['presente de aniversário','Presentes'],['gasto imprevisto','Gastos não previstos']
];

test('has 50 internal expense types', () => {
  assert.equal(EXPENSE_TAXONOMY.length, 50);
});

test('classifies all 50 expense types', () => {
  for (const [text, category] of taxonomyCases) {
    assert.equal(classifyCategory(text), category, text);
  }
});

test('keeps Thiago and Rebeca transactions isolated', async () => {
  const store = createMemoryStore();
  await store.addTransaction('thiago', { type: 'expense', amountCents: 10000, description: 'diesel', category: 'Combustível' });
  await store.addTransaction('rebeca', { type: 'expense', amountCents: 4500, description: 'café', category: 'Alimentos' });
  assert.equal((await store.listTransactions('thiago')).length, 1);
  assert.equal((await store.listTransactions('rebeca')).length, 1);
});

test('chat records an expense and later answers the monthly total', async () => {
  const store = createMemoryStore();
  const first = await processMessage({ userId: 'thiago', text: 'Gastei R$ 100 de diesel no posto', store, now: new Date('2026-09-27T12:00:00-03:00') });
  assert.equal(first.transaction.amountCents, 10000);
  const answer = await processMessage({ userId: 'thiago', text: 'Quanto gastei de diesel este mês?', store, now: new Date('2026-09-27T12:10:00-03:00') });
  assert.match(answer.reply, /R\$\s*100,00/);
});

test('accepts shorthand expense phrases without forcing a fixed sentence', async () => {
  const phrases = [
    '50 reais na padaria','Padaria 50 reais','R$ 50 padaria','R$ 52,30 na padaria','52 reais e 30 centavos na padaria',
    'Paguei 180 de gasolina','Abasteci 200 de diesel','Mercado 350','Comprei remédio por 87 reais','Farmácia 64,90',
    'Conta de luz 328','Paguei a internet 119,90','Aluguel 1.500','IPTU 430','ChatGPT 129,90',
    'Netflix 39,90','Uber 26 reais','Cinema 75','Anota 40 de lanche','Coloca aí 80 de supermercado'
  ];
  const templates = [
    d => `Gastei R$ 10,50 em ${d}`,
    d => `Anota aí R$ 10,50 de ${d}`,
    d => `Registra 10 reais e 50 centavos em ${d}`,
    d => `${d} R$ 10,50`
  ];
  const descriptors = ['padaria','supermercado','gasolina','farmácia','restaurante','uber','cinema','ChatGPT','internet','aluguel','IPTU','academia','barbearia','pet shop','hotel','faculdade','camisa','pizzaria','cafeteria','estacionamento'];
  const generated = descriptors.flatMap(d => templates.map(t => t(d)));
  const samples = [...phrases, ...generated];
  assert.equal(samples.length, 100);

  for (const text of samples) {
    const store = createMemoryStore();
    const result = await processMessage({ userId: 'thiago', text, store, now: new Date('2026-09-27T12:00:00-03:00') });
    assert.ok(result.transaction, `should register: ${text}`);
    assert.equal(result.transaction.type, 'expense', text);
    assert.match(result.reply, /R\$/);
  }
});

test('does not guess that a bare number is an expense', async () => {
  const store = createMemoryStore();
  const result = await processMessage({ userId: 'thiago', text: '50', store, now: new Date('2026-09-27T12:00:00-03:00') });
  assert.equal(result.transaction, undefined);
  assert.match(result.reply, /R\$\s*50,00|50/);
});

test('does not treat transfers, card payments or investments as expenses', async () => {
  for (const text of ['Transferi R$ 500 para minha outra conta','Paguei R$ 1.200 da fatura do cartão','Apliquei R$ 2.000 no CDB']) {
    const store = createMemoryStore();
    const result = await processMessage({ userId: 'thiago', text, store, now: new Date('2026-09-27T12:00:00-03:00') });
    assert.equal(result.transaction, undefined, text);
  }
});
