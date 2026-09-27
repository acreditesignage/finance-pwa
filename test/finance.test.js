import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyCents, classifyCategory, createMemoryStore, processMessage } from '../lib/finance.js';

test('parses Brazilian money to integer cents', () => {
  assert.equal(parseMoneyCents('Gastei R$ 100 de diesel'), 10000);
  assert.equal(parseMoneyCents('Recebi R$ 2.500,50'), 250050);
});

test('classifies common finance descriptions', () => {
  assert.equal(classifyCategory('Abasteci diesel no posto'), 'Combustível');
  assert.equal(classifyCategory('Pedi iFood'), 'Alimentação');
});

test('keeps Thiago and Rebeca transactions isolated', async () => {
  const store = createMemoryStore();
  await store.addTransaction('thiago', { type: 'expense', amountCents: 10000, description: 'diesel', category: 'Combustível' });
  await store.addTransaction('rebeca', { type: 'expense', amountCents: 4500, description: 'café', category: 'Alimentação' });
  assert.equal((await store.listTransactions('thiago')).length, 1);
  assert.equal((await store.listTransactions('rebeca')).length, 1);
  assert.equal((await store.listTransactions('thiago'))[0].description, 'diesel');
});

test('chat records an expense and later answers the monthly total', async () => {
  const store = createMemoryStore();
  const first = await processMessage({ userId: 'thiago', text: 'Gastei R$ 100 de diesel no posto', store, now: new Date('2026-09-27T12:00:00-03:00') });
  assert.equal(first.transaction.amountCents, 10000);
  const answer = await processMessage({ userId: 'thiago', text: 'Quanto gastei de diesel este mês?', store, now: new Date('2026-09-27T12:10:00-03:00') });
  assert.match(answer.reply, /R\$\s*100,00/);
});
