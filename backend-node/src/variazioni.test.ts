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
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-var-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotLibero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaAssociazionePersona(pool, 'uno');
  const p2 = await creaAssociazionePersona(pool, 'due');

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

  return { stagioneId, slotAId: slotA.id, slotLiberoId: slotLibero.id, p1, p2 };
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
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2030-11-11', associazioneId: fx.p1.associazioneId },
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
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2030-12-02', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  const lista = await listaVariazioniPerStagione(pool, fx.stagioneId, { tipo: 'utilizzo_occasionale', stato: 'accettata' });
  assert.equal(lista.length, 1);
  const vuota = await listaVariazioniPerStagione(pool, fx.stagioneId, { tipo: 'liberazione' });
  assert.equal(vuota.length, 0);
});
