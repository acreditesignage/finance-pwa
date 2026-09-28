import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFinanceHandler } from '../lib/app.js';

function fakeStore() {
  const events=new Set();
  const connections=[{id:'conn-t',userId:'thiago',provider:'pluggy',providerItemId:'item-t',institutionName:'Itaú',status:'UPDATED'}];
  return {
    events,connections,
    async ping(){return true;}, async listTransactions(){return [];}, async listChat(){return [];},
    async listBankConnections(userId){return connections.filter(x=>x.userId===userId);}, async listBankAccounts(){return [];},
    async getBankConnectionByProviderItemId(itemId){return connections.find(x=>x.providerItemId===itemId)||null;},
    async getBankConnection(userId,id){return connections.find(x=>x.userId===userId&&x.id===id)||null;},
    async upsertBankConnection(userId,data){const row=connections.find(x=>x.providerItemId===data.providerItemId);if(row){Object.assign(row,data);return row;}const n={id:'conn-new',userId,...data};connections.push(n);return n;},
    async recordWebhookEvent(eventId){if(events.has(eventId))return false;events.add(eventId);return true;},
    async addChat(){}, async recordSyncRun(){}
  };
}

async function withServer(fn,{store=fakeStore(),syncCalls=[],webhookSecret=null}={}) {
  const syncConnectionImpl=async args=>{syncCalls.push(args);return {status:'success'};};
  const handler=createFinanceHandler({
    store,sessionSecret:'s',pins:{thiago:'1',rebeca:'2'},pluggy:{},publicBaseUrl:'https://finance.example',
    syncConnectionImpl,webhookSecret
  });
  const server=http.createServer(handler); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{await fn({base,store,syncCalls});}finally{await new Promise(r=>server.close(r));}
}

async function post(base,body,headers={}) {
  return fetch(`${base}/api/webhooks/pluggy`,{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
}

async function tick(){await new Promise(r=>setTimeout(r,15));}

test('replayed event is acknowledged twice but schedules one logical sync', async()=>withServer(async({base,syncCalls})=>{
  const payload={event:'item/updated',eventId:'evt-1',itemId:'item-t',clientUserId:'malicious-user'};
  const a=await post(base,payload); const b=await post(base,payload);
  assert.equal(a.status,202); assert.equal(b.status,202);
  await tick();
  assert.equal(syncCalls.length,1);
  assert.equal(syncCalls[0].userId,'thiago');
}));

test('webhook ownership comes only from stored item mapping, never body user fields', async()=>withServer(async({base,syncCalls})=>{
  const r=await post(base,{event:'transactions/created',eventId:'evt-2',itemId:'item-t',clientUserId:'rebeca',userId:'rebeca',transactionIds:['tx-1']});
  assert.equal(r.status,202); await tick();
  assert.equal(syncCalls.length,1);
  assert.equal(syncCalls[0].userId,'thiago');
  assert.equal(syncCalls[0].connection.id,'conn-t');
}));

test('unknown item and unsupported event are acknowledged without sync', async()=>withServer(async({base,syncCalls})=>{
  assert.equal((await post(base,{event:'item/updated',eventId:'evt-3',itemId:'unknown'})).status,202);
  assert.equal((await post(base,{event:'payment_intent/completed',eventId:'evt-4',itemId:'item-t'})).status,202);
  await tick(); assert.equal(syncCalls.length,0);
}));

test('item/deleted marks connection deleted without trying to refresh removed item', async()=>withServer(async({base,store,syncCalls})=>{
  const r=await post(base,{event:'item/deleted',eventId:'evt-del',itemId:'item-t'});
  assert.equal(r.status,202); await tick();
  assert.equal(syncCalls.length,0);
  assert.equal(store.connections[0].status,'DELETED');
}));

test('configured webhook secret is required using constant-time header comparison', async()=>withServer(async({base,syncCalls})=>{
  assert.equal((await post(base,{event:'item/updated',eventId:'evt-bad',itemId:'item-t'})).status,401);
  assert.equal((await post(base,{event:'item/updated',eventId:'evt-wrong',itemId:'item-t'},{'x-finance-webhook-secret':'wrong'})).status,401);
  assert.equal((await post(base,{event:'item/updated',eventId:'evt-good',itemId:'item-t'},{'x-finance-webhook-secret':'secret-123'})).status,202);
  await tick(); assert.equal(syncCalls.length,1);
},{webhookSecret:'secret-123'}));

test('invalid webhook JSON is rejected safely', async()=>withServer(async({base})=>{
  const r=await post(base,'{"event":');
  assert.equal(r.status,400);
  assert.deepEqual(await r.json(),{error:'invalid_json'});
}));
