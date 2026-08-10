import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { hashPassword } from './password.ts';
import { eseguiLogin, eseguiLogout, eseguiRefresh } from './login.ts';
import { ErroreCredenzialiNonValide, ErroreRefreshTokenNonValido, ErroreUtenteDisattivato } from './errori.ts';

const dsn = process.env.TEST_DATABASE_URL;
// suffisso per-esecuzione: i test devono restare rieseguibili su un DB locale persistente
const runId = randomUUID().slice(0, 8);
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function creaUtenteTest(
  pool: Pool,
  opzioni: { email: string; password: string; stato?: 'attivo' | 'disattivato'; ruolo?: 'admin' | 'operatore' },
): Promise<void> {
  const hash = await hashPassword(opzioni.password);
  await pool.query(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Login', $3, $4)`,
    [opzioni.email, hash, opzioni.ruolo ?? 'operatore', opzioni.stato ?? 'attivo'],
  );
}

test(
  'ciclo completo login -> refresh -> logout contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    await t.test('login con credenziali corrette restituisce i token', async () => {
      await creaUtenteTest(pool, { email: `login-ok-${runId}@test.local`, password: 'password-corretta-123' });

      const esito = await eseguiLogin(pool, `login-ok-${runId}@test.local`, 'password-corretta-123', '127.0.0.1');
      assert.ok(esito.accessToken);
      assert.ok(esito.refreshToken);

      const tentativo = await pool.query(
        `SELECT esito FROM tentativi_login_backoffice WHERE email_tentata = $1 ORDER BY avvenuto_il DESC LIMIT 1`,
        [`login-ok-${runId}@test.local`],
      );
      assert.equal(tentativo.rows[0]?.esito, 'successo');
    });

    await t.test('login con password sbagliata viene rifiutato e registrato', async () => {
      await creaUtenteTest(pool, { email: `login-badpw-${runId}@test.local`, password: 'password-giusta' });

      await assert.rejects(
        () => eseguiLogin(pool, `login-badpw-${runId}@test.local`, 'password-sbagliata', '127.0.0.1'),
        ErroreCredenzialiNonValide,
      );

      const tentativo = await pool.query(
        `SELECT esito FROM tentativi_login_backoffice WHERE email_tentata = $1 ORDER BY avvenuto_il DESC LIMIT 1`,
        [`login-badpw-${runId}@test.local`],
      );
      assert.equal(tentativo.rows[0]?.esito, 'password_errata');
    });

    await t.test('login con email inesistente viene rifiutato con lo STESSO errore (no enumerazione)', async () => {
      await assert.rejects(
        () => eseguiLogin(pool, `non-esiste-${runId}@test.local`, 'qualsiasi', '127.0.0.1'),
        ErroreCredenzialiNonValide,
      );

      const tentativo = await pool.query(
        `SELECT esito, utente_backoffice_id FROM tentativi_login_backoffice WHERE email_tentata = $1 ORDER BY avvenuto_il DESC LIMIT 1`,
        [`non-esiste-${runId}@test.local`],
      );
      assert.equal(tentativo.rows[0]?.esito, 'utente_non_trovato');
      assert.equal(tentativo.rows[0]?.utente_backoffice_id, null);
    });

    await t.test('login con utente disattivato viene rifiutato', async () => {
      await creaUtenteTest(pool, { email: `login-disattivato-${runId}@test.local`, password: 'qualsiasi123', stato: 'disattivato' });

      await assert.rejects(
        () => eseguiLogin(pool, `login-disattivato-${runId}@test.local`, 'qualsiasi123', '127.0.0.1'),
        ErroreUtenteDisattivato,
      );
    });

    await t.test('lockout: 5 password errate consecutive bloccano il 6° tentativo anche con password corretta', async () => {
      const email = `login-lockout-${runId}@test.local`;
      await creaUtenteTest(pool, { email, password: 'password-corretta-lockout' });

      for (let i = 0; i < 5; i++) {
        await assert.rejects(() => eseguiLogin(pool, email, 'password-sbagliata', '127.0.0.1'), ErroreCredenzialiNonValide);
      }

      await assert.rejects(
        () => eseguiLogin(pool, email, 'password-corretta-lockout', '127.0.0.1'),
        ErroreCredenzialiNonValide,
      );

      const tentativo = await pool.query(
        `SELECT esito FROM tentativi_login_backoffice WHERE email_tentata = $1 ORDER BY avvenuto_il DESC LIMIT 1`,
        [email],
      );
      assert.equal(tentativo.rows[0]?.esito, 'account_bloccato');
    });

    await t.test('lockout: sotto soglia il login con password corretta funziona ancora', async () => {
      const email = `login-sotto-soglia-${runId}@test.local`;
      await creaUtenteTest(pool, { email, password: 'password-corretta-sottosoglia' });

      for (let i = 0; i < 4; i++) {
        await assert.rejects(() => eseguiLogin(pool, email, 'password-sbagliata', '127.0.0.1'), ErroreCredenzialiNonValide);
      }

      const esito = await eseguiLogin(pool, email, 'password-corretta-sottosoglia', '127.0.0.1');
      assert.ok(esito.accessToken);
    });

    await t.test('refresh valido emette nuovi token e invalida il vecchio refresh token (rotation)', async () => {
      await creaUtenteTest(pool, { email: `login-refresh-${runId}@test.local`, password: 'password-refresh' });
      const primoLogin = await eseguiLogin(pool, `login-refresh-${runId}@test.local`, 'password-refresh', '127.0.0.1');

      const secondoEsito = await eseguiRefresh(pool, primoLogin.refreshToken, '127.0.0.1');
      assert.ok(secondoEsito.accessToken);
      assert.notEqual(secondoEsito.refreshToken, primoLogin.refreshToken);

      // il refresh token originale è stato revocato dalla rotation: riusarlo deve fallire
      await assert.rejects(() => eseguiRefresh(pool, primoLogin.refreshToken, '127.0.0.1'), ErroreRefreshTokenNonValido);
    });

    await t.test('logout revoca il refresh token', async () => {
      await creaUtenteTest(pool, { email: `login-logout-${runId}@test.local`, password: 'password-logout' });
      const login = await eseguiLogin(pool, `login-logout-${runId}@test.local`, 'password-logout', '127.0.0.1');

      await eseguiLogout(pool, login.refreshToken);

      await assert.rejects(() => eseguiRefresh(pool, login.refreshToken, '127.0.0.1'), ErroreRefreshTokenNonValido);
    });

    await t.test('refresh con token inesistente viene rifiutato', async () => {
      await assert.rejects(() => eseguiRefresh(pool, 'token-mai-esistito', '127.0.0.1'), ErroreRefreshTokenNonValido);
    });
  },
);
