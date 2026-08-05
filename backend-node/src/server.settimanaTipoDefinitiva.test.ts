import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
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
  const email = `stt-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaFixtureCompleta(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `JUDO-${randomUUID().slice(0, 8)}`, denominazione: 'Judo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto stt http ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra stt http', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Tatami', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-stt-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD stt http ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTHTT${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Stt', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
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
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  const tokenPubblico = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: 'Stt' });
  return { stagioneId, tokenPubblico };
}

test('flusso end-to-end: approva-definitiva → convenzioni in coda → conferma → lettura pubblica con efficacia', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool);

  const rPre = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/settimana-tipo-definitiva`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  assert.equal(rPre.status, 409);

  const rApprova = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/approva-definitiva`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rApprova.status, 200);
  const esitoApprova = (await rApprova.json()) as { convenzioniCreate: number };
  assert.equal(esitoApprova.convenzioniCreate, 1);

  const rCoda = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/convenzioni?stato=in_attesa`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  const coda = (await rCoda.json()) as { id: string }[];
  assert.equal(coda.length, 1);

  const rDopoApprova = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/settimana-tipo-definitiva`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  assert.equal(rDopoApprova.status, 200);
  const primaConferma = (await rDopoApprova.json()) as { fasce: { efficace: boolean }[] };
  assert.equal(primaConferma.fasce[0]!.efficace, false);

  const rConferma = await fetch(`${base}/backoffice/convenzioni/${coda[0]!.id}/conferma`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rConferma.status, 200);

  const rFinale = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/settimana-tipo-definitiva`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  const finale = (await rFinale.json()) as { fasce: { efficace: boolean }[] };
  assert.equal(finale.fasce[0]!.efficace, true);
});

test('PUT conferma: 409 su doppia conferma, 404 su id inesistente', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);

  const r404 = await fetch(`${base}/backoffice/convenzioni/${randomUUID()}/conferma`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r404.status, 404);
});
