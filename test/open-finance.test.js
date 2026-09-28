import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePluggyTransaction,
  findBestReconciliationCandidate,
  syncConnection,
  isEffectiveTransaction
} from '../lib/open-finance.js';
import { monthKey } from '../lib/finance.js';

test('normalizes Pluggy DEBIT/CREDIT using provider direction and integer cents', () => {
  const account = { id:'local-account', providerAccountId:'acc-1', type:'BANK' };
  const debit = normalizePluggyTransaction({
    id:'tx-1', type:'DEBIT', amount:52.30, date:'2026-09-28T01:30:00.000Z',
    description:'COMPRA PADARIA', status:'POSTED', currencyCode:'BRL', merchant:{name:'Padaria Central'}
  }, account);
  const credit = normalizePluggyTransaction({
    id:'tx-2', type:'CREDIT', amount:-1500, date:'2026-09-27T12:00:00.000Z',
    description:'PIX RECEBIDO', status:'POSTED', currencyCode:'BRL'
  }, account);
  assert.equal(debit.type, 'expense');
  assert.equal(debit.amountCents, 5230);
  assert.equal(debit.description, 'Padaria Central');
  assert.equal(debit.providerTransactionId, 'tx-1');
  assert.equal(debit.category, 'Alimentos');
  assert.equal(debit.occurredAt, '2026-09-28T01:30:00.000Z');
  assert.equal(credit.type, 'income');
  assert.equal(credit.amountCents, 150000);
});

test('preserves instant and month is evaluated in America/Sao_Paulo', () => {
  const tx = normalizePluggyTransaction({
    id:'tx-boundary', type:'DEBIT', amount:10, date:'2026-10-01T01:30:00.000Z',
    description:'Padaria', status:'POSTED', currencyCode:'BRL'
  }, { id:'local-account', providerAccountId:'acc-1', type:'BANK' });
  assert.equal(monthKey(new Date(tx.occurredAt)), '2026-09');
});

test('marks transfers, investments and card-bill payments as non-consumption', () => {
  const account = { id:'a', providerAccountId:'acc-1', type:'BANK' };
  const transfer = normalizePluggyTransaction({ id:'t1',type:'DEBIT',amount:100,date:'2026-09-27T12:00:00Z',description:'PIX TRANSFERENCIA',operationType:'TRANSFERENCIA_MESMA_INSTITUICAO',status:'POSTED' }, account);
  const bill = normalizePluggyTransaction({ id:'t2',type:'CREDIT',amount:500,date:'2026-09-27T12:00:00Z',description:'PAGAMENTO FATURA',operationType:'PAGAMENTO_FATURA',status:'POSTED' }, { ...account, type:'CREDIT' });
  const investment = normalizePluggyTransaction({ id:'t3',type:'CREDIT',amount:200,date:'2026-09-27T12:00:00Z',description:'RESGATE APLICACAO',operationType:'RESGATE_APLIC_FINANCEIRA',status:'POSTED' }, account);
  assert.equal(transfer.isConsumption, false);
  assert.equal(bill.isConsumption, false);
  assert.equal(investment.isConsumption, false);
});

test('reconciliation auto-matches exactly one candidate and flags ambiguity', () => {
  const imported = { type:'expense', amountCents:10000, occurredAt:'2026-09-27T15:00:00Z', description:'POSTO IPIRANGA', category:'Combustível' };
  const one = [{ id:'m1', userId:'thiago', source:'manual', type:'expense', amountCents:10000, occurredAt:'2026-09-26T15:00:00Z', description:'diesel', category:'Combustível', reconciliationStatus:'not_needed' }];
  assert.deepEqual(findBestReconciliationCandidate(imported, one), { status:'matched', candidate:one[0] });
  const two = [...one, { ...one[0], id:'m2', occurredAt:'2026-09-28T15:00:00Z' }];
  assert.deepEqual(findBestReconciliationCandidate(imported, two), { status:'possible_duplicate', candidate:null });
  assert.deepEqual(findBestReconciliationCandidate(imported, []), { status:'unmatched', candidate:null });
});

test('effective transaction excludes reconciled duplicate and non-consumption from expense totals', () => {
  assert.equal(isEffectiveTransaction({ source:'manual', reconciliationStatus:'reconciled', isConsumption:true }), false);
  assert.equal(isEffectiveTransaction({ source:'open_finance', reconciliationStatus:'matched', isConsumption:true }), true);
  assert.equal(isEffectiveTransaction({ source:'open_finance', reconciliationStatus:'unmatched', isConsumption:false }), false);
});

function createFakeStore() {
  const accounts = new Map();
  const transactions = new Map();
  const manual = [{ id:'manual-1', userId:'thiago', source:'manual', type:'expense', amountCents:5230, occurredAt:'2026-09-27T12:00:00Z', description:'padaria', category:'Alimentos', reconciliationStatus:'not_needed', isConsumption:true }];
  const reconciled = [];
  const syncRuns = [];
  return {
    accounts, transactions, manual, reconciled, syncRuns,
    async upsertBankAccount(userId, data) {
      const old = accounts.get(data.providerAccountId);
      const row = { id:old?.id || `local-${data.providerAccountId}`, userId, ...data };
      accounts.set(data.providerAccountId, row); return row;
    },
    async upsertImportedTransaction(userId, tx) {
      const key = `${tx.provider}:${tx.providerTransactionId}`;
      const old = transactions.get(key);
      const row = { id:old?.id || `local-${tx.providerTransactionId}`, userId, ...tx, source:'open_finance' };
      transactions.set(key,row); return row;
    },
    async findReconciliationCandidates(userId, criteria) {
      const at = new Date(criteria.occurredAt).getTime();
      return manual.filter(x => x.userId===userId && x.type===criteria.type && x.amountCents===criteria.amountCents && x.reconciliationStatus!=='reconciled' && Math.abs(new Date(x.occurredAt).getTime()-at)<=3*86400000);
    },
    async markReconciled(userId, manualId, bankId) {
      const row = manual.find(x=>x.id===manualId && x.userId===userId); if (row) row.reconciliationStatus='reconciled';
      reconciled.push({userId,manualId,bankId}); return true;
    },
    async upsertBankConnection(userId, data) { return { id:data.id || 'conn-1', userId, ...data }; },
    async recordSyncRun(userId, data) { syncRuns.push({userId,...data}); }
  };
}

test('sync imports accounts/transactions, reconciles once and remains idempotent', async () => {
  const store = createFakeStore();
  const pluggy = {
    async getItem() { return { id:'item-1', status:'UPDATED', connector:{name:'Itaú'} }; },
    async listAccounts() { return [{ id:'acc-1',type:'BANK',subtype:'CHECKING_ACCOUNT',name:'Conta Corrente',balance:1000,currencyCode:'BRL' }]; },
    async listTransactions() { return [{ id:'tx-1',type:'DEBIT',amount:52.30,date:'2026-09-27T12:00:00Z',description:'PADARIA',status:'POSTED',merchant:{name:'Padaria Central'} }]; }
  };
  const connection = { id:'conn-1', provider:'pluggy', providerItemId:'item-1', institutionName:'Itaú', status:'UPDATED' };
  const first = await syncConnection({ userId:'thiago', connection, store, pluggy, now:new Date('2026-09-28T00:00:00Z') });
  const second = await syncConnection({ userId:'thiago', connection, store, pluggy, now:new Date('2026-09-28T00:05:00Z') });
  assert.equal(store.accounts.size, 1);
  assert.equal(store.transactions.size, 1);
  assert.equal(store.accounts.get('acc-1').balanceCents, 100000);
  assert.equal(store.reconciled.length, 1);
  assert.equal(first.transactionsSeen, 1);
  assert.equal(second.transactionsSeen, 1);
  assert.equal(store.syncRuns.at(-1).status, 'success');
});

test('sync failure records error but does not delete previously imported rows', async () => {
  const store = createFakeStore();
  store.transactions.set('pluggy:old', { id:'old', provider:'pluggy', providerTransactionId:'old' });
  const pluggy = { async getItem(){ throw Object.assign(new Error('provider down'), {code:'PROVIDER_DOWN'}); } };
  await assert.rejects(() => syncConnection({ userId:'thiago', connection:{id:'conn-1',providerItemId:'item-1'}, store, pluggy, now:new Date() }), /provider down/);
  assert.equal(store.transactions.size, 1);
  assert.equal(store.syncRuns.at(-1).status, 'failed');
  assert.equal(store.syncRuns.at(-1).errorCode, 'PROVIDER_DOWN');
});
