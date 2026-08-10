import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { hashPassword } from './auth/password.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaUtenteTest(
  pool: Pool,
  opzioni: { email: string; password: string; stato?: 'attivo' | 'disattivato' },
): Promise<void> {
  const hash = await hashPassword(opzioni.password);
  await pool.query(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Hardening', 'operatore', $3)`,
    [opzioni.email, hash, opzioni.stato ?? 'attivo'],
  );
}

async function login(base: string, email: string, password: string): Promise<Response> {
  return fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

test('helmet: risposta include header di sicurezza standard', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const r = await fetch(`${base}/healthz`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('cors: origine in allowlist riceve Access-Control-Allow-Origin', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://esempio-consentito.test';
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente === undefined) { delete process.env.CORS_ALLOWED_ORIGINS; } else { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://esempio-consentito.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://esempio-consentito.test');
});

test('cors: origine NON in allowlist non riceve Access-Control-Allow-Origin', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://esempio-consentito.test';
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente === undefined) { delete process.env.CORS_ALLOWED_ORIGINS; } else { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://non-consentito.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('cors: nessuna CORS_ALLOWED_ORIGINS configurata, nessuna origine riceve il header', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.CORS_ALLOWED_ORIGINS;
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente !== undefined) { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://qualsiasi.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

// Nota: limitatoreLogin (10 tentativi/15min) è un singleton a livello di modulo, condiviso da
// tutte le app create in QUESTO file di test (stesso IP client) — le due verifiche sotto
// condividono lo stesso ciclo di 5 tentativi falliti invece di rifarlo da capo, per restare
// sotto soglia (5 falliti + 2 verifiche = 7 richieste totali su /auth/login, < 10).
test('lockout HTTP: 6° tentativo su POST /auth/login risponde 401/account_bloccato; il gate precede il controllo di stato utente', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const email = `lockout-http-${randomUUID()}@test.local`;
  await creaUtenteTest(pool, { email, password: 'password-corretta-http-123' });

  // 5 tentativi falliti, sotto la soglia del rate limiter per-IP (10/15min) per non confondere i due meccanismi
  for (let i = 0; i < 5; i++) {
    const r = await login(base, email, 'password-sbagliata');
    assert.equal(r.status, 401);
  }

  await t.test('6° tentativo (Important 3a): 401 e account_bloccato registrato', async () => {
    const rBloccato = await login(base, email, 'password-corretta-http-123');
    assert.equal(rBloccato.status, 401);

    const tentativo = await pool.query(
      `SELECT esito FROM tentativi_login_backoffice WHERE email_tentata = $1 ORDER BY avvenuto_il DESC LIMIT 1`,
      [email],
    );
    assert.equal(tentativo.rows[0]?.esito, 'account_bloccato');
  });

  await t.test('7° tentativo, utente ora disattivato (Important 3b): resta 401/account_bloccato, non 403/utente_disattivato', async () => {
    await pool.query(`UPDATE utenti_backoffice SET stato = 'disattivato' WHERE email = $1`, [email]);

    // se il gate di lockout precede il controllo di stato (ordine corretto in eseguiLogin),
    // risponde ancora 401/account_bloccato invece di 403/utente_disattivato
    const rBloccatoDisattivato = await login(base, email, 'password-corretta-http-123');
    assert.equal(rBloccatoDisattivato.status, 401);

    const tentativo = await pool.query(
      `SELECT esito FROM tentativi_login_backoffice WHERE email_tentata = $1 ORDER BY avvenuto_il DESC LIMIT 1`,
      [email],
    );
    assert.equal(tentativo.rows[0]?.esito, 'account_bloccato');
  });
});
