import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { Pool } from 'pg';
import jsonwebtoken from 'jsonwebtoken';
import { creaApp } from './server.ts';
import { scriviConfigOidc } from './oidc/config.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';
// redirectUri non è più un campo di scriviConfigOidc: è calcolato da questa var
// (vedi oidc/config.ts:redirectUriOidc) — il mock IdP sotto non ne valida il
// valore, serve solo perché costruisciUrlAutorizzazione/scambiaCode falliscono
// con ErroreOidcNonConfigurato se assente.
process.env.FRONTEND_PUBBLICO_BASE_URL ??= 'http://frontend-pubblico.invalid';

const KID = 'server-test-idp-key';
const CLIENT_ID = 'polaris-server-test';
const CLIENT_SECRET = 'polaris-server-test-secret';

async function avviaMockIdp(): Promise<{ server: Server; issuer: string }> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  let issuer = '';

  const server = createServer((req, res) => {
    if (req.url === '/.well-known/openid-configuration') {
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
    if (req.url === '/OIDC/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] }));
      return;
    }
    if (req.url === '/OIDC/token' && req.method === 'POST') {
      const idToken = jsonwebtoken.sign(
        { sub: 'server-test-subject', fiscal_number: 'TINIT-RSSMRA80A01H501U', given_name: 'Mario', family_name: 'Rossi' },
        privateKey,
        { algorithm: 'RS256', keyid: KID, issuer, audience: CLIENT_ID, expiresIn: '5m' },
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id_token: idToken }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('indirizzo server mock non disponibile');
  }
  issuer = `http://127.0.0.1:${address.port}`;
  return { server, issuer };
}

function estraiCookie(setCookieHeader: string | null, nome: string): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${nome}=([^;]+)`));
  return match ? (match[1] ?? null) : null;
}

test(
  'protezione login-CSRF: /auth/oidc/callback richiede il cookie di binding legato allo state',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const idp = await avviaMockIdp();
    t.after(() => idp.server.close());

    await scriviConfigOidc(pool, {
      issuer: idp.issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const app = creaApp(pool);
    const httpServer = app.listen(0);
    t.after(() => httpServer.close());
    const address = httpServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('indirizzo server non disponibile');
    }
    const base = `http://127.0.0.1:${address.port}`;

    await t.test('GET /auth/oidc/start imposta il cookie oidc_state (HttpOnly, path scoped)', async () => {
      const res = await fetch(`${base}/auth/oidc/start`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie);
      assert.match(setCookie, /oidc_state=/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /Path=\/auth\/oidc/i);
    });

    await t.test('callback SENZA il cookie di binding viene rifiutato (simula login CSRF)', async () => {
      // simula l'attaccante: prende un authorization_url reale (quindi uno state reale,
      // salvato in DB), ma il browser della vittima non ha mai visitato /auth/oidc/start
      // (nessun cookie), esattamente come nell'attacco descritto nel finding.
      const startRes = await fetch(`${base}/auth/oidc/start`, { redirect: 'manual' });
      const location = startRes.headers.get('location');
      assert.ok(location);
      const state = new URL(location).searchParams.get('state');
      assert.ok(state);

      const callbackRes = await fetch(`${base}/auth/oidc/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, // niente header Cookie
        body: JSON.stringify({ code: 'code-attaccante', state }),
      });
      assert.equal(callbackRes.status, 401);
    });

    await t.test('callback con cookie che NON combacia con lo state viene rifiutato', async () => {
      const start1 = await fetch(`${base}/auth/oidc/start`, { redirect: 'manual' });
      const cookie1 = estraiCookie(start1.headers.get('set-cookie'), 'oidc_state');
      assert.ok(cookie1);

      const start2 = await fetch(`${base}/auth/oidc/start`, { redirect: 'manual' });
      const location2 = start2.headers.get('location');
      assert.ok(location2);
      const state2 = new URL(location2).searchParams.get('state');
      assert.ok(state2);

      // cookie della PRIMA richiesta (sessione A) usato per completare lo state della
      // SECONDA (sessione B) — devono essere trattati come sessioni diverse, rifiutato.
      const callbackRes = await fetch(`${base}/auth/oidc/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `oidc_state=${cookie1}` },
        body: JSON.stringify({ code: 'code-qualsiasi', state: state2 }),
      });
      assert.equal(callbackRes.status, 401);
    });

    await t.test('callback con cookie corrispondente allo state completa il login', async () => {
      const startRes = await fetch(`${base}/auth/oidc/start`, { redirect: 'manual' });
      const cookie = estraiCookie(startRes.headers.get('set-cookie'), 'oidc_state');
      assert.ok(cookie);
      const location = startRes.headers.get('location');
      assert.ok(location);
      const state = new URL(location).searchParams.get('state');
      assert.ok(state);

      const callbackRes = await fetch(`${base}/auth/oidc/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `oidc_state=${cookie}` },
        body: JSON.stringify({ code: 'code-legittimo', state }),
      });
      assert.equal(callbackRes.status, 200);
      const body = (await callbackRes.json()) as { accessToken?: string };
      assert.ok(body.accessToken);
    });
  },
);
