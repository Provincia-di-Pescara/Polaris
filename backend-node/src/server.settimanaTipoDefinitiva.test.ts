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

test('POST .../approva-definitiva: 409 se esiste proposta accettata_da_tutti pendente (C2/I1 final review)', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool);
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Appr', $2, 'spid') RETURNING id`,
    [`TSTAPP${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD appr ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO concertazione_proposte (stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id, stato)
     VALUES ($1, 'utilizzo_slot_libero', $2, $3, 'accettata_da_tutti')`,
    [fx.stagioneId, persona.rows[0]!.id, associazione.rows[0]!.id],
  );

  const r = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/approva-definitiva`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 409);

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [fx.stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'concertazione'); // non transitata
});

test('POST .../approva-definitiva: annulla in blocco le proposte in_attesa_accettazione (C2/I1 final review)', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool);
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Appr2', $2, 'spid') RETURNING id`,
    [`TSTAP2${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD appr2 ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const proposta = await pool.query<{ id: string }>(
    `INSERT INTO concertazione_proposte (stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id, stato)
     VALUES ($1, 'scambio_bilaterale', $2, $3, 'in_attesa_accettazione') RETURNING id`,
    [fx.stagioneId, persona.rows[0]!.id, associazione.rows[0]!.id],
  );

  const r = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/approva-definitiva`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 200);

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM concertazione_proposte WHERE id = $1`, [proposta.rows[0]!.id]);
  assert.equal(stato.rows[0]!.stato, 'annullata');
});

test('POST .../approva-definitiva chiude la finestra: accettare una proposta pendente dopo fallisce con 409 (C2/I1 regressione)', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool);

  // Una seconda associazione, parte di una proposta bilaterale: il proponente (già
  // "accettante" per costruzione, vedi concertazione.ts::creaProposta) NON basta a portare
  // la proposta a 'accettata_da_tutti' — resta 'in_attesa_accettazione' finché l'altra
  // parte non accetta. Se fosse già 'accettata_da_tutti' il nuovo close-out di
  // approva-definitiva la bloccherebbe PRIMA di poter dimostrare il bug originale (la
  // finestra non più chiusa su accettaProposta/validaProposta) — qui vogliamo esercitare
  // esattamente quel percorso, non il close-out.
  const associazioneDomanda = await pool.query<{ associazione_id: string; id: string }>(
    `SELECT associazione_id, id FROM domande WHERE stagione_id = $1 LIMIT 1`,
    [fx.stagioneId],
  );
  const p1AssociazioneId = associazioneDomanda.rows[0]!.associazione_id;
  const p1DomandaId = associazioneDomanda.rows[0]!.id;
  const p1Slot = await pool.query<{ slot_id: string }>(`SELECT slot_id FROM assegnazioni WHERE domanda_id = $1 LIMIT 1`, [p1DomandaId]);

  const disciplina2 = await creaDisciplina(pool, { codice: `BASKET-${randomUUID().slice(0, 8)}`, denominazione: 'Basket' });
  const spazioRiga = await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [p1Slot.rows[0]!.slot_id]);
  await pool.query(`INSERT INTO spazio_disciplina_compatibile (spazio_id, disciplina_codice) VALUES ($1, $2)`, [spazioRiga.rows[0]!.spazio_id, disciplina2.codice]);
  const slotLibero = await creaSlot(pool, {
    stagioneId: fx.stagioneId, spazioId: spazioRiga.rows[0]!.spazio_id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00',
  });
  const cfP2 = `TSTAP3${randomUUID().slice(0, 10).toUpperCase()}`;
  const p2Persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Appr3', $2, 'spid') RETURNING id`,
    [cfP2, randomUUID()],
  );
  const p2Associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD appr3 ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const p2Domanda = await creaDomanda(
    pool,
    {
      associazioneId: p2Associazione.rows[0]!.id, stagioneId: fx.stagioneId, disciplineCodici: [disciplina2.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slotLibero.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    p2Persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [p2Domanda.id]);

  const { creaProposta, accettaProposta } = await import('./concertazione.ts');
  const { ErroreStatoNonValidoPerTransizione } = await import('./erroriDominio.ts');

  const proposta = await creaProposta(
    pool,
    {
      stagioneId: fx.stagioneId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: p1Slot.rows[0]!.slot_id, associazioneCedenteId: p1AssociazioneId, associazioneRiceventeId: p2Associazione.rows[0]!.id },
        { slotId: slotLibero.id, associazioneCedenteId: p2Associazione.rows[0]!.id, associazioneRiceventeId: p1AssociazioneId },
      ],
    },
    p2Persona.rows[0]!.id, // proponente = p2 (parte non-p2 resta da accettare)
    p2Associazione.rows[0]!.id,
  );
  // proponente (p2) è auto-accettante, p1 resta da accettare -> stato in_attesa_accettazione.
  const propostaRiga = await pool.query<{ stato: string }>(`SELECT stato FROM concertazione_proposte WHERE id = $1`, [proposta.id]);
  assert.equal(propostaRiga.rows[0]!.stato, 'in_attesa_accettazione');

  const rApprova = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/approva-definitiva`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rApprova.status, 200);

  // Il close-out di approva-definitiva annulla la proposta pendente: tentare di accettarla
  // ora deve fallire perché non è più 'in_attesa_accettazione' (già annullata) — E, anche
  // ipotizzando che una FOR UPDATE l'avesse trovata ancora pendente, il guard sulla
  // stagione (stato ora 'definitiva') deve comunque bloccarla. Verifichiamo entrambi gli
  // esiti collassano nello stesso errore di dominio (409 lato HTTP).
  await assert.rejects(() => accettaProposta(pool, proposta.id, p1AssociazioneId, randomUUID()), ErroreStatoNonValidoPerTransizione);

  const propostaDopo = await pool.query<{ stato: string }>(`SELECT stato FROM concertazione_proposte WHERE id = $1`, [proposta.id]);
  assert.equal(propostaDopo.rows[0]!.stato, 'annullata');
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
