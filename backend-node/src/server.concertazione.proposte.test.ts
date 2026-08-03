import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { creaAbilitazionePrincipale, approvaAbilitazione } from './abilitazioni.ts';
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

async function creaOperatoreAdmin(pool: Pool) {
  const email = `concert-proposte-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return r.rows[0]!.id;
}

async function creaParteConAbilitazione(pool: Pool, stagioneId: string, adminId: string, label: string) {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD HTTP ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTHTP${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [cf, label, randomUUID()],
  );
  const abilitazione = await creaAbilitazionePrincipale(pool, { personaFisicaId: persona.rows[0]!.id, associazioneId: associazione.rows[0]!.id, stagioneId });
  await approvaAbilitazione(pool, abilitazione.id, adminId);
  const token = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: label });
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id, token };
}

async function creaFixtureCompleta(pool: Pool, adminId: string) {
  const disciplina = await creaDisciplina(pool, { codice: `BASKET-${randomUUID().slice(0, 8)}`, denominazione: 'Basket' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto concertazione HTTP ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra HTTP concertazione', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo unico HTTP', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-proposte-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotLibero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaParteConAbilitazione(pool, stagioneId, adminId, 'uno');
  const domanda1 = await creaDomanda(
    pool,
    {
      associazioneId: p1.associazioneId,
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
      preferenze: [slotA.id],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    p1.personaId,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda1.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotA.id, domanda1.id, p1.associazioneId],
  );

  return { stagioneId, slotAId: slotA.id, slotLiberoId: slotLibero.id, p1 };
}

test('crea proposta utilizzo_slot_libero, lista, dettaglio, annulla', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const adminId = await creaOperatoreAdmin(pool);
  const fx = await creaFixtureCompleta(pool, adminId);

  const rCrea = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/concertazione/proposte`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagioneId: fx.stagioneId,
      tipo: 'utilizzo_slot_libero',
      slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }],
    }),
  });
  assert.equal(rCrea.status, 201);
  const proposta = (await rCrea.json()) as { id: string; stato: string };
  assert.equal(proposta.stato, 'accettata_da_tutti');

  const rLista = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/concertazione/proposte`, { headers: { Authorization: `Bearer ${fx.p1.token}` } });
  assert.equal(rLista.status, 200);
  const listaCorpo = (await rLista.json()) as unknown[];
  assert.equal(listaCorpo.length, 1);

  const rDettaglio = await fetch(`${base}/pubblico/concertazione/proposte/${proposta.id}`, { headers: { Authorization: `Bearer ${fx.p1.token}` } });
  assert.equal(rDettaglio.status, 200);

  const rAnnulla = await fetch(`${base}/pubblico/concertazione/proposte/${proposta.id}/annulla`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}` },
  });
  assert.equal(rAnnulla.status, 200);
  const annullaCorpo = (await rAnnulla.json()) as { stato: string };
  assert.equal(annullaCorpo.stato, 'annullata');
});

test('403 su creazione proposta senza abilitazione attiva', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const adminId = await creaOperatoreAdmin(pool);
  const fx = await creaFixtureCompleta(pool, adminId);
  const estraneo = generaAccessTokenPubblico({ sub: randomUUID(), codiceFiscale: 'XXXXXXXXXXX', nome: 'X', cognome: 'Y' });

  const r = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/concertazione/proposte`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${estraneo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }] }),
  });
  assert.equal(r.status, 403);
});
