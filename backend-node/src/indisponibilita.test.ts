import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaIndisponibilita, listaIndisponibilitaPerAssociazione } from './indisponibilita.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `KARATE-${randomUUID().slice(0, 8)}`, denominazione: 'Karate' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto indisp ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra indisp', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Tatami indisp', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-indisp-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotRecupero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD indisp ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Indisp', $2, 'spid') RETURNING id`,
    [`TSTIND${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
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
  return { stagioneId, slotId: slot.id, slotRecuperoId: slotRecupero.id, associazioneId: associazione.rows[0]!.id };
}

test('creaIndisponibilita con slotRecuperoId, notificataAlleAssociazioniIl impostato subito', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const indisponibilita = await creaIndisponibilita(pool, {
    slotId: fx.slotId, dal: '2030-10-01', al: '2030-10-07', motivo: 'lavori di manutenzione',
    comunicataDa: 'ente', slotRecuperoId: fx.slotRecuperoId,
  });

  assert.equal(indisponibilita.slotId, fx.slotId);
  assert.equal(indisponibilita.slotRecuperoId, fx.slotRecuperoId);
  assert.ok(indisponibilita.notificataAlleAssociazioniIl !== null);
});

test('creaIndisponibilita senza slotRecuperoId', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const indisponibilita = await creaIndisponibilita(pool, {
    slotId: fx.slotId, dal: '2030-10-01', al: '2030-10-01', motivo: 'consultazione elettorale',
    comunicataDa: 'istituzione_scolastica',
  });

  assert.equal(indisponibilita.slotRecuperoId, null);
});

test('listaIndisponibilitaPerAssociazione trova le indisponibilità sovrapposte a un\'assegnazione attiva', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await creaIndisponibilita(pool, { slotId: fx.slotId, dal: '2030-10-01', al: '2030-10-07', motivo: 'test', comunicataDa: 'ente' });

  const lista = await listaIndisponibilitaPerAssociazione(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(lista.length, 1);
});
