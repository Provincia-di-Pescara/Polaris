import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaProposta, trovaPropostaPerId, listaPropostePerAssociazione, accettaProposta, annullaProposta } from './concertazione.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreRiferimentoNonValido, ErroreStatoNonValidoPerTransizione, ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaAssociazionePersona(pool: Pool, label: string) {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [`TSTCRT${randomUUID().slice(0, 10).toUpperCase()}`, label, randomUUID()],
  );
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id };
}

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `TENNIS-${randomUUID().slice(0, 8)}`, denominazione: 'Tennis' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto concertazione ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra concertazione', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo unico', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-concertazione-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotB = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotLibero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaAssociazionePersona(pool, 'uno');
  const p2 = await creaAssociazionePersona(pool, 'due');

  const datiDomanda = {
    disciplineCodici: [disciplina.codice],
    numeroTesserati: 10,
    numeroAtletiPartecipanti: 8,
    numeroSquadre: 1,
    numeroSquadreFederaliStagionePrecedente: 0,
    attivitaGiovanile: true,
    attivitaAgonistica: false,
    attivitaParalimpicaInclusiva: false,
    fabbisognoMinimoMinuti: '60.000',
    fabbisognoOttimaleMinuti: '120.000',
    richiedeGiornataGara: false,
    richiesteGiornataGara: [],
  };
  const domanda1 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p1.associazioneId, stagioneId, preferenze: [slotA.id], blocchiAllenamento: [] }, p1.personaId);
  const domanda2 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p2.associazioneId, stagioneId, preferenze: [slotB.id], blocchiAllenamento: [] }, p2.personaId);
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = ANY($1)`, [[domanda1.id, domanda2.id]]);

  // assegnazione attiva: slotA a p1, slotB a p2 (simula esito del round-robin)
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotA.id, domanda1.id, p1.associazioneId],
  );
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotB.id, domanda2.id, p2.associazioneId],
  );

  return { stagioneId, slotAId: slotA.id, slotBId: slotB.id, slotLiberoId: slotLibero.id, ...p1, p1, p2 };
}

test('creaProposta scambio bilaterale nasce in_attesa_accettazione con entrambe le parti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const proposta = await creaProposta(
    pool,
    {
      stagioneId: fx.stagioneId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId },
        { slotId: fx.slotBId, associazioneCedenteId: fx.p2.associazioneId, associazioneRiceventeId: fx.p1.associazioneId },
      ],
    },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );

  assert.equal(proposta.stato, 'in_attesa_accettazione');
  assert.equal(proposta.parti.length, 2);
  assert.ok(proposta.parti.some((p) => p.associazioneId === fx.p1.associazioneId && p.accettatoIl !== null)); // proponente auto-accettante
  assert.ok(proposta.parti.some((p) => p.associazioneId === fx.p2.associazioneId && p.accettatoIl === null));
});

test('creaProposta utilizzo_slot_libero con parte singola nasce già accettata_da_tutti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const proposta = await creaProposta(
    pool,
    {
      stagioneId: fx.stagioneId,
      tipo: 'utilizzo_slot_libero',
      slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }],
    },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );

  assert.equal(proposta.stato, 'accettata_da_tutti');
  assert.equal(proposta.parti.length, 1);
});

test('creaProposta rifiuta slot fuori stagione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await assert.rejects(
    () =>
      creaProposta(
        pool,
        { stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: randomUUID(), associazioneRiceventeId: fx.p1.associazioneId }] },
        fx.p1.personaId,
        fx.p1.associazioneId,
      ),
    ErroreRiferimentoNonValido,
  );
});

test('accettaProposta: seconda parte accetta -> accettata_da_tutti; annullaProposta funziona prima della validazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const proposta = await creaProposta(
    pool,
    {
      stagioneId: fx.stagioneId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId },
        { slotId: fx.slotBId, associazioneCedenteId: fx.p2.associazioneId, associazioneRiceventeId: fx.p1.associazioneId },
      ],
    },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );

  const accettata = await accettaProposta(pool, proposta.id, fx.p2.associazioneId, fx.p2.personaId);
  assert.equal(accettata.stato, 'accettata_da_tutti');

  await assert.rejects(() => accettaProposta(pool, proposta.id, fx.p2.associazioneId, fx.p2.personaId), ErroreStatoNonValidoPerTransizione);

  const annullata = await annullaProposta(pool, proposta.id);
  assert.equal(annullata.stato, 'annullata');
});

test('trovaPropostaPerId ritorna null su id inesistente, listaPropostePerAssociazione trova la propria', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  assert.equal(await trovaPropostaPerId(pool, randomUUID()), null);

  await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }] },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  const lista = await listaPropostePerAssociazione(pool, fx.p1.associazioneId, fx.stagioneId);
  assert.equal(lista.length, 1);
});
