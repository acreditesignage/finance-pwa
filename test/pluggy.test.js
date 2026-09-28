import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluggyClient } from '../lib/pluggy.js';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); }
  };
}

test('caches server API key and never exposes permanent credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, init={}) => {
    calls.push({ url, init });
    return response(200, { apiKey: 'server-api-key' });
  };
  const client = createPluggyClient({
    clientId: 'client-id', clientSecret: 'client-secret', fetchImpl,
    now: () => new Date('2026-09-28T00:00:00Z')
  });
  assert.equal(await client.getApiKey(), 'server-api-key');
  assert.equal(await client.getApiKey(), 'server-api-key');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.pluggy.ai/auth');
  assert.deepEqual(JSON.parse(calls[0].init.body), { clientId:'client-id', clientSecret:'client-secret' });
  assert.equal('clientSecret' in client, false);
});

test('creates a user-scoped connect token with options and optional itemId', async () => {
  const calls = [];
  const fetchImpl = async (url, init={}) => {
    calls.push({ url, init });
    if (url.endsWith('/auth')) return response(200, { apiKey: 'k' });
    return response(200, { accessToken: 'connect-token' });
  };
  const client = createPluggyClient({ clientId:'id', clientSecret:'secret', fetchImpl });
  const result = await client.createConnectToken({
    userId:'thiago', itemId:'item-1', webhookUrl:'https://app.test/api/webhooks/pluggy'
  });
  assert.deepEqual(result, { accessToken:'connect-token' });
  const call = calls.find(x => x.url.endsWith('/connect_token'));
  assert.ok(call);
  assert.equal(call.init.headers['X-API-KEY'], 'k');
  assert.deepEqual(JSON.parse(call.init.body), {
    itemId:'item-1',
    options:{ clientUserId:'thiago', webhookUrl:'https://app.test/api/webhooks/pluggy', avoidDuplicates:true }
  });
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('follows Pluggy cursor next string as-is when listing transactions', async () => {
  const seen = [];
  const fetchImpl = async (url, init={}) => {
    seen.push(url);
    if (url.endsWith('/auth')) return response(200, { apiKey:'k' });
    if (url.includes('/v2/transactions?accountId=acc-1') && !url.includes('after=')) {
      return response(200, { results:[{id:'t1'}], next:'?accountId=acc-1&after=cursor-2' });
    }
    if (url.endsWith('/v2/transactions?accountId=acc-1&after=cursor-2')) {
      return response(200, { results:[{id:'t2'}], next:null });
    }
    throw new Error(`unexpected ${url}`);
  };
  const client = createPluggyClient({ clientId:'id', clientSecret:'secret', fetchImpl });
  const rows = await client.listTransactions('acc-1');
  assert.deepEqual(rows.map(x => x.id), ['t1','t2']);
  assert.ok(seen.includes('https://api.pluggy.ai/v2/transactions?accountId=acc-1&after=cursor-2'));
});

test('surfaces provider error code for disabled item listing', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/auth')) return response(200, { apiKey:'k' });
    return response(403, { codeDescription:'LIST_ITEMS_FEATURE_NOT_ENABLED', message:'disabled' });
  };
  const client = createPluggyClient({ clientId:'id', clientSecret:'secret', fetchImpl });
  await assert.rejects(() => client.listItems({ clientUserId:'thiago' }), err => {
    assert.equal(err.code, 'LIST_ITEMS_FEATURE_NOT_ENABLED');
    assert.equal(err.status, 403);
    return true;
  });
});
