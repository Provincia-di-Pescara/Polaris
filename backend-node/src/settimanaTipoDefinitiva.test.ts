import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { approvaSettimanaTipoDefinitiva, trovaSettimanaTipoDefinitiva } from './settimanaTipoDefinitiva.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `HOCKEY-${randomUUID().slice(0, 8)}`, denominazione: 'Hockey' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto stt ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra stt', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo stt', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-stt-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD stt ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Stt', $2, 'spid') RETURNING id`,
    [`TSTSTT${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
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
  return { stagioneId };
}

test('approvaSettimanaTipoDefinitiva transiziona stato e crea una convenzione per assegnazione attiva', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const esito = await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);
  assert.equal(esito.convenzioniCreate, 1);
  assert.equal(esito.assegnazioniSenzaIstituzioneSaltate, 0);

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [fx.stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'definitiva');

  const convenzioni = await pool.query(`SELECT c.stato FROM convenzioni c JOIN assegnazioni a ON a.id = c.assegnazione_id JOIN slot_settimana_tipo st ON st.id = a.slot_id WHERE st.stagione_id = $1`, [fx.stagioneId]);
  assert.equal(convenzioni.rowCount, 1);
  assert.equal(convenzioni.rows[0]!.stato, 'in_attesa');
});

test('approvaSettimanaTipoDefinitiva non duplica convenzioni già esistenti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);

  // Riporta artificialmente la stagione a 'concertazione' per testare l'idempotenza sulle
  // convenzioni se approva-definitiva venisse richiamata (scenario di test, non un flusso reale).
  await pool.query(`UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1`, [fx.stagioneId]);
  const secondaEsito = await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);
  assert.equal(secondaEsito.convenzioniCreate, 0);
});

test('approvaSettimanaTipoDefinitiva rifiuta se la stagione non è in concertazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'prima_assegnazione') RETURNING id`,
    [`stagione-stt-stato-${randomUUID()}`],
  );
  await assert.rejects(() => approvaSettimanaTipoDefinitiva(pool, stagione.rows[0]!.id), ErroreStatoNonValidoPerTransizione);
});

test('approvaSettimanaTipoDefinitiva lancia ErroreNonTrovato su stagione inesistente', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  await assert.rejects(() => approvaSettimanaTipoDefinitiva(pool, randomUUID()), ErroreNonTrovato);
});

test('approvaSettimanaTipoDefinitiva non fallisce e conta le assegnazioni su impianti senza istituzione (C1)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  // Secondo impianto/spazio/slot/assegnazione nella stessa stagione, impianto SENZA istituzione.
  const disciplina2 = await creaDisciplina(pool, { codice: `RUGBY-${randomUUID().slice(0, 8)}`, denominazione: 'Rugby' });
  const impiantoSenzaIstituzione = await creaImpianto(pool, { denominazione: 'Palazzetto senza istituzione' });
  const spazio2 = await creaSpazio(pool, { impiantoId: impiantoSenzaIstituzione.id, denominazione: 'Campo 2', disciplineCompatibili: [disciplina2.codice] });
  const slot2 = await creaSlot(pool, { stagioneId: fx.stagioneId, spazioId: spazio2.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione2 = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD stt2 ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona2 = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Stt2', $2, 'spid') RETURNING id`,
    [`TSTST2${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const domanda2 = await creaDomanda(
    pool,
    {
      associazioneId: associazione2.rows[0]!.id, stagioneId: fx.stagioneId, disciplineCodici: [disciplina2.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slot2.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    persona2.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda2.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slot2.id, domanda2.id, associazione2.rows[0]!.id],
  );

  const esito = await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);
  assert.equal(esito.convenzioniCreate, 1); // solo la fixture con istituzione
  assert.equal(esito.assegnazioniSenzaIstituzioneSaltate, 1); // la seconda, senza istituzione

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [fx.stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'definitiva');
});

test('trovaSettimanaTipoDefinitiva rifiuta prima dell\'approvazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await assert.rejects(() => trovaSettimanaTipoDefinitiva(pool, fx.stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('trovaSettimanaTipoDefinitiva: fasce assegnate + slot liberi + efficacia dopo approvazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  // Un secondo slot libero nella stessa stagione, mai assegnato.
  const spazio = await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE stagione_id = $1 LIMIT 1`, [fx.stagioneId]);
  const slotLibero = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 3, '18:00', '19:00') RETURNING id`,
    [fx.stagioneId, spazio.rows[0]!.spazio_id],
  );

  await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);
  const esito = await trovaSettimanaTipoDefinitiva(pool, fx.stagioneId);

  assert.equal(esito.fasce.length, 1);
  assert.equal(esito.fasce[0]!.efficace, false); // convenzione ancora in_attesa
  assert.deepEqual(esito.slotLiberi, [slotLibero.rows[0]!.id]);
});
