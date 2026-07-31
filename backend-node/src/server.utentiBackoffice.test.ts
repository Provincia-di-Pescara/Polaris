import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { hashPassword } from './auth/password.ts';
import { generaAccessToken } from './auth/jwt.ts';
import type { Email } from './email/smtp.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

function estraiToken(email: Email): string {
  const m = email.testo.match(/token=([a-f0-9]{64})/);
  assert.ok(m, `nessun token nel corpo email: ${email.testo}`);
  return m[1]!;
}

test(
  'ciclo completo: invito -> accetta-invito -> login funziona; reset-password -> vecchia sessione revocata',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const emailInviate: Email[] = [];
    const app = creaApp(pool, {
      inviaEmail: async (e) => {
        emailInviate.push(e);
      },
      backofficeBaseUrl: 'https://backoffice.test',
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    t.after(() => {
      server.close();
      return pool.end();
    });

    const emailAdmin = `admin-reset-test-${randomUUID()}@test.local`;
    const hash = await hashPassword('password-admin-test-123456');
    const rAdmin = await pool.query<{ id: string }>(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, $2, 'Admin', 'Reset', 'admin', 'attivo') RETURNING id`,
      [emailAdmin, hash],
    );
    const adminToken = generaAccessToken({ sub: rAdmin.rows[0]!.id, email: emailAdmin, ruolo: 'admin' });

    const emailInvitato = `invitato-reset-test-${randomUUID()}@test.local`;

    await t.test('crea invito, estrai token, completa invito, login funziona', async () => {
      const rInvito = await fetch(`${base}/backoffice/utenti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ email: emailInvitato, nome: 'Invitato', cognome: 'Test', ruolo: 'operatore' }),
      });
      assert.equal(rInvito.status, 201);
      assert.equal(emailInviate.length, 1);
      const token = estraiToken(emailInviate[0]!);

      const rAccetta = await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'password-invitato-123456' }),
      });
      assert.equal(rAccetta.status, 200);

      const rLogin = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInvitato, password: 'password-invitato-123456' }),
      });
      assert.equal(rLogin.status, 200);
    });

    await t.test('token già usato: 400/401 al riuso', async () => {
      const rInvito = await fetch(`${base}/backoffice/utenti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ email: `secondo-${emailInvitato}`, nome: 'X', cognome: 'Y', ruolo: 'operatore' }),
      });
      const token = estraiToken(emailInviate[emailInviate.length - 1]!);
      await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'password-una-volta-123456' }),
      });
      const riuso = await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'altra-password-123456' }),
      });
      assert.equal(riuso.status, 400);
      void rInvito;
    });

    await t.test('operatore: 403 su reset-password altrui', async () => {
      const rLoginInvitato = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInvitato, password: 'password-invitato-123456' }),
      });
      const { accessToken } = (await rLoginInvitato.json()) as { accessToken: string };
      const r = await fetch(`${base}/backoffice/utenti/${rAdmin.rows[0]!.id}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      assert.equal(r.status, 403);
    });

    await t.test('admin richiede reset password per l\'invitato: nuova email, vecchie sessioni revocate', async () => {
      const rLoginInvitato = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInvitato, password: 'password-invitato-123456' }),
      });
      const { refreshToken: refreshVecchio } = (await rLoginInvitato.json()) as { refreshToken: string };

      const utenteInvitato = await pool.query<{ id: string }>('SELECT id FROM utenti_backoffice WHERE email = $1', [emailInvitato]);
      const rReset = await fetch(`${base}/backoffice/utenti/${utenteInvitato.rows[0]!.id}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(rReset.status, 200);

      const rRefresh = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshVecchio }),
      });
      assert.equal(rRefresh.status, 401, 'il refresh token emesso prima del reset deve risultare revocato');

      const token = estraiToken(emailInviate[emailInviate.length - 1]!);
      const rNuovoAccesso = await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'password-dopo-reset-123456' }),
      });
      assert.equal(rNuovoAccesso.status, 200);
    });

    await t.test('reset-password su id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/utenti/${randomUUID()}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('accetta-invito con token malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'non-esadecimale', password: 'password-lunga-123456' }),
      });
      assert.equal(r.status, 400);
    });
  },
);
