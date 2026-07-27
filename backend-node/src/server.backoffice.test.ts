import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { hashPassword } from './auth/password.ts';
import { generaAccessToken } from './auth/jwt.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteBackofficeTest(
  pool: Pool,
  ruolo: 'admin' | 'operatore',
): Promise<{ id: string; token: string }> {
  const email = `backoffice-crud-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'CRUD', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessToken({ sub: id, email, ruolo });
  return { id, token };
}

test(
  'CRUD backoffice: discipline sportive (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const codice = `TST-${randomUUID().slice(0, 8).toUpperCase()}`;

    await t.test('senza token: 401', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, { method: 'GET' });
      assert.equal(r.status, 401);
    });

    await t.test('operatore crea una disciplina: 201, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ codice, denominazione: 'Pallavolo Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { codice: string; denominazione: string };
      assert.equal(body.codice, codice);

      const log = await pool.query(
        `SELECT azione, entita_tipo, entita_id FROM log_operazioni
         WHERE utente_backoffice_id = $1 AND azione = 'crea_disciplina_sportiva'`,
        [operatore.id],
      );
      assert.equal(log.rows.length, 1);
      assert.equal(log.rows[0]!.entita_tipo, 'discipline_sportive');
      assert.equal(log.rows[0]!.entita_id, null);
    });

    await t.test('lista include la disciplina creata', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
      const lista = (await r.json()) as { codice: string }[];
      assert.ok(lista.some((d) => d.codice === codice));
    });

    await t.test('creazione con codice duplicato: 409', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ codice, denominazione: 'Altra' }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('body malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Senza codice' }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('aggiorna denominazione: 200, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/discipline/${codice}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Nuovo Nome' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'Nuovo Nome');

      const log = await pool.query(
        `SELECT 1 FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'aggiorna_disciplina_sportiva'`,
        [operatore.id],
      );
      assert.equal(log.rows.length, 1);
    });

    await t.test('aggiorna codice inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/discipline/NON-ESISTE-${randomUUID()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'X' }),
      });
      assert.equal(r.status, 404);
    });
  },
);

test(
  'CRUD backoffice: istituzioni scolastiche (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const admin = await creaUtenteBackofficeTest(pool, 'admin');
    let istituzioneId = '';

    await t.test('admin crea un\'istituzione: 201, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ denominazione: 'IIS Backoffice Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; denominazione: string };
      istituzioneId = body.id;
      assert.ok(istituzioneId);

      const log = await pool.query(
        `SELECT entita_id FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'crea_istituzione_scolastica'`,
        [admin.id],
      );
      assert.equal(log.rows[0]!.entita_id, istituzioneId);
    });

    await t.test('lista include l\'istituzione creata', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni`, { headers: { Authorization: `Bearer ${admin.token}` } });
      const lista = (await r.json()) as { id: string }[];
      assert.ok(lista.some((i) => i.id === istituzioneId));
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${istituzioneId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'IIS Backoffice Test');
    });

    await t.test('get per id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${randomUUID()}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('aggiorna: 200', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${istituzioneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ denominazione: 'IIS Rinominato' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'IIS Rinominato');
    });
  },
);

test(
  'CRUD backoffice: impianti (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    let impiantoId = '';

    await t.test('crea impianto senza istituzione: 201', async () => {
      const r = await fetch(`${base}/backoffice/impianti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Palestra HTTP Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string };
      impiantoId = body.id;
    });

    await t.test('istituzioneScolasticaId non valida (non uuid): 400', async () => {
      const r = await fetch(`${base}/backoffice/impianti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'X', istituzioneScolasticaId: 'non-un-uuid' }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
    });

    await t.test('aggiorna: 200', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Palestra Rinominata' }),
      });
      assert.equal(r.status, 200);
    });
  },
);
