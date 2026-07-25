import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import jsonwebtoken from 'jsonwebtoken';
import { scriviConfigOidc } from '../oidc/config.ts';
import { costruisciUrlAutorizzazione } from '../oidc/flow.ts';
import { eseguiCallbackOidc, eseguiLogoutPubblico, eseguiRefreshPubblico } from './loginPubblico.ts';
import { ErroreRefreshTokenNonValido } from './errori.ts';
import { ErroreStatoNonValido } from '../oidc/flow.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

const KID = 'mock-idp-key-1';
const CLIENT_ID = 'polaris-test-client';
const CLIENT_SECRET = 'polaris-test-secret';

interface MockIdp {
  server: Server;
  issuer: string;
  redirectUri: string;
  privateKey: KeyObject;
  // per verificare che il nostro client mandi davvero client_secret_basic e non il secret nel body
  ultimoHeaderAuthorization: () => string | undefined;
  ultimoBodyToken: () => URLSearchParams | undefined;
  // per far restituire un id_token con claim persona specifici
  impostaClaimPersona: (claim: Record<string, unknown>) => void;
  impostaSub: (sub: string) => void;
}

async function avviaMockIdp(): Promise<MockIdp> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;

  let issuer = '';
  let ultimoAuth: string | undefined;
  let ultimoBody: URLSearchParams | undefined;
  let subCorrente = 'oidc-subject-1';
  let claimPersona: Record<string, unknown> = {
    fiscal_number: 'TINIT-RSSMRA80A01H501U',
    given_name: 'Mario',
    family_name: 'Rossi',
  };

  const server = createServer(async (req, res) => {
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
      ultimoAuth = req.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      ultimoBody = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));

      // pa-sso-proxy reale: rifiuta il secret nel body con 401 HTML — replichiamo lo
      // stesso comportamento per verificare che il nostro client non lo faccia mai.
      const haCredenzialiNelBody = ultimoBody.has('client_secret');
      const atteso = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
      if (haCredenzialiNelBody || ultimoAuth !== atteso) {
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

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('indirizzo server mock non disponibile');
  }
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    server,
    issuer,
    redirectUri: 'http://frontend-pubblico.invalid/callback',
    privateKey,
    ultimoHeaderAuthorization: () => ultimoAuth,
    ultimoBodyToken: () => ultimoBody,
    impostaClaimPersona: (claim) => {
      claimPersona = claim;
    },
    impostaSub: (sub) => {
      subCorrente = sub;
    },
  };
}

test(
  'ciclo OIDC completo: authorize -> callback -> refresh -> logout, contro Postgres reale e IdP mock',
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
      redirectUri: idp.redirectUri,
    });

    await t.test('costruisciUrlAutorizzazione produce un URL con PKCE e state', async () => {
      const { url: urlAutorizzazione } = await costruisciUrlAutorizzazione(pool);
      const url = new URL(urlAutorizzazione);
      assert.equal(url.origin + url.pathname, `${idp.issuer}/OIDC/authorization`);
      assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(url.searchParams.get('state'));
      assert.ok(url.searchParams.get('code_challenge'));
    });

    await t.test('callback con state valido crea la persona fisica e restituisce i token', async () => {
      const { url: urlAutorizzazione } = await costruisciUrlAutorizzazione(pool);
      const url = new URL(urlAutorizzazione);
      const state = url.searchParams.get('state');
      assert.ok(state);

      const esito = await eseguiCallbackOidc(pool, 'authorization-code-di-prova', state, '127.0.0.1');

      assert.ok(esito.accessToken);
      assert.ok(esito.refreshToken);
      assert.equal(esito.persona.codiceFiscale, 'RSSMRA80A01H501U');
      assert.equal(esito.persona.nome, 'Mario');
      assert.equal(esito.persona.cognome, 'Rossi');

      // verifica che il nostro client abbia usato client_secret_basic, non il body
      // (vincolo reale di pa-sso-proxy, vedi CLAUDE.md)
      assert.ok(idp.ultimoHeaderAuthorization()?.startsWith('Basic '));
      assert.equal(idp.ultimoBodyToken()?.has('client_secret'), false);
      assert.equal(idp.ultimoBodyToken()?.get('code_verifier') !== undefined, true);
    });

    await t.test('stesso state riusato una seconda volta viene rifiutato (consumo one-shot)', async () => {
      const { url: urlAutorizzazione } = await costruisciUrlAutorizzazione(pool);
      const url = new URL(urlAutorizzazione);
      const state = url.searchParams.get('state');
      assert.ok(state);

      await eseguiCallbackOidc(pool, 'code-1', state, '127.0.0.1');
      await assert.rejects(() => eseguiCallbackOidc(pool, 'code-2', state, '127.0.0.1'), ErroreStatoNonValido);
    });

    await t.test('login ripetuto con lo stesso oidc_subject riusa la stessa persona fisica', async () => {
      idp.impostaClaimPersona({
        fiscal_number: 'TINIT-VRDLGU75B02H501Z',
        given_name: 'Luigi',
        family_name: 'Verdi',
      });

      const { url: urlAutorizzazione1 } = await costruisciUrlAutorizzazione(pool);
      const url1 = new URL(urlAutorizzazione1);
      const esito1 = await eseguiCallbackOidc(pool, 'code-a', url1.searchParams.get('state') as string, '127.0.0.1');

      const { url: urlAutorizzazione2 } = await costruisciUrlAutorizzazione(pool);
      const url2 = new URL(urlAutorizzazione2);
      const esito2 = await eseguiCallbackOidc(pool, 'code-b', url2.searchParams.get('state') as string, '127.0.0.1');

      assert.equal(esito1.persona.id, esito2.persona.id);
    });

    await t.test('REGRESSIONE: stesso codice fiscale con oidc_subject diverso aggiorna la persona esistente, non fallisce', async () => {
      // scenario reale: la stessa persona si autentica una volta via SPID e un'altra
      // via CIE (o pa-sso-proxy emette comunque sub diversi tra sessioni) — il
      // codice fiscale resta l'identità stabile, il sub no. Bug trovato con smoke
      // test HTTP reale (vedi commento in repository/personeFisiche.ts).
      idp.impostaClaimPersona({
        fiscal_number: 'TINIT-FRRPLA88E10H501W',
        given_name: 'Paola',
        family_name: 'Ferrari',
      });
      idp.impostaSub('sub-sessione-1');
      const { url: urlAutorizzazione1 } = await costruisciUrlAutorizzazione(pool);
      const url1 = new URL(urlAutorizzazione1);
      const esito1 = await eseguiCallbackOidc(pool, 'code-cf-a', url1.searchParams.get('state') as string, '127.0.0.1');

      idp.impostaSub('sub-sessione-2-diverso');
      const { url: urlAutorizzazione2 } = await costruisciUrlAutorizzazione(pool);
      const url2 = new URL(urlAutorizzazione2);
      const esito2 = await eseguiCallbackOidc(pool, 'code-cf-b', url2.searchParams.get('state') as string, '127.0.0.1');

      assert.equal(esito1.persona.id, esito2.persona.id);
      assert.equal(esito2.persona.codiceFiscale, 'FRRPLA88E10H501W');
    });

    await t.test('refresh emette nuovi token e invalida il vecchio (rotation)', async () => {
      idp.impostaClaimPersona({
        fiscal_number: 'TINIT-BNCLRA85C03H501X',
        given_name: 'Laura',
        family_name: 'Bianchi',
      });
      const { url: urlAutorizzazione } = await costruisciUrlAutorizzazione(pool);
      const url = new URL(urlAutorizzazione);
      const login = await eseguiCallbackOidc(pool, 'code-refresh', url.searchParams.get('state') as string, '127.0.0.1');

      const dopoRefresh = await eseguiRefreshPubblico(pool, login.refreshToken, '127.0.0.1');
      assert.notEqual(dopoRefresh.refreshToken, login.refreshToken);

      await assert.rejects(() => eseguiRefreshPubblico(pool, login.refreshToken, '127.0.0.1'), ErroreRefreshTokenNonValido);
    });

    await t.test('logout revoca il refresh token', async () => {
      idp.impostaClaimPersona({
        fiscal_number: 'TINIT-VRDGPP90D04H501Y',
        given_name: 'Giuseppe',
        family_name: 'Verdi',
      });
      const { url: urlAutorizzazione } = await costruisciUrlAutorizzazione(pool);
      const url = new URL(urlAutorizzazione);
      const login = await eseguiCallbackOidc(pool, 'code-logout', url.searchParams.get('state') as string, '127.0.0.1');

      await eseguiLogoutPubblico(pool, login.refreshToken);

      await assert.rejects(() => eseguiRefreshPubblico(pool, login.refreshToken, '127.0.0.1'), ErroreRefreshTokenNonValido);
    });
  },
);
