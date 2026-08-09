import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaProvvedimento, listaProvvedimentiPerAssegnazione, codaMancatiUtilizzi, applicaDecadenza } from './provvedimenti.ts';
import { registraUtilizzo } from './utilizziEffettivi.ts';
import { ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `JUDO-${randomUUID().slice(0, 8)}`, denominazione: 'Judo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto prov ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra prov', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Tatami prov', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-prov-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD prov ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Prov', $2, 'spid') RETURNING id`,
    [`TSTPRV${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
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

// Registra N utilizzi 'non_utilizzato_non_giustificato' già scaduti senza presentazione
// (mancati "definitivi" ai fini del conteggio soglie).
async function registraMancatiDefinitivi(pool: Pool, assegnazioneId: string, n: number, dataBase: string) {
  for (let i = 0; i < n; i++) {
    const data = new Date(dataBase);
    data.setDate(data.getDate() + i * 7);
    const utilizzo = await registraUtilizzo(pool, {
      assegnazioneId, data: data.toISOString().slice(0, 10), esito: 'non_utilizzato_non_giustificato',
    });
    await pool.query(`UPDATE utilizzi_effettivi SET giustificazione_scade_il = now() - interval '1 day' WHERE id = $1`, [utilizzo.id]);
  }
}

test('creaProvvedimento e listaProvvedimentiPerAssegnazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const provvedimento = await creaProvvedimento(pool, {
    associazioneId: fx.associazioneId, assegnazioneId: fx.assegnazioneId, tipo: 'diffida',
    motivazione: 'superata soglia mancati utilizzi', emessoDa: null,
  });
  assert.equal(provvedimento.tipo, 'diffida');

  const lista = await listaProvvedimentiPerAssegnazione(pool, fx.assegnazioneId);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.id, provvedimento.id);
});

test('codaMancatiUtilizzi: segnala diffida raggiunta, decadenza no, provvedimento non ancora emesso', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraMancatiDefinitivi(pool, fx.assegnazioneId, 2, '2030-10-07'); // soglia diffida di default = 2

  const coda = await codaMancatiUtilizzi(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(coda.length, 1);
  const voce = coda[0]!;
  assert.equal(voce.assegnazioneId, fx.assegnazioneId);
  assert.equal(voce.mancatiDefinitivi, 2);
  assert.equal(voce.diffidaRaggiunta, true);
  assert.equal(voce.decadenzaRaggiunta, false);
  assert.equal(voce.diffidaGiaEmessa, false);
});

test('codaMancatiUtilizzi: diffidaGiaEmessa true dopo l\'emissione del provvedimento', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraMancatiDefinitivi(pool, fx.assegnazioneId, 2, '2030-10-07');
  await creaProvvedimento(pool, { associazioneId: fx.associazioneId, assegnazioneId: fx.assegnazioneId, tipo: 'diffida', motivazione: 'x', emessoDa: null });

  const coda = await codaMancatiUtilizzi(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(coda[0]!.diffidaGiaEmessa, true);
});

test('codaMancatiUtilizzi: esclude finestre ancora aperte dal conteggio', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' }); // finestra ancora aperta

  const coda = await codaMancatiUtilizzi(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(coda.length, 0);
});

test('applicaDecadenza: assegnazione passa a decaduta, guardia su doppia decadenza', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  await applicaDecadenza(pool, fx.assegnazioneId, 'decadenza per mancati utilizzi ripetuti');
  const riga = await pool.query<{ stato: string; decaduta_motivazione: string | null }>(
    `SELECT stato, decaduta_motivazione FROM assegnazioni WHERE id = $1`,
    [fx.assegnazioneId],
  );
  assert.equal(riga.rows[0]!.stato, 'decaduta');
  assert.equal(riga.rows[0]!.decaduta_motivazione, 'decadenza per mancati utilizzi ripetuti');

  await assert.rejects(() => applicaDecadenza(pool, fx.assegnazioneId, 'seconda decadenza'), ErroreStatoNonValidoPerTransizione);
});
