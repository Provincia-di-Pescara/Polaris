import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from './password.ts';
import { eseguiLogin, eseguiLogout } from './login.ts';
import { eseguiLogoutPubblico } from './loginPubblico.ts';
import { generaRefreshToken, hashRefreshToken } from './refreshToken.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

test(
  'wiring audit log (art. B.39): login e logout scrivono log_operazioni',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    await t.test('login backoffice riuscito registra azione login con attore e ip', async () => {
      const email = `audit-wiring-${randomUUID()}@test.local`;
      const hash = await hashPassword('password-audit-123');
      const utente = await pool.query<{ id: string }>(
        `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
         VALUES ($1, $2, 'Audit', 'Wiring', 'operatore', 'attivo') RETURNING id`,
        [email, hash],
      );
      const utenteId = utente.rows[0]!.id;

      await eseguiLogin(pool, email, 'password-audit-123', '192.168.7.7');

      const log = await pool.query(
        `SELECT azione, ruolo, host(ip_address) AS ip FROM log_operazioni
         WHERE utente_backoffice_id = $1 AND azione = 'login'`,
        [utenteId],
      );
      assert.equal(log.rows.length, 1);
      assert.equal(log.rows[0]!.ruolo, 'operatore');
      assert.equal(log.rows[0]!.ip, '192.168.7.7');
    });

    await t.test('login backoffice fallito NON scrive log_operazioni (resta solo in tentativi_login_backoffice)', async () => {
      const email = `audit-wiring-fail-${randomUUID()}@test.local`;
      await assert.rejects(eseguiLogin(pool, email, 'password-qualunque', null));
      const log = await pool.query(`SELECT 1 FROM log_operazioni WHERE azione = 'login' AND dettaglio->>'email' = $1`, [
        email,
      ]);
      assert.equal(log.rows.length, 0);
    });

    await t.test('logout backoffice registra azione logout', async () => {
      const email = `audit-wiring-logout-${randomUUID()}@test.local`;
      const hash = await hashPassword('password-audit-123');
      const utente = await pool.query<{ id: string }>(
        `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
         VALUES ($1, $2, 'Audit', 'Logout', 'admin', 'attivo') RETURNING id`,
        [email, hash],
      );
      const utenteId = utente.rows[0]!.id;

      const esito = await eseguiLogin(pool, email, 'password-audit-123', null);
      await eseguiLogout(pool, esito.refreshToken);

      const log = await pool.query(
        `SELECT ruolo FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'logout'`,
        [utenteId],
      );
      assert.equal(log.rows.length, 1);
      assert.equal(log.rows[0]!.ruolo, 'admin');
    });

    await t.test('logout pubblico registra azione logout con persona fisica', async () => {
      const cf = `AUDLG${randomUUID().replaceAll('-', '').slice(0, 11).toUpperCase()}`;
      const persona = await pool.query<{ id: string }>(
        `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_provider, oidc_subject)
         VALUES ($1, 'Audit', 'LogoutPubblico', 'spid', $2) RETURNING id`,
        [cf, `audit-logout-${randomUUID()}`],
      );
      const personaId = persona.rows[0]!.id;
      const refreshToken = generaRefreshToken();
      await pool.query(
        `INSERT INTO sessioni_persona_fisica (persona_fisica_id, refresh_token_hash, scade_il)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [personaId, hashRefreshToken(refreshToken)],
      );

      await eseguiLogoutPubblico(pool, refreshToken);

      const log = await pool.query(`SELECT azione FROM log_operazioni WHERE persona_fisica_id = $1 AND azione = 'logout'`, [
        personaId,
      ]);
      assert.equal(log.rows.length, 1);
    });
  },
);
