import test from 'node:test';
import assert from 'node:assert/strict';
import { safeEqual } from '../lib/auth.js';

test('safeEqual returns false instead of throwing on different lengths', () => {
  assert.equal(safeEqual('123', '123456'), false);
  assert.equal(safeEqual('123456', '123456'), true);
  assert.equal(safeEqual('123457', '123456'), false);
});
