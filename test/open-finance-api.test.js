import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFinanceHandler } from '../lib/app.js';

function createFakeStore() {
  const connections = [
    { id:'conn-t', userId:'thiago', provider:'pluggy', providerItemId:'item-t', institutionName:'Itaú', status:'UPDATED', lastSyncAt:null },
    { id:'conn-r', userId:'rebeca', provider:'pluggy', providerItemId:'item-r', institutionName:'Outro', status:'UPDATED', lastSyncAt:null }
  ];
  const accounts = [
    { id:'acc-t', userId:'thiago', connectionId:'conn-t', providerAccountId:'pa-t', name:'Conta Thiago', balanceCents:10000, currency:'BRL' },
    { id:'acc-r', userId:'rebeca', connectionId:'conn-r', providerAccountId:'pa-r', name:'Conta Rebeca', balanceCents:20000, currency:'BRL' }
  ];
  return {
    connections, accounts,
    async ping(){ return true; },
    async listTransactions(){ return []; },
    async listChat(){ return []; },
    async addChat(){},
    async listBankConnections(userId){ return connections.filter(x=>x.userId===userId); },
    async listBankAccounts(userId){ return accounts.filter(x=>x.userId===userId); },
    async getBankConnection(userId,id){ return connections.find(x=>x.userId===userId && x.id===id) || null; },
    async getBankConnectionByProviderItemId(itemId){ return connections.find(x=>x.providerItemId===itemId) || null; },
    async upsertBankConnection(userId,data){
      const existing = connections.find(x=>x.providerItemId===data.providerItemId);
      if (existing && existing.userId!==userId) throw new Error('provider_item_owned_by_other_user');
      if (existing) { Object.assign(existing,data,{userId}); return existing; }
      const row={id:`conn-${connections.length+1}`,userId,...data}; connections.push(row); return row;
    },
    async upsertBankAccount(userId,data){ const row={id:`acc-${accounts.length+1}`,userId,...data}; accounts.push(row); return row; },
    async findReconciliationCandidates(){ return []; },
    async upsertImportedTransaction(userId,tx){ return {id:'tx',userId,...tx}; },
    async getImportedTransactionByProviderId(){ return null; },
    async recordSyncRun(){},
    async markReconciled(){},
    async recordWebhookEvent(){ return true; }
  };
}

function createPluggy(overrides={}) {
  const calls=[];
  return {
    calls,
    async createConnectToken(args){ calls.push(['createConnectToken',args]); return {accessToken:'connect-only-token'}; },
    async getItem(itemId){ calls.push(['getItem',itemId]); return {id:itemId,status:'UPDATED',connector:{name:'Itaú'}}; },
    async listItems(args){ calls.push(['listItems',args]); return []; },
    async listAccounts(){ return []; },
    async listTransactions(){ return []; },
    ...overrides
  };
}

async function withServer(fn,{store=createFakeStore(),pluggy=createPluggy()}={}) {
  const handler=createFinanceHandler({
    store, sessionSecret:'test-session-secret', pins:{thiago:'111111',rebeca:'222222'}, pluggy,
    publicBaseUrl:'https://finance.example'
  });
  const server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  try { await fn({base:`http://127.0.0.1:${port}`,store,pluggy}); }
  finally { await new Promise(resolve=>server.close(resolve)); }
}

async function login(base,user='thiago',pin='111111') {
  const r=await fetch(`${base}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user,pin})});
  assert.equal(r.status,200);
  return r.headers.get('set-cookie').split(';')[0];
}

const jsonHeaders={'content-type':'application/json'};

test('Open Finance routes require authentication', async () => withServer(async ({base}) => {
  const calls=[
    ['GET','/api/open-finance'],['POST','/api/open-finance/connect-token'],
    ['POST','/api/open-finance/attach-item'],['POST','/api/open-finance/sync']
  ];
  for (const [method,path] of calls) {
    const r=await fetch(base+path,{method,headers:jsonHeaders,body:method==='POST'?'{}':undefined});
    assert.equal(r.status,401,`${method} ${path}`);
  }
}));

test('Open Finance state is isolated by authenticated user', async () => withServer(async ({base}) => {
  const cookie=await login(base);
  const r=await fetch(`${base}/api/open-finance`,{headers:{cookie}});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.deepEqual(body.connections.map(x=>x.userId),['thiago']);
  assert.deepEqual(body.accounts.map(x=>x.userId),['thiago']);
  assert.equal(JSON.stringify(body).includes('Conta Rebeca'),false);
}));

test('Connect Token response exposes only temporary accessToken and binds session user', async () => withServer(async ({base,pluggy}) => {
  const cookie=await login(base);
  const r=await fetch(`${base}/api/open-finance/connect-token`,{method:'POST',headers:{...jsonHeaders,cookie},body:'{}'});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.deepEqual(body,{accessToken:'connect-only-token'});
  assert.equal(JSON.stringify(body).includes('client-secret'),false);
  assert.deepEqual(pluggy.calls[0],[
    'createConnectToken',
    {userId:'thiago',itemId:null,webhookUrl:'https://finance.example/api/webhooks/pluggy'}
  ]);
}));

test('attach-item ignores browser userId and assigns ownership from session', async () => withServer(async ({base,store}) => {
  const cookie=await login(base);
  const r=await fetch(`${base}/api/open-finance/attach-item`,{
    method:'POST',headers:{...jsonHeaders,cookie},body:JSON.stringify({itemId:'item-new',userId:'rebeca'})
  });
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.connection.userId,'thiago');
  assert.equal(body.connection.providerItemId,'item-new');
  assert.equal(store.connections.find(x=>x.providerItemId==='item-new').userId,'thiago');
}));

test('attach-item rejects a Pluggy item explicitly tagged to another user', async () => {
  const store=createFakeStore();
  const pluggy=createPluggy({async getItem(itemId){return{id:itemId,status:'UPDATED',clientUserId:'rebeca',connector:{name:'Itaú'}};}});
  await withServer(async({base})=>{
    const cookie=await login(base,'thiago','111111');
    const r=await fetch(`${base}/api/open-finance/attach-item`,{method:'POST',headers:{...jsonHeaders,cookie},body:JSON.stringify({itemId:'foreign-item'})});
    assert.equal(r.status,409);
    assert.deepEqual(await r.json(),{error:'bank_connection_owned_by_other_user'});
    assert.equal(store.connections.some(x=>x.providerItemId==='foreign-item'),false);
  },{store,pluggy});
});

test('discover returns reconnect_required when Pluggy item listing is disabled', async () => {
  const err=Object.assign(new Error('disabled'),{code:'LIST_ITEMS_FEATURE_NOT_ENABLED',status:403});
  await withServer(async ({base}) => {
    const cookie=await login(base);
    const r=await fetch(`${base}/api/open-finance/discover`,{method:'POST',headers:{...jsonHeaders,cookie},body:'{}'});
    assert.equal(r.status,200);
    assert.deepEqual(await r.json(),{state:'reconnect_required'});
  },{pluggy:createPluggy({async listItems(){throw err;}})});
});