import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');

test('voice transcription waits for user review before sending', () => {
  const match = html.match(/function voice\(\)\{([\s\S]*?)function show/);
  assert.ok(match, 'voice() function should exist');
  const voiceBody = match[1];
  assert.match(voiceBody, /Transcrição pronta/i);
  assert.doesNotMatch(voiceBody, /onresult[\s\S]*?send\(\)/);
});

test('Open Finance is visible without permanent Pluggy credentials in frontend', () => {
  assert.match(html, /Open Finance/i);
  assert.match(html, /cdn\.pluggy\.ai\/pluggy-connect\/v2\.14\.2\/pluggy-connect\.js/);
  assert.doesNotMatch(html, /PLUGGY_CLIENT_ID|PLUGGY_CLIENT_SECRET|clientSecret\s*:/);
});

test('bank connect requests a server Connect Token before constructing PluggyConnect', () => {
  const match=html.match(/async function connectBank\([\s\S]*?\n}\n/);
  assert.ok(match,'connectBank() function should exist');
  const body=match[0];
  const tokenIndex=body.indexOf('/api/open-finance/connect-token');
  const widgetIndex=body.indexOf('new PluggyConnect');
  assert.ok(tokenIndex>=0,'Connect Token endpoint should be called');
  assert.ok(widgetIndex>tokenIndex,'PluggyConnect must be constructed only after token response');
  assert.match(body,/\/api\/open-finance\/attach-item/);
  assert.match(body,/\/api\/open-finance\/sync/);
});

test('Open Finance UI includes discovery, reconnect, sync and account states', () => {
  assert.match(html,/\/api\/open-finance\/discover/);
  assert.match(html,/reconnect_required/);
  assert.match(html,/Sincronizar/);
  assert.match(html,/Reautorizar/);
  assert.match(html,/Última sincronização/);
  assert.match(html,/Contas encontradas/);
});
