const DEFAULT_BASE_URL = 'https://api.pluggy.ai';
const API_KEY_CACHE_MS = 110 * 60 * 1000;

export class PluggyError extends Error {
  constructor(message, { status=500, code='PLUGGY_ERROR' }={}) {
    super(message || 'Pluggy request failed');
    this.name = 'PluggyError';
    this.status = status;
    this.code = code;
  }
}

function trimBase(url) { return String(url || DEFAULT_BASE_URL).replace(/\/$/, ''); }

export function createPluggyClient({ clientId, clientSecret, baseUrl=DEFAULT_BASE_URL, fetchImpl=fetch, now=()=>new Date() }) {
  if (!clientId || !clientSecret) throw new Error('Missing Pluggy credentials');
  const base = trimBase(baseUrl);
  let cachedApiKey = null;
  let cachedUntil = 0;

  async function readResponse(res) {
    let body = {};
    try { body = await res.json(); } catch {}
    if (!res.ok) {
      const code = body?.codeDescription || body?.code || `HTTP_${res.status}`;
      throw new PluggyError(body?.message || 'Pluggy request failed', { status:res.status, code });
    }
    return body;
  }

  async function getApiKey() {
    const ts = now() instanceof Date ? now().getTime() : new Date(now()).getTime();
    if (cachedApiKey && ts < cachedUntil) return cachedApiKey;
    const res = await fetchImpl(`${base}/auth`, {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ clientId, clientSecret })
    });
    const body = await readResponse(res);
    if (!body.apiKey) throw new PluggyError('Pluggy authentication returned no API key', { status:502, code:'MISSING_API_KEY' });
    cachedApiKey = body.apiKey;
    cachedUntil = ts + API_KEY_CACHE_MS;
    return cachedApiKey;
  }

  async function request(path, { method='GET', body }={}) {
    const apiKey = await getApiKey();
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers:{ 'content-type':'application/json', 'X-API-KEY':apiKey },
      ...(body === undefined ? {} : { body:JSON.stringify(body) })
    });
    try {
      return await readResponse(res);
    } catch (err) {
      if (err?.status === 401) { cachedApiKey = null; cachedUntil = 0; }
      throw err;
    }
  }

  async function createConnectToken({ userId, itemId, webhookUrl }) {
    const payload = { options:{ clientUserId:userId, webhookUrl, avoidDuplicates:true } };
    if (itemId) payload.itemId = itemId;
    const body = await request('/connect_token', { method:'POST', body:payload });
    return { accessToken:body.accessToken };
  }

  async function getItem(itemId) {
    return request(`/items/${encodeURIComponent(itemId)}`);
  }

  async function listItems({ clientUserId }={}) {
    let next = clientUserId ? `?clientUserId=${encodeURIComponent(clientUserId)}` : '';
    const rows = [];
    do {
      const page = await request(`/v2/items${next}`);
      rows.push(...(page.results || []));
      next = page.next;
    } while (next !== null && next !== undefined && next !== '');
    return rows;
  }

  async function listAccounts(itemId) {
    const body = await request(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    return body.results || [];
  }

  async function listTransactions(accountId) {
    let next = `?accountId=${encodeURIComponent(accountId)}`;
    const rows = [];
    do {
      const page = await request(`/v2/transactions${next}`);
      rows.push(...(page.results || []));
      next = page.next;
    } while (next !== null && next !== undefined && next !== '');
    return rows;
  }

  async function refreshItem(itemId) {
    return request(`/items/${encodeURIComponent(itemId)}`, { method:'PATCH', body:{} });
  }

  return { getApiKey, createConnectToken, getItem, listItems, listAccounts, listTransactions, refreshItem };
}
