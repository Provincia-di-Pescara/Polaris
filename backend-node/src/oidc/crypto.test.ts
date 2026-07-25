import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cifra, decifra } from './crypto.ts';

process.env.JWT_SECRET = 'segreto-di-test-non-usare-in-produzione';

test('cifra + decifra: roundtrip corretto', async () => {
  const testo = 'client-secret-super-segreto';
  const cifrato = await cifra(testo);
  const decifrato = await decifra(cifrato);
  assert.equal(decifrato, testo);
});

test('cifra produce output diverso dal testo in chiaro', async () => {
  const cifrato = await cifra('valore-segreto');
  assert.notEqual(cifrato, 'valore-segreto');
});

test('due cifrature dello stesso testo producono output diversi (IV casuale)', async () => {
  const a = await cifra('stesso-valore');
  const b = await cifra('stesso-valore');
  assert.notEqual(a, b);
});

test('decifra rifiuta un valore manomesso (tag di autenticazione)', async () => {
  const cifrato = await cifra('valore-originale');
  const manomesso = cifrato.slice(0, -2) + (cifrato.slice(-2) === 'aa' ? 'bb' : 'aa');
  await assert.rejects(() => decifra(manomesso));
});
