import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pubblicaProposta, trovaPropostaProvvisoria } from './propostaProvvisoria.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaStagione(pool: Pool, stato: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', $2) RETURNING id`,
    [`stagione-proposta-test-${randomUUID()}`, stato],
  );
  return r.rows[0]!.id;
}

test('pubblicaProposta rifiuta se non esiste elaborazione prima_assegnazione completata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  await assert.rejects(() => pubblicaProposta(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('pubblicaProposta rifiuta se stagione non è in prima_assegnazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'concertazione');
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata')`,
    [stagioneId, versione.rows[0]!.id],
  );
  await assert.rejects(() => pubblicaProposta(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('pubblicaProposta transiziona lo stato e trovaPropostaProvvisoria funziona dopo', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata')`,
    [stagioneId, versione.rows[0]!.id],
  );
  await pubblicaProposta(pool, stagioneId);
  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'concertazione');

  const voci = await trovaPropostaProvvisoria(pool, stagioneId);
  assert.deepEqual(voci, []); // nessuna assegnazione creata in questo test, solo verifica che non lanci più ErroreStatoNonValidoPerTransizione
});

test('trovaPropostaProvvisoria rifiuta se la proposta non è ancora pubblicata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  await assert.rejects(() => trovaPropostaProvvisoria(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

async function creaFixtureConAssegnazione(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `PROP-${randomUUID().slice(0, 8)}`, denominazione: 'Test' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto proposta ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra proposta', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo proposta', disciplineCompatibili: [disciplina.codice] });
  const stagioneId = await creaStagione(pool, 'concertazione');
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });

  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD proposta ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const associazioneId = associazione.rows[0]!.id;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Proposta', $2, 'spid') RETURNING id`,
    [`TSTPRP${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );

  const domanda = await creaDomanda(
    pool,
    {
      associazioneId,
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
      fabbisognoOttimaleMinuti: '100.000',
      preferenze: [slot.id],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);

  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  const versioneId = versione.rows[0]!.id;

  await pool.query(
    `INSERT INTO fabbisogni_riconosciuti (domanda_id, parametrico_versione_id, peso_base, incremento_squadre, fr_calcolato_minuti, fd_minuti, fr_finale_minuti)
     VALUES ($1, $2, 1, 0, 100, 100, 100)`,
    [domanda.id, versioneId],
  );

  const elaborazione = await pool.query<{ id: string }>(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata') RETURNING id`,
    [stagioneId, versioneId],
  );
  const elaborazioneId = elaborazione.rows[0]!.id;

  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, elaborazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, $4, 'singola', 60, 'validata')`,
    [slot.id, domanda.id, associazioneId, elaborazioneId],
  );

  return { stagioneId, slotId: slot.id, associazioneId, elaborazioneId };
}

test('trovaPropostaProvvisoria calcola l\'ISF come VA/FR arrotondato a 3 cifre (I2 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConAssegnazione(pool);

  const voci = await trovaPropostaProvvisoria(pool, fx.stagioneId);
  assert.equal(voci.length, 1);
  // VA=60, FR finale=100 => ISF = 0.600
  assert.equal(voci[0]!.isf, '0.600');
});

test('trovaPropostaProvvisoria calcola l\'ISF cumulativo su VA totale dell\'associazione, non sulla singola riga (I2b final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConAssegnazione(pool);

  // secondo slot sullo stesso spazio/giorno, orario successivo (niente sovrapposizione EXCLUDE),
  // seconda assegnazione ATTIVA per la STESSA associazione/domanda/elaborazione: simula
  // un'associazione con più slot vinti nel round-robin (es. blocco allenamento su più fasce).
  const slot2 = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (spazio_id, stagione_id, giorno_settimana, orario_inizio, orario_fine)
     SELECT spazio_id, stagione_id, giorno_settimana, '19:00', '20:00' FROM slot_settimana_tipo WHERE id = $1 RETURNING id`,
    [fx.slotId],
  );
  const domanda = await pool.query<{ domanda_id: string }>(`SELECT domanda_id FROM assegnazioni WHERE id = (
     SELECT id FROM assegnazioni WHERE slot_id = $1 LIMIT 1)`, [fx.slotId]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, elaborazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, $4, 'singola', 60, 'validata')`,
    [slot2.rows[0]!.id, domanda.rows[0]!.domanda_id, fx.associazioneId, fx.elaborazioneId],
  );

  const voci = await trovaPropostaProvvisoria(pool, fx.stagioneId);
  assert.equal(voci.length, 2);
  // VA cumulativa = 60 + 60 = 120, FR finale = 100 => ISF = 1.200 su ENTRAMBE le righe,
  // non 0.600 (che sarebbe l'ISF calcolato sulla sola riga, il bug corretto in questa fix wave).
  for (const v of voci) {
    assert.equal(v.isf, '1.200');
  }
});

test('trovaPropostaProvvisoria: una sola riga per assegnazione anche con piu sorteggi vinti dalla stessa associazione (I1 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConAssegnazione(pool);

  // due sorteggi diversi, stessa elaborazione, stesso vincitore: simula un'associazione che
  // vince due tie-break diversi nella stessa elaborazione (occorrenza ordinaria).
  for (const articolo of ['B.20', 'B.21']) {
    await pool.query(
      `INSERT INTO sorteggi (elaborazione_id, articolo_riferimento, contesto, seme_hex, vincitore_associazione_id, hash_verbale)
       VALUES ($1, $2, 'test I1', $3, $4, $5)`,
      [fx.elaborazioneId, articolo, randomUUID().replace(/-/g, ''), fx.associazioneId, randomUUID()],
    );
  }

  const voci = await trovaPropostaProvvisoria(pool, fx.stagioneId);
  assert.equal(voci.length, 1);
  assert.ok(voci[0]!.sorteggioRiferimento !== null);
});

test('pubblicaProposta lancia ErroreNonTrovato su stagione inesistente', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  await assert.rejects(() => pubblicaProposta(pool, randomUUID()), ErroreNonTrovato);
});
