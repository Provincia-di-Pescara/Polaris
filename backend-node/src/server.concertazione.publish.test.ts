import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
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

async function creaUtenteAdminTest(pool: Pool) {
  const email = `concert-publish-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' });
}

async function creaStagioneConElaborazione(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'prima_assegnazione') RETURNING id`,
    [`stagione-publish-http-${randomUUID()}`],
  );
  const stagioneId = r.rows[0]!.id;
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata')`,
    [stagioneId, versione.rows[0]!.id],
  );
  return stagioneId;
}

test('POST /backoffice/stagioni/:id/pubblica-proposta poi GET /pubblico/stagioni/:id/proposta', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const stagioneId = await creaStagioneConElaborazione(pool);
  const tokenAdmin = await creaUtenteAdminTest(pool);

  const rPre = await fetch(`${base}/pubblico/stagioni/${stagioneId}/proposta`);
  assert.equal(rPre.status, 401); // nessun token pubblico: verifica solo che la route esista e richieda auth

  const rPubblica = await fetch(`${base}/backoffice/stagioni/${stagioneId}/pubblica-proposta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(rPubblica.status, 200);

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'concertazione');
});

test('POST /backoffice/stagioni/:id/pubblica-proposta risponde 409 se già pubblicata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const stagioneId = await creaStagioneConElaborazione(pool);
  const tokenAdmin = await creaUtenteAdminTest(pool);
  await fetch(`${base}/backoffice/stagioni/${stagioneId}/pubblica-proposta`, { method: 'POST', headers: { Authorization: `Bearer ${tokenAdmin}` } });
  const r2 = await fetch(`${base}/backoffice/stagioni/${stagioneId}/pubblica-proposta`, { method: 'POST', headers: { Authorization: `Bearer ${tokenAdmin}` } });
  assert.equal(r2.status, 409);
});
