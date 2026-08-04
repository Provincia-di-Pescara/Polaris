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
  const email = `concert-valida-admin-${randomUUID()}@test.local`;
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
    [`ASD valida ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTVAL${randomUUID().slice(0, 10).toUpperCase()}`;
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
  const disciplina = await creaDisciplina(pool, { codice: `RUGBY-${randomUUID().slice(0, 8)}`, denominazione: 'Rugby' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto valida ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra valida', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo valida', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-valida-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotB = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaParte(pool, stagioneId, adminId, 'uno');
  const p2 = await creaParte(pool, stagioneId, adminId, 'due');

  for (const [p, slot] of [[p1, slotA], [p2, slotB]] as const) {
    const domanda = await creaDomanda(
      pool,
      {
        associazioneId: p.associazioneId,
        stagioneId,
        disciplineCodici: [disciplina.codice],
        numeroTesserati: 10,
        numeroAtletiPartecipanti: 8,
        numeroSquadre: 1,
        numeroSquadreFederaliStagionePrecedente: 0,
        attivitaGiovanile: true,
        attivitaAgonistica: false,
        attivitaParalimpicaInclusiva: false,
        fabbisognoMinimoMinuti: '60.000',
        fabbisognoOttimaleMinuti: '60.000',
        preferenze: [slot.id],
        blocchiAllenamento: [],
        richiedeGiornataGara: false,
        richiesteGiornataGara: [],
      },
      p.personaId,
    );
    await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
    await pool.query(
      `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
      [slot.id, domanda.id, p.associazioneId],
    );
  }

  return { stagioneId, slotAId: slotA.id, slotBId: slotB.id, p1, p2 };
}

async function creaEAccettaProposta(base: string, fx: Awaited<ReturnType<typeof creaFixtureDueParti>>) {
  const rCrea = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/concertazione/proposte`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagioneId: fx.stagioneId,
      proponenteAssociazioneId: fx.p1.associazioneId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId },
        { slotId: fx.slotBId, associazioneCedenteId: fx.p2.associazioneId, associazioneRiceventeId: fx.p1.associazioneId },
      ],
    }),
  });
  const proposta = (await rCrea.json()) as { id: string };
  await fetch(`${base}/pubblico/concertazione/proposte/${proposta.id}/accetta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p2.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ associazioneId: fx.p2.associazioneId }),
  });
  return proposta.id as string;
}

test('flusso end-to-end: coda backoffice, valida con successo, assegnazioni scambiate', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const propostaId = await creaEAccettaProposta(base, fx);

  const rCoda = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/concertazione/proposte?stato=accettata_da_tutti`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rCoda.status, 200);
  const coda = (await rCoda.json()) as unknown[];
  assert.equal(coda.length, 1);

  const rValida = await fetch(`${base}/backoffice/concertazione/proposte/${propostaId}/valida`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rValida.status, 200);
  const esito = (await rValida.json()) as { esito: string };
  assert.equal(esito.esito, 'validata');

  const slotA = await pool.query<{ associazione_id: string }>(`SELECT associazione_id FROM assegnazioni WHERE slot_id = $1 AND stato = 'validata'`, [fx.slotAId]);
  assert.equal(slotA.rows[0]?.associazione_id, fx.p2.associazioneId);
});

test('PUT valida risponde 409 su conflitto FIFO', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const propostaVecchiaId = await creaEAccettaProposta(base, fx);
  const propostaNuovaId = await creaEAccettaProposta(base, fx);

  const rNuova = await fetch(`${base}/backoffice/concertazione/proposte/${propostaNuovaId}/valida`, { method: 'PUT', headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(rNuova.status, 409);

  const rVecchia = await fetch(`${base}/backoffice/concertazione/proposte/${propostaVecchiaId}/valida`, { method: 'PUT', headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(rVecchia.status, 200);
  const esitoVecchia = (await rVecchia.json()) as { esito: string };
  assert.equal(esitoVecchia.esito, 'validata');
});

test('PUT rigetta manuale su proposta accettata_da_tutti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const propostaId = await creaEAccettaProposta(base, fx);

  const r = await fetch(`${base}/backoffice/concertazione/proposte/${propostaId}/rigetta`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivazione: 'rigetto discrezionale di test' }),
  });
  assert.equal(r.status, 200);
  const corpo = (await r.json()) as { stato: string };
  assert.equal(corpo.stato, 'rigettata');
});

test('403 operatore pubblico su route backoffice di validazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const propostaId = await creaEAccettaProposta(base, fx);

  const r = await fetch(`${base}/backoffice/concertazione/proposte/${propostaId}/valida`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${fx.p1.token}` }, // token pubblico, non backoffice
  });
  assert.equal(r.status, 401);
});
