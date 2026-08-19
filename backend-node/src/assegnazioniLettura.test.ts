import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { listaAssegnazioniPerAssociazione } from './assegnazioniLettura.ts';
import { creaDomanda } from './domande.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `ASSLET-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto asslet test ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra asslet test', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo A', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-asslet-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotAttivo = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotDecaduto = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD asslet test ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const associazioneId = associazione.rows[0]!.id;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [`TSTASL${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId,
      stagioneId,
      disciplineCodici: [disciplina.codice],
      numeroTesserati: 0,
      numeroAtletiPartecipanti: 0,
      numeroSquadre: 0,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: false,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '30.000',
      fabbisognoOttimaleMinuti: '30.000',
      preferenze: [slotAttivo.id, slotDecaduto.id],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );

  const assegnazioneProvvisoria = await pool.query<{ id: string }>(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato)
     VALUES ($1, $2, $3, 'singola', 60.000, 'provvisoria') RETURNING id`,
    [slotAttivo.id, domanda.id, associazioneId],
  );
  const assegnazioneDecaduta = await pool.query<{ id: string }>(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato)
     VALUES ($1, $2, $3, 'singola', 60.000, 'decaduta') RETURNING id`,
    [slotDecaduto.id, domanda.id, associazioneId],
  );

  return {
    associazioneId,
    stagioneId,
    impiantoDenominazione: impianto.denominazione,
    spazioDenominazione: spazio.denominazione,
    assegnazioneProvvisoriaId: assegnazioneProvvisoria.rows[0]!.id,
    assegnazioneDecadutaId: assegnazioneDecaduta.rows[0]!.id,
  };
}

test(
  'listaAssegnazioniPerAssociazione restituisce solo le assegnazioni provvisoria/validata, con valoreMinuti come stringa',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());
    const fx = await creaFixture(pool);

    const lista = await listaAssegnazioniPerAssociazione(pool, fx.associazioneId, fx.stagioneId);

    assert.equal(lista.length, 1, 'la riga decaduta deve essere esclusa');
    const riga = lista[0]!;
    assert.equal(riga.id, fx.assegnazioneProvvisoriaId);
    assert.equal(riga.tipo, 'singola');
    assert.equal(riga.stato, 'provvisoria');
    assert.equal(riga.valoreMinuti, '60.000');
    assert.equal(typeof riga.valoreMinuti, 'string', 'valoreMinuti deve restare una stringa, mai un numero JS');
    assert.equal(riga.impiantoDenominazione, fx.impiantoDenominazione);
    assert.equal(riga.spazioDenominazione, fx.spazioDenominazione);
    assert.equal(riga.giornoSettimana, 1);
    assert.equal(riga.orarioInizio, '18:00:00');
    assert.equal(riga.orarioFine, '19:00:00');
    assert.equal(riga.durataMinuti, 60);
    assert.equal(riga.pregiata, false);
  },
);

test(
  'listaAssegnazioniPerAssociazione restituisce array vuoto per un\'associazione senza assegnazioni',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
      [`stagione-asslet-vuota-${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
      [`ASD asslet vuota ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
    );

    const lista = await listaAssegnazioniPerAssociazione(pool, associazione.rows[0]!.id, stagione.rows[0]!.id);
    assert.deepEqual(lista, []);
  },
);
