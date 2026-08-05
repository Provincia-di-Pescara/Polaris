import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { confermaConvenzione, listaConvenzioniPerStagione } from './convenzioni.ts';
import { approvaSettimanaTipoDefinitiva } from './settimanaTipoDefinitiva.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixtureConConvenzione(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `SCHERMA-${randomUUID().slice(0, 8)}`, denominazione: 'Scherma' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto conv ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra conv', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Sala conv', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-conv-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD conv ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Conv', $2, 'spid') RETURNING id`,
    [`TSTCNV${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
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
  await approvaSettimanaTipoDefinitiva(pool, stagioneId);
  const convenzione = await pool.query<{ id: string }>(
    `SELECT c.id FROM convenzioni c JOIN assegnazioni a ON a.id = c.assegnazione_id JOIN slot_settimana_tipo st ON st.id = a.slot_id WHERE st.stagione_id = $1`,
    [stagioneId],
  );
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, 'x', 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [`conv-admin-${randomUUID()}@test.local`],
  );
  return { stagioneId, convenzioneId: convenzione.rows[0]!.id, adminId: admin.rows[0]!.id };
}

test('confermaConvenzione transiziona a perfezionata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConConvenzione(pool);

  const convenzione = await confermaConvenzione(pool, fx.convenzioneId, fx.adminId);
  assert.equal(convenzione.stato, 'perfezionata');
  assert.equal(convenzione.confermataDaUtenteBackofficeId, fx.adminId);
});

test('confermaConvenzione rifiuta doppia conferma', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConConvenzione(pool);
  await confermaConvenzione(pool, fx.convenzioneId, fx.adminId);
  await assert.rejects(() => confermaConvenzione(pool, fx.convenzioneId, fx.adminId), ErroreStatoNonValidoPerTransizione);
});

test('confermaConvenzione lancia ErroreNonTrovato su id inesistente', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, 'x', 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [`conv-admin2-${randomUUID()}@test.local`],
  );
  await assert.rejects(() => confermaConvenzione(pool, randomUUID(), admin.rows[0]!.id), ErroreNonTrovato);
});

test('listaConvenzioniPerStagione filtra per stato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConConvenzione(pool);

  const inAttesa = await listaConvenzioniPerStagione(pool, fx.stagioneId, 'in_attesa');
  assert.equal(inAttesa.length, 1);

  await confermaConvenzione(pool, fx.convenzioneId, fx.adminId);
  const perfezionate = await listaConvenzioniPerStagione(pool, fx.stagioneId, 'perfezionata');
  assert.equal(perfezionate.length, 1);
  const ancoraInAttesa = await listaConvenzioniPerStagione(pool, fx.stagioneId, 'in_attesa');
  assert.equal(ancoraInAttesa.length, 0);
});
