import http from 'node:http';
import { createPostgresStore } from './lib/store.js';
import { createPluggyClient } from './lib/pluggy.js';
import { createFinanceHandler } from './lib/app.js';

const PORT=Number(process.env.PORT||3000);
const DATABASE_URL=process.env.DATABASE_URL;
const SESSION_SECRET=process.env.SESSION_SECRET;
const PINS={thiago:process.env.THIAGO_PIN,rebeca:process.env.REBECA_PIN};

if(!DATABASE_URL||!SESSION_SECRET||!PINS.thiago||!PINS.rebeca){
  console.error('Missing DATABASE_URL, SESSION_SECRET, THIAGO_PIN or REBECA_PIN');
  process.exit(1);
}

const store=createPostgresStore(DATABASE_URL);
await store.init();

let pluggy=null;
if(process.env.PLUGGY_CLIENT_ID&&process.env.PLUGGY_CLIENT_SECRET){
  pluggy=createPluggyClient({clientId:process.env.PLUGGY_CLIENT_ID,clientSecret:process.env.PLUGGY_CLIENT_SECRET});
}

const publicBaseUrl=process.env.PUBLIC_BASE_URL || 'https://finance-pwa-app-production.up.railway.app';
const handler=createFinanceHandler({store,sessionSecret:SESSION_SECRET,pins:PINS,pluggy,publicBaseUrl});
const server=http.createServer(handler);
server.listen(PORT,'0.0.0.0',()=>console.log(`finance-pwa listening on ${PORT}`));
