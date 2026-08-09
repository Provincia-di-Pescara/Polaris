import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { registraUtilizzo, trovaUtilizzoPerId, listaUtilizziPerAssegnazione, listaUtilizziPerAssociazione } from './utilizziEffettivi.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `NUOTO-${randomUUID().slice(0, 8)}`, denominazione: 'Nuoto' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto util ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra util', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Vasca util', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-util-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD util ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Util', $2, 'spid') RETURNING id`,
    [`TSTUTL${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
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
  return { stagioneId, assegnazioneId: assegnazione.rows[0]!.id, associazioneId: associazione.rows[0]!.id };
}

test('registraUtilizzo con esito utilizzato: nessuna finestra di giustificazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'utilizzato' });
  assert.equal(utilizzo.esito, 'utilizzato');
  assert.equal(utilizzo.rilevatoTramite, 'registro_impianto');
  assert.equal(utilizzo.giustificazioneScadeIl, null);
});

test('registraUtilizzo con esito non_utilizzato_non_giustificato: apre la finestra di giustificazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const prima = new Date();
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato', note: 'nessuno presente' });
  assert.equal(utilizzo.esito, 'non_utilizzato_non_giustificato');
  assert.ok(utilizzo.giustificazioneScadeIl !== null);
  const scadeIl = new Date(utilizzo.giustificazioneScadeIl!);
  const attesaMinimaMs = 6 * 24 * 60 * 60 * 1000; // termine di default (7gg) meno un margine
  assert.ok(scadeIl.getTime() - prima.getTime() > attesaMinimaMs);
});

test('trovaUtilizzoPerId: null se non esiste', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  assert.equal(await trovaUtilizzoPerId(pool, randomUUID()), null);
});

test('listaUtilizziPerAssegnazione e listaUtilizziPerAssociazione trovano il record registrato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'utilizzato' });

  const perAssegnazione = await listaUtilizziPerAssegnazione(pool, fx.assegnazioneId);
  assert.equal(perAssegnazione.length, 1);

  const perAssociazione = await listaUtilizziPerAssociazione(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(perAssociazione.length, 1);
  assert.equal(perAssociazione[0]!.assegnazioneId, fx.assegnazioneId);
});
