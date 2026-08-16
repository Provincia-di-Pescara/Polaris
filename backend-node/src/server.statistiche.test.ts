import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: import('pg').Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteTest(pool: import('pg').Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `statistiche-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Statistiche', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

async function creaStagioneTest(base: string, token: string): Promise<string> {
  const r = await fetch(`${base}/backoffice/stagioni`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nome: `Stagione statistiche route ${randomUUID()}`, dataInizio: '2033-09-01', dataFine: '2034-06-30' }),
  });
  const { id } = (await r.json()) as { id: string };
  return id;
}

test(
  'GET /backoffice/stagioni/:id/statistiche',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteTest(pool, 'admin');
    const operatore = await creaUtenteTest(pool, 'operatore');

    await t.test('401 senza token', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${randomUUID()}/statistiche`);
      assert.equal(r.status, 401);
    });

    await t.test('404 su stagione inesistente', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${randomUUID()}/statistiche`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('400 su id malformato', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/non-un-uuid/statistiche`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 400);
    });

    await t.test('200 con shape della risposta su stagione vuota (admin)', async () => {
      const stagioneId = await creaStagioneTest(base, admin.token);
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/statistiche`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as {
        tassoUtilizzoImpiantiPct: string | null;
        sociAtletiCoinvolti: number;
        distribuzioneMinutiPerDisciplina: unknown[];
        saturazionePerImpianto: unknown[];
      };
      assert.equal(body.tassoUtilizzoImpiantiPct, null);
      assert.equal(body.sociAtletiCoinvolti, 0);
      assert.deepEqual(body.distribuzioneMinutiPerDisciplina, []);
      assert.deepEqual(body.saturazionePerImpianto, []);
    });

    await t.test('200 per operatore (route non admin-only)', async () => {
      const stagioneId = await creaStagioneTest(base, admin.token);
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/statistiche`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
    });
  },
);
