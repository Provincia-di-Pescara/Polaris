import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verificaPassword } from './password.ts';

test('hashPassword produce un hash diverso dalla password in chiaro', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
});

test('verificaPassword accetta la password corretta', async () => {
  const hash = await hashPassword('correct horse battery staple');
  const ok = await verificaPassword('correct horse battery staple', hash);
  assert.equal(ok, true);
});

test('verificaPassword rifiuta la password sbagliata', async () => {
  const hash = await hashPassword('correct horse battery staple');
  const ok = await verificaPassword('password sbagliata', hash);
  assert.equal(ok, false);
});

test('due hash della stessa password sono diversi (salt casuale)', async () => {
  const hash1 = await hashPassword('stessa password');
  const hash2 = await hashPassword('stessa password');
  assert.notEqual(hash1, hash2);
});
