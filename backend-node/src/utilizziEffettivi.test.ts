import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { registraUtilizzo, trovaUtilizzoPerId, listaUtilizziPerAssegnazione, listaUtilizziPerAssociazione, presentaGiustificazione, accogliGiustificazione, rigettaGiustificazione } from './utilizziEffettivi.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione, ErroreRiferimentoNonValido, ErroreValoreDuplicato } from './erroriDominio.ts';
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
  const utente = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato, ultimo_accesso_il) VALUES ($1, 'test', 'Test', 'Operatore', 'operatore', 'attivo', now()) RETURNING id`,
    [`operatore-${randomUUID()}@test.local`],
  );
  return {
    stagioneId, slotId: slot.id, assegnazioneId: assegnazione.rows[0]!.id,
    associazioneId: associazione.rows[0]!.id, operatoreId: utente.rows[0]!.id,
  };
}

// --- Guardie I1/I2 (final review): imputabilità e unicità dell'occorrenza rilevata ---

test('registraUtilizzo: 404 se l\'assegnazione non esiste', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  await assert.rejects(
    () => registraUtilizzo(pool, { assegnazioneId: randomUUID(), data: '2030-10-07', esito: 'utilizzato' }),
    ErroreNonTrovato,
  );
});

test('I2: registraUtilizzo rifiuta una data fuori dal calendario della stagione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await assert.rejects(
    () => registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2029-10-01', esito: 'utilizzato' }),
    ErroreRiferimentoNonValido,
  );
});

test('I2: registraUtilizzo rifiuta una data nel giorno della settimana sbagliato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  // la fascia è di lunedì (giornoSettimana 1); 2030-10-08 è un martedì
  await assert.rejects(
    () => registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-08', esito: 'utilizzato' }),
    ErroreRiferimentoNonValido,
  );
});

test('I2: registraUtilizzo rifiuta la seconda rilevazione sulla stessa occorrenza', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' });
  await assert.rejects(
    () => registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' }),
    ErroreValoreDuplicato,
  );
});

test('I1(a): mancato non registrabile su un\'occorrenza coperta da indisponibilità sopravvenuta', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await pool.query(
    `INSERT INTO indisponibilita_sopravvenute (slot_id, dal, al, motivo, comunicata_da)
     VALUES ($1, '2030-10-07', '2030-10-07', 'seggio elettorale', 'istituzione_scolastica')`,
    [fx.slotId],
  );

  await assert.rejects(
    () => registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' }),
    ErroreRiferimentoNonValido,
  );
  // l'esito corretto per quella data resta registrabile
  const ok = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'indisponibilita_impianto' });
  assert.equal(ok.esito, 'indisponibilita_impianto');
});

test('I1(b): mancato non registrabile su un\'occorrenza ceduta con variazione ordinaria accettata (art. B.32)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  // liberazione accettata: in quella data l'occorrenza non ha più un titolare
  await pool.query(
    `INSERT INTO variazioni_ordinarie (tipo, slot_id, data, richiesta_da_associazione_id, richiesta_da_persona_fisica_id, stato)
     VALUES ('liberazione', $1, '2030-10-07', $2,
             (SELECT id FROM persone_fisiche LIMIT 1), 'accettata')`,
    [fx.slotId, fx.associazioneId],
  );

  await assert.rejects(
    () => registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' }),
    ErroreRiferimentoNonValido,
  );
});

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

test('presentaGiustificazione: apre solo se non_utilizzato_non_giustificato con finestra aperta', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' });

  const presentata = await presentaGiustificazione(pool, utilizzo.id, 'assenza per lavori improvvisi in impianto');
  assert.equal(presentata.giustificazioneTesto, 'assenza per lavori improvvisi in impianto');
  assert.ok(presentata.giustificazionePresentataIl !== null);

  await assert.rejects(() => presentaGiustificazione(pool, utilizzo.id, 'seconda presentazione'), ErroreStatoNonValidoPerTransizione);
});

test('presentaGiustificazione: 404 se non trovato, 409 se finestra scaduta', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  await assert.rejects(() => presentaGiustificazione(pool, randomUUID(), 'x'), ErroreNonTrovato);

  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-14', esito: 'non_utilizzato_non_giustificato' });
  await pool.query(`UPDATE utilizzi_effettivi SET giustificazione_scade_il = now() - interval '1 day' WHERE id = $1`, [utilizzo.id]);
  await assert.rejects(() => presentaGiustificazione(pool, utilizzo.id, 'tardiva'), ErroreStatoNonValidoPerTransizione);
});

test('accogliGiustificazione: sposta esito a non_utilizzato_giustificato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-21', esito: 'non_utilizzato_non_giustificato' });
  await presentaGiustificazione(pool, utilizzo.id, 'motivo valido');

  const accolta = await accogliGiustificazione(pool, utilizzo.id, fx.operatoreId);
  assert.equal(accolta.esito, 'non_utilizzato_giustificato');
  assert.equal(accolta.giustificazioneDecisaDa, fx.operatoreId);

  await assert.rejects(() => accogliGiustificazione(pool, utilizzo.id, fx.operatoreId), ErroreStatoNonValidoPerTransizione);
});

test('accogliGiustificazione: 409 se nessuna giustificazione presentata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-28', esito: 'non_utilizzato_non_giustificato' });

  await assert.rejects(() => accogliGiustificazione(pool, utilizzo.id, randomUUID()), ErroreStatoNonValidoPerTransizione);
});

test('rigettaGiustificazione: esito resta non_utilizzato_non_giustificato, motivazione registrata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-11-04', esito: 'non_utilizzato_non_giustificato' });
  await presentaGiustificazione(pool, utilizzo.id, 'motivo debole');

  const rigettata = await rigettaGiustificazione(pool, utilizzo.id, fx.operatoreId, 'giustificazione non pertinente');
  assert.equal(rigettata.esito, 'non_utilizzato_non_giustificato');
  assert.equal(rigettata.giustificazioneMotivazioneRigetto, 'giustificazione non pertinente');
});
