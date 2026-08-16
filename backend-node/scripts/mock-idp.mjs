#!/usr/bin/env node
// Mock IdP OIDC standalone (SPID/CIE) — SOLO per verifica manuale in locale.
//
// NON è incluso nella build/Docker: è un dev tool da lanciare a mano quando si
// vuole testare in browser il flusso di login pubblico end-to-end senza dover
// disporre di un vero pa-sso-proxy. Adatta la logica di `avviaMockIdp()` già
// scritta (e testata) in `backend-node/src/auth/loginPubblico.test.ts` — genera
// una coppia di chiavi RSA al volo, espone `/.well-known/openid-configuration`,
// `/OIDC/jwks`, `/OIDC/authorization` e `/OIDC/token`, e impone lo stesso
// vincolo del vero pa-sso-proxy: il client deve autenticarsi con
// `client_secret_basic` (header Authorization: Basic), MAI con il secret nel
// corpo della richiesta — altrimenti risponde 401.
//
// A differenza del test, questo script NON si chiude da solo: resta in ascolto
// finché non lo interrompi manualmente (Ctrl+C).
//
// Uso:
//   1. node scripts/mock-idp.mjs
//   2. Copia `issuer` / `clientId` / `clientSecret` stampati in console dentro
//      "Impostazioni OIDC" nel frontend backoffice (Task 7), insieme a:
//        redirectUri = http://localhost:5174/oidc/callback
//   3. Avvia il backend, il frontend backoffice e il frontend pubblico, poi
//      prova il login SPID/CIE dal frontend pubblico (http://localhost:5174).

import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import jsonwebtoken from 'jsonwebtoken';

const KID = 'mock-idp-key-1';
const CLIENT_ID = 'polaris-dev-client';
const CLIENT_SECRET = 'polaris-dev-secret';
const PORTA = Number(process.env.MOCK_IDP_PORT ?? 4600);

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });

let issuer = '';
let subCorrente = 'oidc-subject-dev-1';
let claimPersona = {
  fiscal_number: 'TINIT-RSSMRA80A01H501U',
  given_name: 'Mario',
  family_name: 'Rossi',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', issuer || `http://127.0.0.1:${PORTA}`);

  if (url.pathname === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/OIDC/authorization`,
        token_endpoint: `${issuer}/OIDC/token`,
        jwks_uri: `${issuer}/OIDC/jwks`,
      }),
    );
    return;
  }

  if (url.pathname === '/OIDC/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] }));
    return;
  }

  // Endpoint di autorizzazione: nel vero pa-sso-proxy qui l'utente si autentica
  // con SPID/CIE e dà il consenso. Qui simuliamo il consenso immediato:
  // reindirizziamo subito al redirect_uri del client con un code fittizio.
  if (url.pathname === '/OIDC/authorization' && req.method === 'GET') {
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    if (!redirectUri) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('redirect_uri mancante');
      return;
    }
    const dest = new URL(redirectUri);
    dest.searchParams.set('code', 'mock-authorization-code');
    if (state) dest.searchParams.set('state', state);
    res.writeHead(302, { Location: dest.toString() });
    res.end();
    return;
  }

  if (url.pathname === '/OIDC/token' && req.method === 'POST') {
    const authHeader = req.headers.authorization;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));

    // Stesso vincolo del vero pa-sso-proxy: rifiuta il client_secret nel body,
    // richiede client_secret_basic nell'header Authorization.
    const haCredenzialiNelBody = body.has('client_secret');
    const atteso = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
    if (haCredenzialiNelBody || authHeader !== atteso) {
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end('<html><body>Unauthorized</body></html>');
      return;
    }

    const idToken = jsonwebtoken.sign({ sub: subCorrente, ...claimPersona }, privateKey, {
      algorithm: 'RS256',
      keyid: KID,
      issuer,
      audience: CLIENT_ID,
      expiresIn: '5m',
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id_token: idToken, access_token: 'access-token-non-usato' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('non trovato');
});

server.listen(PORTA, '127.0.0.1', () => {
  const address = server.address();
  const porta = typeof address === 'object' && address !== null ? address.port : PORTA;
  issuer = `http://127.0.0.1:${porta}`;

  console.log('');
  console.log('=== Mock IdP OIDC (SPID/CIE) avviato ===');
  console.log('');
  console.log(`issuer:       ${issuer}`);
  console.log(`clientId:     ${CLIENT_ID}`);
  console.log(`clientSecret: ${CLIENT_SECRET}`);
  console.log(`redirectUri:  http://localhost:5174/oidc/callback`);
  console.log('');
  console.log('Persona simulata restituita al login (modificabile solo modificando questo script):');
  console.log(`  fiscal_number: ${claimPersona.fiscal_number}`);
  console.log(`  given_name:    ${claimPersona.given_name}`);
  console.log(`  family_name:   ${claimPersona.family_name}`);
  console.log('');
  console.log('Incolla issuer/clientId/clientSecret/redirectUri in "Impostazioni OIDC" nel');
  console.log('frontend backoffice, poi prova il login dal frontend pubblico.');
  console.log('');
  console.log('Premi Ctrl+C per interrompere.');
  console.log('');
});

function chiudi() {
  console.log('\nArresto mock IdP…');
  server.close(() => process.exit(0));
}

process.on('SIGINT', chiudi);
process.on('SIGTERM', chiudi);
