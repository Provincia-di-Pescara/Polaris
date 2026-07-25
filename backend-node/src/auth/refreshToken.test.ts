import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generaRefreshToken, hashRefreshToken } from './refreshToken.ts';

test('generaRefreshToken produce valori diversi ad ogni chiamata', () => {
  const a = generaRefreshToken();
  const b = generaRefreshToken();
  assert.notEqual(a, b);
  assert.equal(a.length, 64); // 32 byte hex
});

test('hashRefreshToken è deterministico', () => {
  const token = generaRefreshToken();
  assert.equal(hashRefreshToken(token), hashRefreshToken(token));
});

test('hashRefreshToken produce hash diversi per token diversi', () => {
  const a = generaRefreshToken();
  const b = generaRefreshToken();
  assert.notEqual(hashRefreshToken(a), hashRefreshToken(b));
});

test('hashRefreshToken non restituisce il token in chiaro', () => {
  const token = generaRefreshToken();
  assert.notEqual(hashRefreshToken(token), token);
});
