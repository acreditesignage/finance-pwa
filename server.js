import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPostgresStore } from './lib/store.js';
import { processMessage, monthKey } from './lib/finance.js';
import { safeEqual } from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
const PINS = { thiago: process.env.THIAGO_PIN, rebeca: process.env.REBECA_PIN };
if (!DATABASE_URL || !SESSION_SECRET || !PINS.thiago || !PINS.rebeca) {
  console.error('Missing DATABASE_URL, SESSION_SECRET, THIAGO_PIN or REBECA_PIN');
  process.exit(1);
}

const store = createPostgresStore(DATABASE_URL);
await store.init();

function json(res, status, body, headers={}) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req) { return new Promise((resolve, reject) => { let s=''; req.on('data', c => { s += c; if (s.length > 100000) req.destroy(); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch(e){ reject(e); } }); req.on('error', reject); }); }
function sign(userId) {
  const exp = Date.now() + 1000*60*60*24*30;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function sessionUser(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)fp_session=([^;]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  const [userId, exp, sig] = token.split('.');
  if (!userId || !exp || !sig || Number(exp) < Date.now()) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}.${exp}`).digest('hex');
  if (!safeEqual(sig, expected)) return null;
  return ['thiago','rebeca'].includes(userId) ? userId : null;
}
function requireUser(req, res) { const u=sessionUser(req); if(!u) json(res,401,{error:'unauthorized'}); return u; }
function localMonthRows(rows, now=new Date()) { const mk=monthKey(now); return rows.filter(x => String(x.occurredAt).slice(0,7)===mk); }
function summaryFrom(rows) { const m=localMonthRows(rows); const income=m.filter(x=>x.type==='income').reduce((s,x)=>s+x.amountCents,0); const expense=m.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amountCents,0); const cats={}; m.filter(x=>x.type==='expense').forEach(x=>cats[x.category]=(cats[x.category]||0)+x.amountCents); return { incomeCents:income, expenseCents:expense, balanceCents:income-expense, categories:Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([category,amountCents])=>({category,amountCents})) }; }
function radarFrom(rows) { const m=localMonthRows(rows).filter(x=>x.type==='expense'); const total=m.reduce((s,x)=>s+x.amountCents,0); const by={}; m.forEach(x=>by[x.category]=(by[x.category]||0)+x.amountCents); const alerts=[]; for(const [category,amountCents] of Object.entries(by)) if(total && amountCents/total>=.45) alerts.push({severity:'attention',title:`${category} concentra ${Math.round(amountCents/total*100)}% das despesas`,detail:`R$ ${(amountCents/100).toFixed(2).replace('.',',')} neste mês.`}); const avg=m.length?total/m.length:0; m.filter(x=>m.length>=4 && x.amountCents>avg*2.5).slice(0,3).forEach(x=>alerts.push({severity:'attention',title:'Gasto acima do seu padrão',detail:`${x.description} — R$ ${(x.amountCents/100).toFixed(2).replace('.',',')}`})); return alerts; }

const staticFiles = { '/':'index.html', '/index.html':'index.html', '/manifest.webmanifest':'manifest.webmanifest', '/sw.js':'sw.js' };
const types = { '.html':'text/html; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.js':'application/javascript; charset=utf-8' };

const server = http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url, `http://${req.headers.host||'localhost'}`);
    if (req.method==='GET' && url.pathname==='/api/health') { await store.ping(); return json(res,200,{ok:true}); }
    if (req.method==='POST' && url.pathname==='/api/login') {
      const b=await readBody(req); const user=String(b.user||'').toLowerCase(); const pin=String(b.pin||'');
      if (!PINS[user] || !safeEqual(pin, PINS[user])) return json(res,401,{error:'invalid_credentials'});
      const label=user==='thiago'?'Thiago':'Rebeca';
      return json(res,200,{user:{id:user,name:label}},{'set-cookie':`fp_session=${encodeURIComponent(sign(user))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`});
    }
    if (req.method==='POST' && url.pathname==='/api/logout') return json(res,200,{ok:true},{'set-cookie':'fp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'});
    if (req.method==='GET' && url.pathname==='/api/me') { const u=requireUser(req,res); if(!u)return; return json(res,200,{user:{id:u,name:u==='thiago'?'Thiago':'Rebeca'}}); }
    if (req.method==='GET' && url.pathname==='/api/transactions') { const u=requireUser(req,res); if(!u)return; return json(res,200,{transactions:await store.listTransactions(u)}); }
    if (req.method==='GET' && url.pathname==='/api/chat') { const u=requireUser(req,res); if(!u)return; return json(res,200,{messages:await store.listChat(u)}); }
    if (req.method==='GET' && url.pathname==='/api/summary') { const u=requireUser(req,res); if(!u)return; return json(res,200,summaryFrom(await store.listTransactions(u))); }
    if (req.method==='GET' && url.pathname==='/api/radar') { const u=requireUser(req,res); if(!u)return; return json(res,200,{alerts:radarFrom(await store.listTransactions(u))}); }
    if (req.method==='POST' && url.pathname==='/api/chat') { const u=requireUser(req,res); if(!u)return; const b=await readBody(req); const result=await processMessage({userId:u,text:b.text,store}); return json(res,200,result); }
    if (req.method==='GET' && staticFiles[url.pathname]) { const file=path.join(__dirname,staticFiles[url.pathname]); const body=await fs.readFile(file); res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':url.pathname==='/sw.js'?'no-cache':'no-store'}); return res.end(body); }
    res.writeHead(404); res.end('Not found');
  } catch (e) { console.error(e); if(!res.headersSent) json(res,500,{error:'internal_error'}); else res.end(); }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`finance-pwa listening on ${PORT}`));
