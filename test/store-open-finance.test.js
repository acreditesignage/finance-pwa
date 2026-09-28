import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresStore } from '../lib/store.js';

const databaseUrl = process.env.DATABASE_URL_TEST;
const run = databaseUrl ? test : test.skip;

run('Open Finance store isolates users and provider item ownership', async () => {
  const store = createPostgresStore(databaseUrl);
  await store.init();
  const suffix = `${Date.now()}-${Math.random()}`;
  const itemThiago = `item-thiago-${suffix}`;
  const itemRebeca = `item-rebeca-${suffix}`;
  const c1 = await store.upsertBankConnection('thiago', { provider:'pluggy', providerItemId:itemThiago, institutionName:'Itaú', status:'UPDATED' });
  await store.upsertBankConnection('rebeca', { provider:'pluggy', providerItemId:itemRebeca, institutionName:'Outro banco', status:'UPDATED' });
  const thiago = await store.listBankConnections('thiago');
  const rebeca = await store.listBankConnections('rebeca');
  assert.ok(thiago.some(x => x.providerItemId === itemThiago));
  assert.ok(!thiago.some(x => x.providerItemId === itemRebeca));
  assert.ok(rebeca.some(x => x.providerItemId === itemRebeca));
  assert.ok(!rebeca.some(x => x.providerItemId === itemThiago));
  await assert.rejects(() => store.upsertBankConnection('rebeca', { provider:'pluggy', providerItemId:itemThiago, institutionName:'Itaú', status:'UPDATED' }));
  assert.equal((await store.getBankConnection('thiago', c1.id)).providerItemId, itemThiago);
  await store.close();
});

run('provider transaction upsert is idempotent, user scoped and preserves consumption flag', async () => {
  const store = createPostgresStore(databaseUrl);
  await store.init();
  const suffix = `${Date.now()}-${Math.random()}`;
  const connection = await store.upsertBankConnection('thiago', { provider:'pluggy', providerItemId:`item-${suffix}`, institutionName:'Itaú', status:'UPDATED' });
  const account = await store.upsertBankAccount('thiago', { connectionId:connection.id, providerAccountId:`account-${suffix}`, type:'BANK', subtype:'CHECKING_ACCOUNT', name:'Conta', institutionName:'Itaú', currency:'BRL', balanceCents:100000 });
  const first = await store.upsertImportedTransaction('thiago', {
    type:'expense', amountCents:5230, description:'TRANSFERENCIA', category:'Outros', occurredAt:'2026-09-27T13:00:00Z',
    provider:'pluggy', providerTransactionId:`tx-${suffix}`, bankAccountId:account.id, externalStatus:'POSTED', merchantName:null, isConsumption:false
  });
  const second = await store.upsertImportedTransaction('thiago', {
    type:'expense', amountCents:5230, description:'TRANSFERENCIA ATUALIZADA', category:'Outros', occurredAt:'2026-09-27T13:00:00Z',
    provider:'pluggy', providerTransactionId:`tx-${suffix}`, bankAccountId:account.id, externalStatus:'POSTED', merchantName:null, isConsumption:false
  });
  assert.equal(first.id, second.id);
  const rows = await store.listTransactions('thiago');
  const imported = rows.find(x => x.providerTransactionId === `tx-${suffix}`);
  assert.equal(rows.filter(x => x.providerTransactionId === `tx-${suffix}`).length, 1);
  assert.equal(imported.source, 'open_finance');
  assert.equal(imported.isConsumption, false);
  assert.equal((await store.getImportedTransactionByProviderId('thiago','pluggy',`tx-${suffix}`)).id, first.id);
  assert.equal((await store.listTransactions('rebeca')).some(x => x.providerTransactionId === `tx-${suffix}`), false);
  await store.close();
});

run('deleting imported transaction restores reconciled manual entry and removes bank row', async () => {
  const store=createPostgresStore(databaseUrl);
  await store.init();
  const suffix=`${Date.now()}-${Math.random()}`;
  const connection=await store.upsertBankConnection('thiago',{provider:'pluggy',providerItemId:`item-del-${suffix}`,institutionName:'Itaú',status:'UPDATED'});
  const account=await store.upsertBankAccount('thiago',{connectionId:connection.id,providerAccountId:`acc-del-${suffix}`,type:'BANK',name:'Conta',balanceCents:0});
  const manual=await store.addTransaction('thiago',{type:'expense',amountCents:5000,description:'padaria manual',category:'Alimentos',occurredAt:'2026-09-27T12:00:00Z',source:'manual'});
  const bank=await store.upsertImportedTransaction('thiago',{type:'expense',amountCents:5000,description:'PADARIA',category:'Alimentos',occurredAt:'2026-09-27T12:00:00Z',provider:'pluggy',providerTransactionId:`tx-del-${suffix}`,bankAccountId:account.id,externalStatus:'POSTED',isConsumption:true});
  await store.markReconciled('thiago',manual.id,bank.id);
  assert.equal((await store.listTransactions('thiago')).find(x=>x.id===manual.id).reconciliationStatus,'reconciled');
  const deleted=await store.deleteImportedTransactions('thiago','pluggy',[`tx-del-${suffix}`]);
  assert.equal(deleted,1);
  const after=await store.listTransactions('thiago');
  assert.equal(after.some(x=>x.id===bank.id),false);
  const restored=after.find(x=>x.id===manual.id);
  assert.equal(restored.reconciliationStatus,'not_needed');
  assert.equal(restored.reconciledTransactionId,null);
  await store.close();
});

run('webhook event recording is replay-safe', async () => {
  const store = createPostgresStore(databaseUrl);
  await store.init();
  const eventId = `event-${Date.now()}-${Math.random()}`;
  assert.equal(await store.recordWebhookEvent(eventId), true);
  assert.equal(await store.hasWebhookEvent(eventId), true);
  assert.equal(await store.recordWebhookEvent(eventId), false);
  await store.close();
});