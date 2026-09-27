import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');

test('voice transcription waits for user review before sending', () => {
  const match = html.match(/function voice\(\)\{([\s\S]*?)function moves/);
  assert.ok(match, 'voice() function should exist');
  const voiceBody = match[1];
  assert.match(voiceBody, /Transcrição pronta/i);
  assert.doesNotMatch(voiceBody, /onresult[\s\S]*?send\(\)/);
});
