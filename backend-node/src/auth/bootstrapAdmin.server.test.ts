import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { creaApp } from '../server.ts';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';
import type { Email } from '../email/smtp.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

test(
  'endpoint HTTP bootstrap primo admin (server vero, DB dedicato)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
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
    t.after(async () => {
      server.close();
      await distruggi();
    });

    await t.test('stato: disponibile quando non esistono utenti', async () => {
      const r = await fetch(`${base}/auth/bootstrap/stato`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { disponibile: true });
    });

    await t.test('richiesta valida: 204, email con link inviata', async () => {
      const r = await fetch(`${base}/auth/bootstrap/primo-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'wizard@provincia.test',
          password: 'password-wizard-lunga-123',
          nome: 'Wizard',
          cognome: 'Test',
        }),
      });
      assert.equal(r.status, 204);
      assert.equal(emailInviate.length, 1);
      assert.ok(emailInviate[0]!.testo.includes('https://backoffice.test/bootstrap/verifica?token='));
    });

    await t.test('verifica con token della email: 200, account attivo, login funziona', async () => {
      const token = emailInviate[0]!.testo.match(/token=([a-f0-9]{64})/)![1]!;
      const r = await fetch(`${base}/auth/bootstrap/verifica`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { email: 'wizard@provincia.test' });

      const login = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'wizard@provincia.test', password: 'password-wizard-lunga-123' }),
      });
      assert.equal(login.status, 200);
    });

    await t.test('a bootstrap completato: stato non disponibile, nuova richiesta 409', async () => {
      const stato = await fetch(`${base}/auth/bootstrap/stato`);
      assert.deepEqual(await stato.json(), { disponibile: false });

      const r = await fetch(`${base}/auth/bootstrap/primo-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'altro@provincia.test',
          password: 'password-wizard-lunga-123',
          nome: 'Altro',
          cognome: 'Admin',
        }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('token non valido: 401', async () => {
      const r = await fetch(`${base}/auth/bootstrap/verifica`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'b'.repeat(64) }),
      });
      assert.equal(r.status, 401);
    });

    await t.test('body malformato: 400', async () => {
      const r = await fetch(`${base}/auth/bootstrap/primo-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'non-email', password: 'corta' }),
      });
      assert.equal(r.status, 400);
    });
  },
);

test(
  'bootstrap senza SMTP configurato: 503',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    // pool sul DB condiviso: questo ramo non tocca utenti_backoffice (fallisce prima)
    const pool = new Pool({ connectionString: dsn });
    const app = creaApp(pool); // nessuna dipendenza email iniettata, niente SMTP_HOST
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    t.after(async () => {
      server.close();
      await pool.end();
    });

    const r = await fetch(`${base}/auth/bootstrap/primo-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'x@provincia.test',
        password: 'password-wizard-lunga-123',
        nome: 'X',
        cognome: 'Y',
      }),
    });
    assert.equal(r.status, 503);
  },
);
