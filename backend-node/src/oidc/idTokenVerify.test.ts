import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import jsonwebtoken from 'jsonwebtoken';
import { verificaIdToken } from './idTokenVerify.ts';

const KID = 'chiave-test-1';
const ISSUER = 'https://idp-test.invalid';
const AUDIENCE = 'client-test';

function generaCoppiaChiavi() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

async function avviaServerJwks(publicKeyJwk: Record<string, unknown>): Promise<{ server: Server; jwksUri: string }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [{ ...publicKeyJwk, kid: KID, use: 'sig', alg: 'RS256' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('indirizzo server mock non disponibile');
  }
  return { server, jwksUri: `http://127.0.0.1:${address.port}/jwks` };
}

async function avviaServerJwksMultiChiave(jwks: Array<Record<string, unknown>>): Promise<{ server: Server; jwksUri: string }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: jwks }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('indirizzo server mock non disponibile');
  }
  return { server, jwksUri: `http://127.0.0.1:${address.port}/jwks` };
}

test('verificaIdToken accetta un id_token firmato correttamente con la chiave JWKS', async () => {
  const { publicKey, privateKey } = generaCoppiaChiavi();
  const jwk = publicKey.export({ format: 'jwk' });
  const { server, jwksUri } = await avviaServerJwks(jwk as Record<string, unknown>);

  try {
    const token = jsonwebtoken.sign({ sub: 'utente-1', fiscal_number: 'TINIT-RSSMRA80A01H501U' }, privateKey, {
      algorithm: 'RS256',
      keyid: KID,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: '5m',
    });

    const payload = await verificaIdToken(token, jwksUri, ISSUER, AUDIENCE);
    assert.equal(payload['sub'], 'utente-1');
    assert.equal(payload['fiscal_number'], 'TINIT-RSSMRA80A01H501U');
  } finally {
    server.close();
  }
});

test('verificaIdToken rifiuta un token con issuer diverso da quello atteso', async () => {
  const { publicKey, privateKey } = generaCoppiaChiavi();
  const jwk = publicKey.export({ format: 'jwk' });
  const { server, jwksUri } = await avviaServerJwks(jwk as Record<string, unknown>);

  try {
    const token = jsonwebtoken.sign({ sub: 'utente-1' }, privateKey, {
      algorithm: 'RS256',
      keyid: KID,
      issuer: 'https://issuer-sbagliato.invalid',
      audience: AUDIENCE,
    });
    await assert.rejects(() => verificaIdToken(token, jwksUri, ISSUER, AUDIENCE));
  } finally {
    server.close();
  }
});

test('verificaIdToken rifiuta un token con audience diversa da quella attesa', async () => {
  const { publicKey, privateKey } = generaCoppiaChiavi();
  const jwk = publicKey.export({ format: 'jwk' });
  const { server, jwksUri } = await avviaServerJwks(jwk as Record<string, unknown>);

  try {
    const token = jsonwebtoken.sign({ sub: 'utente-1' }, privateKey, {
      algorithm: 'RS256',
      keyid: KID,
      issuer: ISSUER,
      audience: 'altro-client',
    });
    await assert.rejects(() => verificaIdToken(token, jwksUri, ISSUER, AUDIENCE));
  } finally {
    server.close();
  }
});

test('verificaIdToken rifiuta un token firmato con una chiave diversa da quella pubblicata nel JWKS (firma non valida)', async () => {
  const { publicKey } = generaCoppiaChiavi();
  const { privateKey: chiavePrivataAliena } = generaCoppiaChiavi(); // un'altra coppia
  const jwk = publicKey.export({ format: 'jwk' });
  const { server, jwksUri } = await avviaServerJwks(jwk as Record<string, unknown>);

  try {
    const tokenFalsificato = jsonwebtoken.sign({ sub: 'attaccante' }, chiavePrivataAliena, {
      algorithm: 'RS256',
      keyid: KID, // dichiara lo stesso kid, ma la chiave pubblica nel JWKS non corrisponde
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    await assert.rejects(() => verificaIdToken(tokenFalsificato, jwksUri, ISSUER, AUDIENCE));
  } finally {
    server.close();
  }
});

// Comportamento reale osservato contro pa-sso-proxy in produzione (2026-08-24):
// id_token senza kid nell'header. Legittimo quando il JWKS pubblica una sola
// chiave -- jwks-rsa lo gestisce nativamente in getSigningKey(undefined),
// prima bloccato qui prima ancora di interpellare la libreria.
test('verificaIdToken accetta un id_token SENZA kid nell\'header se il JWKS pubblica una sola chiave', async () => {
  const { publicKey, privateKey } = generaCoppiaChiavi();
  const jwk = publicKey.export({ format: 'jwk' });
  const { server, jwksUri } = await avviaServerJwks(jwk as Record<string, unknown>);

  try {
    // Nessun keyid passato a jsonwebtoken.sign: l'header del token non conterrà "kid".
    const token = jsonwebtoken.sign({ sub: 'utente-1' }, privateKey, {
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: '5m',
    });

    const payload = await verificaIdToken(token, jwksUri, ISSUER, AUDIENCE);
    assert.equal(payload['sub'], 'utente-1');
  } finally {
    server.close();
  }
});

test('verificaIdToken rifiuta un id_token senza kid se il JWKS pubblica PIÙ di una chiave (ambiguo)', async () => {
  const { publicKey: chiave1, privateKey: privata1 } = generaCoppiaChiavi();
  const { publicKey: chiave2 } = generaCoppiaChiavi();
  const jwks = [
    { ...(chiave1.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'kid-1', use: 'sig', alg: 'RS256' },
    { ...(chiave2.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'kid-2', use: 'sig', alg: 'RS256' },
  ];
  const { server, jwksUri } = await avviaServerJwksMultiChiave(jwks);

  try {
    const token = jsonwebtoken.sign({ sub: 'utente-1' }, privata1, {
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: '5m',
    });
    await assert.rejects(() => verificaIdToken(token, jwksUri, ISSUER, AUDIENCE));
  } finally {
    server.close();
  }
});

test('verificaIdToken rifiuta un token scaduto', async () => {
  const { publicKey, privateKey } = generaCoppiaChiavi();
  const jwk = publicKey.export({ format: 'jwk' });
  const { server, jwksUri } = await avviaServerJwks(jwk as Record<string, unknown>);

  try {
    const tokenScaduto = jsonwebtoken.sign(
      { sub: 'utente-1', exp: Math.floor(Date.now() / 1000) - 60 },
      privateKey,
      { algorithm: 'RS256', keyid: KID, issuer: ISSUER, audience: AUDIENCE },
    );
    await assert.rejects(() => verificaIdToken(tokenScaduto, jwksUri, ISSUER, AUDIENCE));
  } finally {
    server.close();
  }
});
