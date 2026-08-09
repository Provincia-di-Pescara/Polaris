import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { trovaProprietarioOccorrenza, creaVariazione, accettaVariazione, annullaVariazione, listaVariazioniPerStagione } from './variazioni.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreRiferimentoNonValido, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaAssociazionePersona(pool: Pool, label: string) {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD var ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [`TSTVAR${randomUUID().slice(0, 10).toUpperCase()}`, label, randomUUID()],
  );
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id };
}

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `SCI-${randomUUID().slice(0, 8)}`, denominazione: 'Sci' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto var ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra var', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo var', disciplineCompatibili: [disciplina.codice] });
  // stato 'definitiva': le variazioni ordinarie (art. B.32) presuppongono un quadro
  // assegnativo già approvato — precondizione verificata da creaVariazione.
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'definitiva') RETURNING id`,
    [`stagione-var-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotLibero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotB = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 5, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotLibero2 = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaAssociazionePersona(pool, 'uno');
  const p2 = await creaAssociazionePersona(pool, 'due');
  const p3 = await creaAssociazionePersona(pool, 'tre'); // nessuna domanda: disciplina mai compatibile

  const datiDomanda = {
    disciplineCodici: [disciplina.codice], numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1,
    numeroSquadreFederaliStagionePrecedente: 0, attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
    fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000', richiedeGiornataGara: false, richiesteGiornataGara: [],
  };
  const d1 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p1.associazioneId, stagioneId, preferenze: [slotA.id], blocchiAllenamento: [] }, p1.personaId);
  const d2 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p2.associazioneId, stagioneId, preferenze: [slotLibero.id], blocchiAllenamento: [] }, p2.personaId);
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = ANY($1)`, [[d1.id, d2.id]]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotA.id, d1.id, p1.associazioneId],
  );
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotB.id, d2.id, p2.associazioneId],
  );

  return {
    stagioneId,
    slotAId: slotA.id,
    slotLiberoId: slotLibero.id,
    slotBId: slotB.id,
    slotLibero2Id: slotLibero2.id,
    p1, p2, p3,
  };
}

async function creaIndisponibilitaSuSlot(pool: Pool, slotId: string, giorno: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO indisponibilita_sopravvenute (slot_id, dal, al, motivo, comunicata_da, notificata_alle_associazioni_il)
     VALUES ($1, $2, $2, 'lavori', 'istituzione_scolastica', now()) RETURNING id`,
    [slotId, giorno],
  );
  return r.rows[0]!.id;
}

test('trovaProprietarioOccorrenza: assegnazione permanente se nessuna variazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2030-10-07'), fx.p1.associazioneId);
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotLiberoId, '2030-10-07'), null);
});

test('creaVariazione utilizzo_occasionale su slot libero: accettata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const variazione = await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2030-10-09', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  assert.equal(variazione.stato, 'accettata');
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotLiberoId, '2030-10-09'), fx.p1.associazioneId);
});

test('creaVariazione utilizzo_occasionale su slot occupato: rifiutata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const variazione = await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2030-10-07', associazioneId: fx.p2.associazioneId },
    fx.p2.personaId,
  );
  assert.equal(variazione.stato, 'rifiutata');
  assert.ok(variazione.motivazioneRifiuto);
});

test('creaVariazione liberazione: solo il proprietario può liberare, poi lo slot risulta libero quel giorno', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const nonProprietario = await creaVariazione(
    pool,
    { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2030-10-07', associazioneId: fx.p2.associazioneId },
    fx.p2.personaId,
  );
  assert.equal(nonProprietario.stato, 'rifiutata');

  const proprietario = await creaVariazione(
    pool,
    { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2030-10-14', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  assert.equal(proprietario.stato, 'accettata');
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2030-10-14'), null);
});

test('creaVariazione scambio_temporaneo: nasce in_attesa_accettazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const variazione = await creaVariazione(
    pool,
    {
      tipo: 'scambio_temporaneo', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2030-10-21', associazioneId: fx.p1.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2030-10-23',
      controparteAssociazioneId: fx.p2.associazioneId,
    },
    fx.p1.personaId,
  );
  assert.equal(variazione.stato, 'in_attesa_accettazione');
});

test('creaVariazione rifiuta slot fuori stagione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await assert.rejects(
    () =>
      creaVariazione(
        pool,
        { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: randomUUID(), data: '2030-10-07', associazioneId: fx.p1.associazioneId },
        fx.p1.personaId,
      ),
    ErroreRiferimentoNonValido,
  );
});

test('accettaVariazione: scambio valido transiziona ad accettata, entrambi i lati risultano scambiati', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const proposta = await creaVariazione(
    pool,
    {
      tipo: 'scambio_temporaneo', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2030-11-04', associazioneId: fx.p1.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2030-11-06',
      controparteAssociazioneId: fx.p2.associazioneId,
    },
    fx.p1.personaId,
  );

  const accettata = await accettaVariazione(pool, proposta.id, fx.p2.associazioneId);
  assert.equal(accettata.stato, 'accettata');
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2030-11-04'), fx.p2.associazioneId);
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotLiberoId, '2030-11-06'), fx.p1.associazioneId);
});

test('accettaVariazione: 409 se non in_attesa_accettazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const variazione = await creaVariazione(
    pool,
    // 2030-11-13 è un mercoledì, come giornoSettimana=3 di slotLibero (la data precedente
    // era un lunedì: incoerenza di fixture emersa col controllo giorno-settimana, I7)
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2030-11-13', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  await assert.rejects(() => accettaVariazione(pool, variazione.id, fx.p2.associazioneId), ErroreStatoNonValidoPerTransizione);
});

test('annullaVariazione: solo prima dell\'accettazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const proposta = await creaVariazione(
    pool,
    {
      tipo: 'scambio_temporaneo', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2030-11-18', associazioneId: fx.p1.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2030-11-20',
      controparteAssociazioneId: fx.p2.associazioneId,
    },
    fx.p1.personaId,
  );
  const annullata = await annullaVariazione(pool, proposta.id);
  assert.equal(annullata.stato, 'annullata');
  await assert.rejects(() => accettaVariazione(pool, proposta.id, fx.p2.associazioneId), ErroreStatoNonValidoPerTransizione);
});

test('listaVariazioniPerStagione filtra per tipo e stato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2030-12-04', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  const lista = await listaVariazioniPerStagione(pool, fx.stagioneId, { tipo: 'utilizzo_occasionale', stato: 'accettata' });
  assert.equal(lista.length, 1);
  const vuota = await listaVariazioniPerStagione(pool, fx.stagioneId, { tipo: 'liberazione' });
  assert.equal(vuota.length, 0);
});

// ---------------------------------------------------------------------------
// Regressioni della final review (C1, C2, I1, I3, I4, I5, I6, I7)
// ---------------------------------------------------------------------------

test('recupero valido: indisponibilità sulla propria occorrenza, destinazione libera → accettata (I5)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const indisponibilitaId = await creaIndisponibilitaSuSlot(pool, fx.slotAId, '2031-01-06'); // lunedì

  const variazione = await creaVariazione(
    pool,
    {
      tipo: 'recupero', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2031-01-06', associazioneId: fx.p1.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2031-01-08', // mercoledì
      indisponibilitaId,
    },
    fx.p1.personaId,
  );
  assert.equal(variazione.stato, 'accettata', variazione.motivazioneRifiuto ?? '');
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotLiberoId, '2031-01-08'), fx.p1.associazioneId);
});

test('CRITICAL C1: recupero senza indisponibilità collegata → rifiutato, la fascia altrui resta del titolare', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  // p2 punta al slot di p1 senza alcuna indisponibilità: prima era accettato e rendeva
  // l'occorrenza di p1 "libera" agli occhi di trovaProprietarioOccorrenza.
  const variazione = await creaVariazione(
    pool,
    {
      tipo: 'recupero', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2031-01-13', associazioneId: fx.p2.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2031-01-15',
    },
    fx.p2.personaId,
  );
  assert.equal(variazione.stato, 'rifiutata');
  assert.match(variazione.motivazioneRifiuto!, /indisponibilità/i);
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2031-01-13'), fx.p1.associazioneId);
});

test('CRITICAL C1: recupero da chi non è titolare dell\'occorrenza persa → rifiutato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const indisponibilitaId = await creaIndisponibilitaSuSlot(pool, fx.slotAId, '2031-01-20');

  // L'indisponibilità è reale e riguarda proprio quella fascia+data, ma il titolare è p1.
  const variazione = await creaVariazione(
    pool,
    {
      tipo: 'recupero', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2031-01-20', associazioneId: fx.p2.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2031-01-22',
      indisponibilitaId,
    },
    fx.p2.personaId,
  );
  assert.equal(variazione.stato, 'rifiutata');
  assert.match(variazione.motivazioneRifiuto!, /titolare/i);
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2031-01-20'), fx.p1.associazioneId);
});

test('CRITICAL C2: due variazioni concorrenti sulla stessa destinazione, una sola accettata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const indA = await creaIndisponibilitaSuSlot(pool, fx.slotAId, '2031-02-03'); // lunedì, p1
  const indB = await creaIndisponibilitaSuSlot(pool, fx.slotBId, '2031-02-07'); // venerdì, p2

  // Origini DIVERSE (nessun vincolo di unicità le lega), stessa destinazione: prima del fix
  // entrambe le transazioni vedevano la destinazione libera e committavano 'accettata'.
  const destinazione = { slotDestinazioneId: fx.slotLibero2Id, dataDestinazione: '2031-02-04' }; // martedì

  // Pre-riscaldamento del pool: senza, la seconda pool.connect() paga l'apertura di una
  // nuova connessione (TCP+auth, decine di ms) mentre la prima transazione gira già su una
  // connessione calda — le due catene finiscono per essere sequenziali e il test passerebbe
  // anche senza lock (verificato: falsificazione con lock e indice disattivati → verde).
  const preriscaldate = await Promise.all([pool.connect(), pool.connect()]);
  for (const c of preriscaldate) c.release();

  async function inTransazione(dati: Parameters<typeof creaVariazione>[1], personaId: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const v = await creaVariazione(client, dati, personaId);
      await client.query('COMMIT');
      return v;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const esiti = await Promise.allSettled([
    inTransazione(
      { tipo: 'recupero', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2031-02-03', associazioneId: fx.p1.associazioneId, indisponibilitaId: indA, ...destinazione },
      fx.p1.personaId,
    ),
    inTransazione(
      { tipo: 'recupero', stagioneId: fx.stagioneId, slotId: fx.slotBId, data: '2031-02-07', associazioneId: fx.p2.associazioneId, indisponibilitaId: indB, ...destinazione },
      fx.p2.personaId,
    ),
  ]);

  const accettate = esiti.filter((e) => e.status === 'fulfilled' && e.value.stato === 'accettata');
  assert.equal(accettate.length, 1, `esiti: ${JSON.stringify(esiti.map((e) => (e.status === 'fulfilled' ? e.value.stato : String(e.reason))))}`);
  const attive = await pool.query(
    `SELECT 1 FROM variazioni_ordinarie WHERE slot_destinazione_id = $1 AND data_destinazione = $2 AND stato IN ('in_attesa_accettazione','accettata')`,
    [fx.slotLibero2Id, '2031-02-04'],
  );
  assert.equal(attive.rowCount, 1);
});

test('I3: destinazione coperta da indisponibilità sopravvenuta o permanentemente indisponibile → rifiutata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await creaIndisponibilitaSuSlot(pool, fx.slotLiberoId, '2031-02-12'); // mercoledì

  const sopravvenuta = await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2031-02-12', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  assert.equal(sopravvenuta.stato, 'rifiutata');
  assert.match(sopravvenuta.motivazioneRifiuto!, /indisponibile/i);

  await pool.query(`UPDATE slot_settimana_tipo SET indisponibile_permanente = true WHERE id = $1`, [fx.slotLibero2Id]);
  const permanente = await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLibero2Id, data: '2031-02-11', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  assert.equal(permanente.stato, 'rifiutata');
  assert.match(permanente.motivazioneRifiuto!, /permanentemente indisponibile/i);
});

test('I4: nessuna variazione se la stagione non ha ancora una settimana tipo definitiva', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await pool.query(`UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1`, [fx.stagioneId]);

  await assert.rejects(
    () =>
      creaVariazione(
        pool,
        { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2031-03-03', associazioneId: fx.p1.associazioneId },
        fx.p1.personaId,
      ),
    ErroreStatoNonValidoPerTransizione,
  );
});

test('I6: scambio pendente sull\'occorrenza altrui rifiutato subito, il titolare resta libero di agire', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  // p2 tenta di "prenotare" l'occorrenza di p1 con uno scambio pendente.
  const squat = await creaVariazione(
    pool,
    {
      tipo: 'scambio_temporaneo', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2031-03-10', associazioneId: fx.p2.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2031-03-12',
      controparteAssociazioneId: fx.p1.associazioneId,
    },
    fx.p2.personaId,
  );
  assert.equal(squat.stato, 'rifiutata');

  // Una riga 'rifiutata' non occupa variazioni_occorrenza_attiva_uq: p1 può ancora liberare.
  const liberazione = await creaVariazione(
    pool,
    { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2031-03-10', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  assert.equal(liberazione.stato, 'accettata');
});

test('I7: data fuori dal calendario di stagione o nel giorno sbagliato → errore di riferimento', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  await assert.rejects(
    () =>
      creaVariazione(
        pool,
        { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2035-01-01', associazioneId: fx.p1.associazioneId },
        fx.p1.personaId,
      ),
    ErroreRiferimentoNonValido,
  );
  // 2031-03-11 è un martedì, slotA è di lunedì
  await assert.rejects(
    () =>
      creaVariazione(
        pool,
        { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2031-03-11', associazioneId: fx.p1.associazioneId },
        fx.p1.personaId,
      ),
    ErroreRiferimentoNonValido,
  );
});

test('I1: in uno scambio anche la controparte deve avere disciplina compatibile sull\'origine', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  // p3 non ha alcuna domanda ammessa: non può ricevere l'occorrenza di origine.
  const proposta = await creaVariazione(
    pool,
    {
      tipo: 'scambio_temporaneo', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2031-03-17', associazioneId: fx.p1.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2031-03-19',
      controparteAssociazioneId: fx.p3.associazioneId,
    },
    fx.p1.personaId,
  );
  assert.equal(proposta.stato, 'in_attesa_accettazione');

  const esito = await accettaVariazione(pool, proposta.id, fx.p3.associazioneId);
  assert.equal(esito.stato, 'rifiutata');
  assert.match(esito.motivazioneRifiuto!, /disciplina/i);
  // l'origine resta di p1
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2031-03-17'), fx.p1.associazioneId);
});
