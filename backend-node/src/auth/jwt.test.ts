import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsonwebtoken from 'jsonwebtoken';
import { generaAccessToken, verificaAccessToken } from './jwt.ts';

process.env.JWT_SECRET = 'segreto-di-test-non-usare-in-produzione';

test('generaAccessToken + verificaAccessToken: roundtrip corretto', () => {
  const token = generaAccessToken({ sub: 'utente-1', email: 'a@example.com', ruolo: 'admin' });
  const payload = verificaAccessToken(token);
  assert.equal(payload.sub, 'utente-1');
  assert.equal(payload.email, 'a@example.com');
  assert.equal(payload.ruolo, 'admin');
});

test('verificaAccessToken rifiuta un token firmato con segreto diverso', () => {
  const tokenAlieno = jsonwebtoken.sign({ sub: 'x', email: 'x@example.com', ruolo: 'admin' }, 'altro-segreto', {
    algorithm: 'HS256',
  });
  assert.throws(() => verificaAccessToken(tokenAlieno));
});

test('verificaAccessToken rifiuta un token scaduto', () => {
  const tokenScaduto = jsonwebtoken.sign(
    { sub: 'x', email: 'x@example.com', ruolo: 'admin', exp: Math.floor(Date.now() / 1000) - 10 },
    process.env.JWT_SECRET as string,
    { algorithm: 'HS256' },
  );
  assert.throws(() => verificaAccessToken(tokenScaduto));
});

test('verificaAccessToken rifiuta un token con algoritmo diverso da HS256', () => {
  // alg=none è il classico attacco di algorithm confusion: verificaAccessToken deve
  // pinnare esplicitamente l'algoritmo atteso, non fidarsi di quello nell'header del token.
  const tokenAlgNone = jsonwebtoken.sign({ sub: 'x', email: 'x@example.com', ruolo: 'admin' }, null, {
    algorithm: 'none',
  });
  assert.throws(() => verificaAccessToken(tokenAlgNone));
});
