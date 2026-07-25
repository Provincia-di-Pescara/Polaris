import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsonwebtoken from 'jsonwebtoken';
import { generaAccessTokenPubblico, verificaAccessTokenPubblico } from './jwtPubblico.ts';

process.env.JWT_SECRET = 'segreto-di-test-non-usare-in-produzione';

test('generaAccessTokenPubblico + verificaAccessTokenPubblico: roundtrip corretto', () => {
  const token = generaAccessTokenPubblico({
    sub: 'persona-1',
    codiceFiscale: 'RSSMRA80A01H501U',
    nome: 'Mario',
    cognome: 'Rossi',
  });
  const payload = verificaAccessTokenPubblico(token);
  assert.equal(payload.sub, 'persona-1');
  assert.equal(payload.codiceFiscale, 'RSSMRA80A01H501U');
});

test('verificaAccessTokenPubblico rifiuta un token con audience "backoffice"', () => {
  const tokenBackoffice = jsonwebtoken.sign(
    { sub: 'x', codiceFiscale: 'X', nome: 'X', cognome: 'X' },
    process.env.JWT_SECRET as string,
    { algorithm: 'HS256', audience: 'backoffice' },
  );
  assert.throws(() => verificaAccessTokenPubblico(tokenBackoffice));
});

test('verificaAccessTokenPubblico rifiuta un token scaduto', () => {
  const tokenScaduto = jsonwebtoken.sign(
    { sub: 'x', codiceFiscale: 'X', nome: 'X', cognome: 'X', exp: Math.floor(Date.now() / 1000) - 10 },
    process.env.JWT_SECRET as string,
    { algorithm: 'HS256', audience: 'pubblico' },
  );
  assert.throws(() => verificaAccessTokenPubblico(tokenScaduto));
});
