import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safeEqual } from './auth.js';
import { processMessage, monthKey, isCountedTransaction } from './finance.js';
import { syncConnection } from './open-finance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = { '/':'index.html', '/index.html':'index.html', '/manifest.webmanifest':'manifest.webmanifest', '/sw.js':'sw.js' };
const types = { '.html':'text/html; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.js':'application/javascript; charset=utf-8' };
const WEBHOOK_EVENTS = new Set([
  'item/created','item/updated','item/error','item/deleted','item/waiting_user_input','item/waiting_user_action','item/login_succeeded',
  'transactions/created','transactions/updated','transactions/deleted'
]);

function json(res,status,body,headers={}) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
  res.end(JSON.stringify(body));
}

function readBody(req,limit=100000) {
  return new Promise((resolve,reject)=>{
    let s=''; let tooLarge=false;
    req.on('data',c=>{ s+=c; if(s.length>limit){ tooLarge=true; req.destroy(); } });
    req.on('end',()=>{
      if(tooLarge) return reject(Object.assign(new Error('body_too_large'),{status:413,code:'body_too_large'}));
      try { resolve(s?JSON.parse(s):{}); } catch { reject(Object.assign(new Error('invalid_json'),{status:400,code:'invalid_json'})); }
    });
    req.on('error',err=>reject(tooLarge?Object.assign(new Error('body_too_large'),{status:413,code:'body_too_large'}):err));
  });
}

function effectiveMonthRows(rows,now=new Date()) {
  const mk=monthKey(now);
  return rows.filter(x=>isCountedTransaction(x) && monthKey(new Date(x.occurredAt))===mk);
}

function summaryFrom(rows,now=new Date()) {
  const m=effectiveMonthRows(rows,now);
  const income=m.filter(x=>x.type==='income').reduce((s,x)=>s+x.amountCents,0);
  const expense=m.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amountCents,0);
  const cats={};
  m.filter(x=>x.type==='expense').forEach(x=>cats[x.category]=(cats[x.category]||0)+x.amountCents);
  return {incomeCents:income,expenseCents:expense,balanceCents:income-expense,categories:Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([category,amountCents])=>({category,amountCents}))};
}

function radarFrom(rows,now=new Date()) {
  const m=effectiveMonthRows(rows,now).filter(x=>x.type==='expense');
  const total=m.reduce((s,x)=>s+x.amountCents,0); const by={};
  m.forEach(x=>by[x.category]=(by[x.category]||0)+x.amountCents);
  const alerts=[];
  for(const [category,amountCents] of Object.entries(by)) if(total && amountCents/total>=.45) alerts.push({severity:'attention',title:`${category} concentra ${Math.round(amountCents/total*100)}% das despesas`,detail:`R$ ${(amountCents/100).toFixed(2).replace('.',',')} neste mês.`});
  const avg=m.length?total/m.length:0;
  m.filter(x=>m.length>=4 && x.amountCents>avg*2.5).slice(0,3).forEach(x=>alerts.push({severity:'attention',title:'Gasto acima do seu padrão',detail:`${x.description} — R$ ${(x.amountCents/100).toFixed(2).replace('.',',')}`}));
  return alerts;
}

export function createFinanceHandler({store,sessionSecret,pins,pluggy=null,publicBaseUrl='https://finance-pwa-app-production.up.railway.app',syncConnectionImpl=syncConnection,webhookSecret=null,now=()=>new Date()}) {
  if(!store || !sessionSecret || !pins?.thiago || !pins?.rebeca) throw new Error('Missing app dependencies');
  const syncGuard=new Map();

  function sign(userId) {
    const exp=Date.now()+1000*60*60*24*30;
    const payload=`${userId}.${exp}`;
    const sig=crypto.createHmac('sha256',sessionSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  function sessionUser(req) {
    const cookie=req.headers.cookie||'';
    const m=cookie.match(/(?:^|;\s*)fp_session=([^;]+)/); if(!m)return null;
    const token=decodeURIComponent(m[1]); const [userId,exp,sig]=token.split('.');
    if(!userId||!exp||!sig||Number(exp)<Date.now())return null;
    const expected=crypto.createHmac('sha256',sessionSecret).update(`${userId}.${exp}`).digest('hex');
    if(!safeEqual(sig,expected))return null;
    return ['thiago','rebeca'].includes(userId)?userId:null;
  }

  function requireUser(req,res){ const u=sessionUser(req); if(!u)json(res,401,{error:'unauthorized'}); return u; }
  function requirePluggy(res){ if(!pluggy){json(res,503,{error:'open_finance_not_configured'});return false;} return true; }
  function providerItemBelongsToUser(item,userId) {
    if(item?.clientUserId == null || item.clientUserId === '') return true;
    return String(item.clientUserId) === String(userId);
  }

  async function processWebhook(connection,payload) {
    try {
      const event=String(payload?.event||'');
      if(event==='item/deleted') {
        await store.upsertBankConnection(connection.userId,{...connection,status:'DELETED',lastErrorCode:null,lastErrorMessage:null});
        return;
      }
      if(event==='transactions/deleted') {
        const ids=Array.isArray(payload?.transactionIds)?payload.transactionIds.map(String).filter(Boolean):[];
        if(ids.length) await store.deleteImportedTransactions(connection.userId,'pluggy',ids);
        return;
      }
      if(!pluggy) return;
      await syncConnectionImpl({userId:connection.userId,connection,store,pluggy,now:now()});
    } catch(err) {
      console.error(`[finance-pwa] webhook_sync_failed: ${err?.code||'SYNC_FAILED'}`);
    }
  }

  return async function handler(req,res) {
    try {
      const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
      if(req.method==='GET'&&url.pathname==='/api/health'){ await store.ping(); return json(res,200,{ok:true}); }

      if(req.method==='POST'&&url.pathname==='/api/webhooks/pluggy') {
        if(webhookSecret) {
          const supplied=String(req.headers['x-finance-webhook-secret']||'');
          if(!safeEqual(supplied,String(webhookSecret))) return json(res,401,{error:'invalid_webhook_secret'});
        }
        const b=await readBody(req);
        const event=String(b.event||'');
        if(!WEBHOOK_EVENTS.has(event)) return json(res,202,{ok:true,ignored:true});
        const eventId=String(b.eventId||'').trim();
        const itemId=String(b.itemId||'').trim();
        if(!eventId||!itemId) return json(res,400,{error:'invalid_webhook_payload'});
        const firstDelivery=await store.recordWebhookEvent(eventId);
        if(!firstDelivery) return json(res,202,{ok:true,replayed:true});
        const connection=await store.getBankConnectionByProviderItemId(itemId);
        if(!connection) return json(res,202,{ok:true,unmapped:true});
        json(res,202,{ok:true});
        setImmediate(()=>{ void processWebhook(connection,b); });
        return;
      }

      if(req.method==='POST'&&url.pathname==='/api/login'){
        const b=await readBody(req); const user=String(b.user||'').toLowerCase(); const pin=String(b.pin||'');
        if(!pins[user]||!safeEqual(pin,pins[user]))return json(res,401,{error:'invalid_credentials'});
        return json(res,200,{user:{id:user,name:user==='thiago'?'Thiago':'Rebeca'}},{'set-cookie':`fp_session=${encodeURIComponent(sign(user))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`});
      }
      if(req.method==='POST'&&url.pathname==='/api/logout')return json(res,200,{ok:true},{'set-cookie':'fp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'});
      if(req.method==='GET'&&url.pathname==='/api/me'){const u=requireUser(req,res);if(!u)return;return json(res,200,{user:{id:u,name:u==='thiago'?'Thiago':'Rebeca'}});}
      if(req.method==='GET'&&url.pathname==='/api/transactions'){const u=requireUser(req,res);if(!u)return;return json(res,200,{transactions:await store.listTransactions(u)});}
      if(req.method==='GET'&&url.pathname==='/api/chat'){const u=requireUser(req,res);if(!u)return;return json(res,200,{messages:await store.listChat(u)});}
      if(req.method==='GET'&&url.pathname==='/api/summary'){const u=requireUser(req,res);if(!u)return;return json(res,200,summaryFrom(await store.listTransactions(u),now()));}
      if(req.method==='GET'&&url.pathname==='/api/radar'){const u=requireUser(req,res);if(!u)return;return json(res,200,{alerts:radarFrom(await store.listTransactions(u),now())});}
      if(req.method==='POST'&&url.pathname==='/api/chat'){const u=requireUser(req,res);if(!u)return;const b=await readBody(req);return json(res,200,await processMessage({userId:u,text:b.text,store,now:now()}));}

      if(req.method==='GET'&&url.pathname==='/api/open-finance'){
        const u=requireUser(req,res);if(!u)return;
        const [connections,accounts]=await Promise.all([store.listBankConnections(u),store.listBankAccounts(u)]);
        return json(res,200,{connections,accounts});
      }

      if(req.method==='POST'&&url.pathname==='/api/open-finance/connect-token'){
        const u=requireUser(req,res);if(!u)return;if(!requirePluggy(res))return;
        const b=await readBody(req); const itemId=b.itemId?String(b.itemId):null;
        if(itemId){ const owned=await store.getBankConnectionByProviderItemId(itemId); if(!owned||owned.userId!==u)return json(res,404,{error:'bank_connection_not_found'}); }
        const token=await pluggy.createConnectToken({userId:u,itemId,webhookUrl:`${publicBaseUrl.replace(/\/$/,'')}/api/webhooks/pluggy`});
        return json(res,200,{accessToken:token.accessToken});
      }

      if(req.method==='POST'&&url.pathname==='/api/open-finance/attach-item'){
        const u=requireUser(req,res);if(!u)return;if(!requirePluggy(res))return;
        const b=await readBody(req); const itemId=String(b.itemId||'').trim(); if(!itemId)return json(res,400,{error:'item_id_required'});
        const existing=await store.getBankConnectionByProviderItemId(itemId); if(existing&&existing.userId!==u)return json(res,409,{error:'bank_connection_owned_by_other_user'});
        const item=await pluggy.getItem(itemId);
        if(!providerItemBelongsToUser(item,u)) return json(res,409,{error:'bank_connection_owned_by_other_user'});
        const connection=await store.upsertBankConnection(u,{provider:'pluggy',providerItemId:itemId,institutionName:item?.connector?.name||null,status:item?.status||'UNKNOWN'});
        return json(res,200,{connection});
      }

      if(req.method==='POST'&&url.pathname==='/api/open-finance/discover'){
        const u=requireUser(req,res);if(!u)return;if(!requirePluggy(res))return;
        try {
          const items=await pluggy.listItems({clientUserId:u});
          if(items.length===0)return json(res,200,{state:'reconnect_required'});
          if(items.length!==1)return json(res,200,{state:'ambiguous',count:items.length});
          const item=items[0]; const itemId=String(item.id||''); if(!itemId)return json(res,502,{error:'provider_item_missing_id'});
          if(!providerItemBelongsToUser(item,u)) return json(res,409,{error:'bank_connection_owned_by_other_user'});
          const existing=await store.getBankConnectionByProviderItemId(itemId); if(existing&&existing.userId!==u)return json(res,409,{error:'bank_connection_owned_by_other_user'});
          const connection=await store.upsertBankConnection(u,{provider:'pluggy',providerItemId:itemId,institutionName:item?.connector?.name||null,status:item?.status||'UNKNOWN'});
          return json(res,200,{state:'attached',connection});
        } catch(err) {
          if(err?.code==='LIST_ITEMS_FEATURE_NOT_ENABLED')return json(res,200,{state:'reconnect_required'});
          throw err;
        }
      }

      if(req.method==='POST'&&url.pathname==='/api/open-finance/sync'){
        const u=requireUser(req,res);if(!u)return;if(!requirePluggy(res))return;
        const b=await readBody(req); const connectionId=String(b.connectionId||'').trim(); if(!connectionId)return json(res,400,{error:'connection_id_required'});
        const connection=await store.getBankConnection(u,connectionId); if(!connection)return json(res,404,{error:'bank_connection_not_found'});
        const key=`${u}:${connectionId}`; const ts=Date.now(); const last=syncGuard.get(key)||0;
        if(ts-last<5000)return json(res,429,{error:'sync_too_frequent'});
        syncGuard.set(key,ts);
        const result=await syncConnectionImpl({userId:u,connection,store,pluggy,now:now()});
        return json(res,200,result);
      }

      if(req.method==='GET'&&staticFiles[url.pathname]){
        const file=path.join(ROOT,staticFiles[url.pathname]); const body=await fs.readFile(file);
        res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':url.pathname==='/sw.js'?'no-cache':'no-store'}); return res.end(body);
      }
      res.writeHead(404);res.end('Not found');
    } catch(err) {
      if(res.headersSent)return res.end();
      const status=Number(err?.status)>=400&&Number(err?.status)<600?Number(err.status):500;
      const code=status===500?'internal_error':(err?.code||'request_failed');
      if(status>=500)console.error(`[finance-pwa] ${code}: ${err?.message||'error'}`);
      return json(res,status,{error:code});
    }
  };
}
