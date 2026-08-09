import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaAdmin(pool: Pool): Promise<{ id: string; token: string }> {
  const email = `util-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaFixtureAssegnazione(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `RUGBY-${randomUUID().slice(0, 8)}`, denominazione: 'Rugby' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto util http ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra util http', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo util http', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-util-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD util http ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Util', $2, 'spid') RETURNING id`,
    [`TSTUTH${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id, stagioneId, disciplineCodici: [disciplina.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slot.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
  const assegnazione = await pool.query<{ id: string }>(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria') RETURNING id`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  return { assegnazioneId: assegnazione.rows[0]!.id };
}

test('POST .../utilizzi crea, GET .../utilizzi la trova', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const rCrea = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-07', esito: 'non_utilizzato_non_giustificato', note: 'nessuno presente' }),
  });
  assert.equal(rCrea.status, 201);
  const creato = (await rCrea.json()) as { esito: string; giustificazioneScadeIl: string | null };
  assert.equal(creato.esito, 'non_utilizzato_non_giustificato');
  assert.ok(creato.giustificazioneScadeIl !== null);

  const rLista = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rLista.status, 200);
  assert.equal(((await rLista.json()) as unknown[]).length, 1);
});

test('POST .../utilizzi: 400 su UUID malformato nel path, 400 su data inesistente', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const rMalformato = await fetch(`${base}/backoffice/assegnazioni/non-un-uuid/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-07', esito: 'utilizzato' }),
  });
  assert.equal(rMalformato.status, 400);

  const rDataInvalida = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-13-45', esito: 'utilizzato' }),
  });
  assert.equal(rDataInvalida.status, 400);
});

test('flusso giustificazione: presenta (via repository, la route pubblica è nel Task 8) → accogli → 200', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const rCrea = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' }),
  });
  const utilizzo = (await rCrea.json()) as { id: string };
  await pool.query(
    `UPDATE utilizzi_effettivi SET giustificazione_testo = 'motivo', giustificazione_presentata_il = now() WHERE id = $1`,
    [utilizzo.id],
  );

  const rAccogli = await fetch(`${base}/backoffice/utilizzi/${utilizzo.id}/accogli-giustificazione`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rAccogli.status, 200);
  assert.equal(((await rAccogli.json()) as { esito: string }).esito, 'non_utilizzato_giustificato');
});

test('PUT .../rigetta-giustificazione: 409 se nessuna giustificazione presentata', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const rCrea = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-14', esito: 'non_utilizzato_non_giustificato' }),
  });
  const utilizzo = (await rCrea.json()) as { id: string };

  const r = await fetch(`${base}/backoffice/utilizzi/${utilizzo.id}/rigetta-giustificazione`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivazione: 'non pertinente' }),
  });
  assert.equal(r.status, 409);
});
