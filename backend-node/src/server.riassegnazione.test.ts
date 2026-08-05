import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import type { ClientMotore } from './engine/client.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool, clientMotore?: ClientMotore) {
  const app = creaApp(pool, clientMotore ? { clientMotore } : {});
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaAdmin(pool: Pool): Promise<{ id: string; token: string }> {
  const email = `riassegnazione-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaStagioneInConcertazione(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-riassegnazione-${randomUUID()}`],
  );
  return r.rows[0]!.id;
}

function clientMotoreFittizio(overrides: Partial<ClientMotore>): ClientMotore {
  return {
    eseguiIstruttoria: overrides.eseguiIstruttoria ?? (async () => ({ domandeCalcolate: 0 })),
    eseguiBlocchiGara: overrides.eseguiBlocchiGara ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, richiesteNonAssegnate: 0 })),
    eseguiPrimaAssegnazione: overrides.eseguiPrimaAssegnazione ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
    eseguiRiassegnazioneResidua:
      overrides.eseguiRiassegnazioneResidua ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
  };
}

test('POST .../riassegnazione-residua: 200, chiama il motore, audit log', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  let chiamataConStagione: string | undefined;
  const client = clientMotoreFittizio({
    eseguiRiassegnazioneResidua: async (stagioneId) => {
      chiamataConStagione = stagioneId;
      return { elaborazioneId: 'elab-test', numeroAssegnazioni: 0, roundEseguiti: 0 };
    },
  });
  const { base, chiudi } = await avviaServerTest(pool, client);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const stagioneId = await creaStagioneInConcertazione(pool);

  const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/riassegnazione-residua`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 200);
  assert.equal(chiamataConStagione, stagioneId);

  const log = await pool.query(`SELECT azione FROM log_operazioni WHERE entita_id = $1 AND azione = 'riassegnazione_residua'`, [stagioneId]);
  assert.equal(log.rowCount, 1);
});

test('POST .../riassegnazione-residua: 409 se esiste proposta accettata_da_tutti pendente', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, clientMotoreFittizio({}));
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const stagioneId = await creaStagioneInConcertazione(pool);
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Riass', $2, 'spid') RETURNING id`,
    [`TSTRAS${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD riass ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO concertazione_proposte (stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id, stato)
     VALUES ($1, 'utilizzo_slot_libero', $2, $3, 'accettata_da_tutti')`,
    [stagioneId, persona.rows[0]!.id, associazione.rows[0]!.id],
  );

  const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/riassegnazione-residua`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 409);
});

test('POST .../riassegnazione-residua: annulla in blocco le proposte in_attesa_accettazione', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, clientMotoreFittizio({}));
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const stagioneId = await creaStagioneInConcertazione(pool);
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Riass', $2, 'spid') RETURNING id`,
    [`TSTRAS${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD riass pend ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const proposta = await pool.query<{ id: string }>(
    `INSERT INTO concertazione_proposte (stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id, stato)
     VALUES ($1, 'scambio_bilaterale', $2, $3, 'in_attesa_accettazione') RETURNING id`,
    [stagioneId, persona.rows[0]!.id, associazione.rows[0]!.id],
  );

  const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/riassegnazione-residua`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 200);

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM concertazione_proposte WHERE id = $1`, [proposta.rows[0]!.id]);
  assert.equal(stato.rows[0]!.stato, 'annullata');
});

test('POST .../riassegnazione-residua: 409 se la stagione non è in stato concertazione', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, clientMotoreFittizio({}));
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'prima_assegnazione') RETURNING id`,
    [`stagione-riassegnazione-stato-${randomUUID()}`],
  );

  const r = await fetch(`${base}/backoffice/stagioni/${stagione.rows[0]!.id}/riassegnazione-residua`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 409);
});
