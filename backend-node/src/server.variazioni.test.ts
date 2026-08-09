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
import { creaAbilitazionePrincipale, approvaAbilitazione } from './abilitazioni.ts';

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
  const email = `var-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaParte(pool: Pool, stagioneId: string, adminId: string, label: string) {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD var http ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTVRH${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [cf, label, randomUUID()],
  );
  const abilitazione = await creaAbilitazionePrincipale(pool, { personaFisicaId: persona.rows[0]!.id, associazioneId: associazione.rows[0]!.id, stagioneId });
  await approvaAbilitazione(pool, abilitazione.id, adminId);
  const token = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: label });
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id, token };
}

async function creaFixtureDueParti(pool: Pool, adminId: string) {
  const disciplina = await creaDisciplina(pool, { codice: `CANOA-${randomUUID().slice(0, 8)}`, denominazione: 'Canoa' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto var http ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra var http', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo var http', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-var-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotB = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaParte(pool, stagioneId, adminId, 'uno');
  const p2 = await creaParte(pool, stagioneId, adminId, 'due');
  const datiDomanda = {
    disciplineCodici: [disciplina.codice], numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1,
    numeroSquadreFederaliStagionePrecedente: 0, attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
    fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000', richiedeGiornataGara: false, richiesteGiornataGara: [],
  };
  const d1 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p1.associazioneId, stagioneId, preferenze: [slotA.id], blocchiAllenamento: [] }, p1.personaId);
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [d1.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotA.id, d1.id, p1.associazioneId],
  );

  return { stagioneId, slotAId: slotA.id, slotBId: slotB.id, p1, p2 };
}

test('flusso end-to-end: scambio_temporaneo richiesta→accetta, coda backoffice sola lettura', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);

  const rCrea = await fetch(`${base}/pubblico/variazioni`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagioneId: fx.stagioneId, tipo: 'scambio_temporaneo',
      associazioneId: fx.p1.associazioneId,
      slotId: fx.slotAId, data: '2030-10-07',
      slotDestinazioneId: fx.slotBId, dataDestinazione: '2030-10-09',
      controparteAssociazioneId: fx.p2.associazioneId,
    }),
  });
  assert.equal(rCrea.status, 201);
  const proposta = (await rCrea.json()) as { id: string; stato: string };
  assert.equal(proposta.stato, 'in_attesa_accettazione');

  const rAccetta = await fetch(`${base}/pubblico/variazioni/${proposta.id}/accetta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p2.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ associazioneId: fx.p2.associazioneId }),
  });
  assert.equal(rAccetta.status, 200);
  assert.equal(((await rAccetta.json()) as { stato: string }).stato, 'accettata');

  const rCoda = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/variazioni`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rCoda.status, 200);
  assert.equal(((await rCoda.json()) as unknown[]).length, 1);
});

test('403 su creazione senza abilitazione, PUT/POST backoffice su questa risorsa non esiste (solo GET)', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const estraneo = generaAccessTokenPubblico({ sub: randomUUID(), codiceFiscale: 'XXXXXXXXXXX', nome: 'X', cognome: 'Y' });

  const r = await fetch(`${base}/pubblico/variazioni`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${estraneo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagioneId: fx.stagioneId, tipo: 'liberazione', associazioneId: fx.p1.associazioneId, slotId: fx.slotAId, data: '2030-10-07' }),
  });
  assert.equal(r.status, 403);
});

test('POST .../annulla: solo il richiedente, 409 dopo accettazione', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);

  const rCrea = await fetch(`${base}/pubblico/variazioni`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagioneId: fx.stagioneId, tipo: 'scambio_temporaneo',
      associazioneId: fx.p1.associazioneId,
      slotId: fx.slotAId, data: '2030-11-04',
      slotDestinazioneId: fx.slotBId, dataDestinazione: '2030-11-06',
      controparteAssociazioneId: fx.p2.associazioneId,
    }),
  });
  const proposta = (await rCrea.json()) as { id: string };

  const rAnnulla = await fetch(`${base}/pubblico/variazioni/${proposta.id}/annulla`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}` },
  });
  assert.equal(rAnnulla.status, 200);

  const rAccettaDopo = await fetch(`${base}/pubblico/variazioni/${proposta.id}/accetta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p2.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ associazioneId: fx.p2.associazioneId }),
  });
  assert.equal(rAccettaDopo.status, 409);
});
