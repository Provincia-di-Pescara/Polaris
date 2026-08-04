import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  creaProposta,
  trovaPropostaPerId,
  listaPropostePerAssociazione,
  accettaProposta,
  annullaProposta,
  controlloAssegnazioneAttivaAttesa,
  controlloDisciplinaCompatibile,
  controlloLimitiConcentrazione,
  validaProposta,
  rigettaProposta,
} from './concertazione.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreRiferimentoNonValido, ErroreStatoNonValidoPerTransizione, ErroreNonTrovato } from './erroriDominio.ts';
import { leggiVersioneAttiva } from './repository/parametrico.ts';

const dsn = process.env.TEST_DATABASE_URL;

// concertazione_proposte.validata_da referenzia utenti_backoffice (FK reale, vedi
// db/migrations/000001): a differenza di quanto assunto nel commento originale del brief
// ("solo per il campo validata_da, nessuna FK di dominio verificata qui" — non vero, la FK
// esiste davvero), validaProposta richiede un id di operatore esistente, non un randomUUID()
// qualsiasi (violerebbe concertazione_proposte_validata_da_fkey). Stesso pattern già usato in
// abilitazioni.test.ts per decisa_da.
async function creaOperatoreTest(pool: Pool): Promise<string> {
  const email = `operatore-concertazione-${randomUUID()}@test.local`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, 'scrypt:test:test:test:test:test', 'Test', 'Operatore', 'operatore', 'attivo') RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
}

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

test('controlloAssegnazioneAttivaAttesa: ok se il cedente atteso corrisponde', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const esito = await controlloAssegnazioneAttivaAttesa(pool, fx.slotAId, fx.p1.associazioneId);
  assert.equal(esito.ok, true);
});

test('controlloAssegnazioneAttivaAttesa: fallisce se il cedente non corrisponde più', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const esito = await controlloAssegnazioneAttivaAttesa(pool, fx.slotAId, fx.p2.associazioneId);
  assert.equal(esito.ok, false);
});

test('controlloAssegnazioneAttivaAttesa: fallisce su blocco gara', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await pool.query(`UPDATE assegnazioni SET tipo = 'blocco_gara' WHERE slot_id = $1`, [fx.slotAId]);
  const esito = await controlloAssegnazioneAttivaAttesa(pool, fx.slotAId, fx.p1.associazioneId);
  assert.equal(esito.ok, false);
  assert.match(esito.motivo ?? '', /blocco gara/);
});

test('controlloAssegnazioneAttivaAttesa: utilizzo_slot_libero ok solo se slot davvero libero', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  assert.equal((await controlloAssegnazioneAttivaAttesa(pool, fx.slotLiberoId, null)).ok, true);
  assert.equal((await controlloAssegnazioneAttivaAttesa(pool, fx.slotAId, null)).ok, false);
});

test('controlloAssegnazioneAttivaAttesa: fallisce su slot indisponibile_permanente (C2 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await pool.query(`UPDATE slot_settimana_tipo SET indisponibile_permanente = true WHERE id = $1`, [fx.slotLiberoId]);
  const esito = await controlloAssegnazioneAttivaAttesa(pool, fx.slotLiberoId, null);
  assert.equal(esito.ok, false);
  assert.match(esito.motivo ?? '', /indisponibil/);
});

test('validaProposta: rigetta utilizzo_slot_libero su slot indisponibile_permanente (C2 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await pool.query(`UPDATE slot_settimana_tipo SET indisponibile_permanente = true WHERE id = $1`, [fx.slotLiberoId]);

  const proposta = await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }] },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  const esito = await validaProposta(pool, proposta.id, randomUUID());
  assert.equal(esito.esito, 'rigettata');
  assert.match(esito.motivazione ?? '', /indisponibil/);
});

test('controlloDisciplinaCompatibile: fallisce se il ricevente non ha domanda con disciplina compatibile', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const altra = await creaAssociazionePersona(pool, 'senza-domanda');
  const esito = await controlloDisciplinaCompatibile(pool, fx.slotAId, altra.associazioneId, fx.stagioneId);
  assert.equal(esito.ok, false);
});

test('controlloDisciplinaCompatibile: ok se compatibile', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const esito = await controlloDisciplinaCompatibile(pool, fx.slotAId, fx.p2.associazioneId, fx.stagioneId);
  assert.equal(esito.ok, true);
});

test('controlloLimitiConcentrazione: ok entro i limiti di default (600 min settimanali)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const esito = await controlloLimitiConcentrazione(pool, fx.stagioneId, fx.p1.associazioneId, [], [fx.slotBId]);
  assert.equal(esito.ok, true);
});

function minutiAOrario(minuti: number): string {
  const h = Math.floor(minuti / 60) % 24;
  const m = minuti % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function domandaIdPer(pool: Pool, associazioneId: string, stagioneId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(`SELECT id FROM domande WHERE associazione_id = $1 AND stagione_id = $2`, [associazioneId, stagioneId]);
  return r.rows[0]!.id;
}

async function assegnaSlot(pool: Pool, slotId: string, domandaId: string, associazioneId: string, valoreMinuti: number): Promise<void> {
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', $4, 'provvisoria')`,
    [slotId, domandaId, associazioneId, valoreMinuti],
  );
}

test('controlloLimitiConcentrazione: fallisce oltre i minuti settimanali massimi (I4 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const parametrico = (await leggiVersioneAttiva(pool))!;
  const max = Number(parametrico.minutiSettimanaliMax);

  const spazio = await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [fx.slotAId]);
  // durata sufficiente a superare da sola il limite anche sommata ai 60 min già assegnati
  // su slotA (fx) — non dipende dal valore esatto del default, letto dinamicamente sopra.
  const slotExtra = await creaSlot(pool, {
    stagioneId: fx.stagioneId,
    spazioId: spazio.rows[0]!.spazio_id,
    giornoSettimana: 5,
    orarioInizio: '00:00',
    orarioFine: minutiAOrario(max + 1),
  });

  const esito = await controlloLimitiConcentrazione(pool, fx.stagioneId, fx.p1.associazioneId, [], [slotExtra.id]);
  assert.equal(esito.ok, false);
  assert.match(esito.motivo ?? '', /minuti settimanali/);
});

test('controlloLimitiConcentrazione: fallisce oltre le fasce pregiate massime (I4 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const parametrico = (await leggiVersioneAttiva(pool))!;
  const maxPregiate = parametrico.fascePregiateMax;

  const spazio = await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [fx.slotAId]);
  const domandaId = await domandaIdPer(pool, fx.p1.associazioneId, fx.stagioneId);

  // porta p1 a maxPregiate fasce pregiate già assegnate
  for (let i = 0; i < maxPregiate; i++) {
    const slot = await creaSlot(pool, {
      stagioneId: fx.stagioneId,
      spazioId: spazio.rows[0]!.spazio_id,
      giornoSettimana: 6,
      orarioInizio: minutiAOrario(i * 60),
      orarioFine: minutiAOrario(i * 60 + 30),
      pregiata: true,
    });
    await assegnaSlot(pool, slot.id, domandaId, fx.p1.associazioneId, 30);
  }

  const slotExtraPregiata = await creaSlot(pool, {
    stagioneId: fx.stagioneId,
    spazioId: spazio.rows[0]!.spazio_id,
    giornoSettimana: 7,
    orarioInizio: '18:00',
    orarioFine: '18:30',
    pregiata: true,
  });

  const esito = await controlloLimitiConcentrazione(pool, fx.stagioneId, fx.p1.associazioneId, [], [slotExtraPregiata.id]);
  assert.equal(esito.ok, false);
  assert.match(esito.motivo ?? '', /fasce pregiate/);
});

test('controlloLimitiConcentrazione: fallisce oltre gli slot massimi nello stesso impianto (I4 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const parametrico = (await leggiVersioneAttiva(pool))!;
  const maxImpianto = parametrico.slotMaxStessoImpianto;

  const spazio = await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [fx.slotAId]);
  const domandaId = await domandaIdPer(pool, fx.p1.associazioneId, fx.stagioneId);

  // fx.slotAId conta già come 1 assegnazione su questo impianto: bastano maxImpianto-1 in più
  // per portare p1 esattamente al limite.
  for (let i = 0; i < maxImpianto - 1; i++) {
    const slot = await creaSlot(pool, {
      stagioneId: fx.stagioneId,
      spazioId: spazio.rows[0]!.spazio_id,
      giornoSettimana: 6,
      orarioInizio: minutiAOrario(i * 60),
      orarioFine: minutiAOrario(i * 60 + 30),
    });
    await assegnaSlot(pool, slot.id, domandaId, fx.p1.associazioneId, 30);
  }

  const slotExtraImpianto = await creaSlot(pool, {
    stagioneId: fx.stagioneId,
    spazioId: spazio.rows[0]!.spazio_id,
    giornoSettimana: 7,
    orarioInizio: '18:00',
    orarioFine: '18:30',
  });

  const esito = await controlloLimitiConcentrazione(pool, fx.stagioneId, fx.p1.associazioneId, [], [slotExtraImpianto.id]);
  assert.equal(esito.ok, false);
  assert.match(esito.motivo ?? '', /stesso impianto/);
});

test('controlloLimitiConcentrazione: netting — cessione contestuale evita il superamento (I4 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const parametrico = (await leggiVersioneAttiva(pool))!;
  const maxImpianto = parametrico.slotMaxStessoImpianto;

  const spazio = await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [fx.slotAId]);
  const domandaId = await domandaIdPer(pool, fx.p1.associazioneId, fx.stagioneId);

  // porta p1 esattamente a maxImpianto (fx.slotAId + maxImpianto-1 extra)
  const slotsExtra = [];
  for (let i = 0; i < maxImpianto - 1; i++) {
    const slot = await creaSlot(pool, {
      stagioneId: fx.stagioneId,
      spazioId: spazio.rows[0]!.spazio_id,
      giornoSettimana: 6,
      orarioInizio: minutiAOrario(i * 60),
      orarioFine: minutiAOrario(i * 60 + 30),
    });
    await assegnaSlot(pool, slot.id, domandaId, fx.p1.associazioneId, 30);
    slotsExtra.push(slot);
  }

  const slotRicevuto = await creaSlot(pool, {
    stagioneId: fx.stagioneId,
    spazioId: spazio.rows[0]!.spazio_id,
    giornoSettimana: 7,
    orarioInizio: '18:00',
    orarioFine: '18:30',
  });

  // cede uno dei suoi slot esistenti nello stesso impianto mentre ne riceve uno nuovo: il
  // conteggio netto resta a maxImpianto, non maxImpianto+1 — deve passare.
  const esitoSenzaCessione = await controlloLimitiConcentrazione(pool, fx.stagioneId, fx.p1.associazioneId, [], [slotRicevuto.id]);
  assert.equal(esitoSenzaCessione.ok, false); // controllo di sanità: senza cessione sfora

  const esitoConCessione = await controlloLimitiConcentrazione(pool, fx.stagioneId, fx.p1.associazioneId, [slotsExtra[0]!.id], [slotRicevuto.id]);
  assert.equal(esitoConCessione.ok, true);
});

async function propostaAccettata(pool: Pool, fx: Awaited<ReturnType<typeof creaFixture>>) {
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
  return accettaProposta(pool, proposta.id, fx.p2.associazioneId, fx.p2.personaId);
}

test('validaProposta: scambio bilaterale valido applica le assegnazioni e collega concertazione_proposta_id', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const proposta = await propostaAccettata(pool, fx);
  const admin = await creaOperatoreTest(pool); // validata_da referenzia utenti_backoffice per davvero

  const esito = await validaProposta(pool, proposta.id, admin);
  assert.equal(esito.esito, 'validata');

  const slotA = await pool.query<{ associazione_id: string; stato: string; concertazione_proposta_id: string | null }>(
    `SELECT associazione_id, stato, concertazione_proposta_id FROM assegnazioni WHERE slot_id = $1 AND stato = 'validata'`,
    [fx.slotAId],
  );
  assert.equal(slotA.rows[0]?.associazione_id, fx.p2.associazioneId);
  assert.equal(slotA.rows[0]?.concertazione_proposta_id, proposta.id);

  const slotAVecchia = await pool.query(`SELECT stato FROM assegnazioni WHERE slot_id = $1 AND associazione_id = $2`, [fx.slotAId, fx.p1.associazioneId]);
  assert.equal(slotAVecchia.rows[0]?.stato, 'sostituita');
});

test('validaProposta: rigetto automatico se il ricevente non ha disciplina compatibile', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  // p2 cede slotB a un'associazione con domanda ammessa ma disciplina diversa: creiamo una
  // terza associazione con domanda su una disciplina incompatibile con lo spazio.
  const disciplinaAltra = await creaDisciplina(pool, { codice: `NUOTO-${randomUUID().slice(0, 8)}`, denominazione: 'Nuoto' });
  const p3 = await creaAssociazionePersona(pool, 'tre');
  await creaDomanda(
    pool,
    {
      associazioneId: p3.associazioneId,
      stagioneId: fx.stagioneId,
      disciplineCodici: [disciplinaAltra.codice],
      numeroTesserati: 5,
      numeroAtletiPartecipanti: 5,
      numeroSquadre: 1,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000',
      fabbisognoOttimaleMinuti: '60.000',
      preferenze: [fx.slotLiberoId],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    p3.personaId,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE associazione_id = $1`, [p3.associazioneId]);

  const proposta = await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: p3.associazioneId }] },
    p3.personaId,
    p3.associazioneId,
  );
  // slotLibero è compatibile solo con la disciplina della fixture (Tennis), non con Nuoto
  const esito = await validaProposta(pool, proposta.id, randomUUID());
  assert.equal(esito.esito, 'rigettata');
  assert.match(esito.motivazione ?? '', /disciplina/);
});

test('validaProposta: blocca con FIFO se esiste una proposta più vecchia sullo stesso slot non ancora decisa', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const propostaVecchia = await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'cessione', slot: [{ slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId }] },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  await accettaProposta(pool, propostaVecchia.id, fx.p2.associazioneId, fx.p2.personaId);

  // una seconda proposta creata DOPO, sullo stesso slotA
  const propostaNuova = await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'cessione', slot: [{ slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId }] },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  await accettaProposta(pool, propostaNuova.id, fx.p2.associazioneId, fx.p2.personaId);

  await assert.rejects(() => validaProposta(pool, propostaNuova.id, randomUUID()), /precedente/);
  // la più vecchia invece deve poter essere validata
  const admin = await creaOperatoreTest(pool);
  const esito = await validaProposta(pool, propostaVecchia.id, admin);
  assert.equal(esito.esito, 'validata');
});

test('validaProposta: su slot pregiata il valore_minuti persistito è ponderato (C1 final review)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  // Slot pregiata nello stesso spazio del fixture, libero: usiamo utilizzo_slot_libero così
  // non serve un cedente/assegnazione preesistente da spostare.
  const spazio = await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [fx.slotAId]);
  const slotPregiata = await creaSlot(pool, {
    stagioneId: fx.stagioneId,
    spazioId: spazio.rows[0]!.spazio_id,
    giornoSettimana: 4,
    orarioInizio: '18:00',
    orarioFine: '19:00',
    pregiata: true,
  });

  const proposta = await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: slotPregiata.id, associazioneRiceventeId: fx.p1.associazioneId }] },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  const admin = await creaOperatoreTest(pool);
  const esito = await validaProposta(pool, proposta.id, admin);
  assert.equal(esito.esito, 'validata');

  const parametrico = await leggiVersioneAttiva(pool);
  const atteso = 60 * Number(parametrico!.pesoFasciaPregiata);

  const riga = await pool.query<{ valore_minuti: string }>(
    `SELECT valore_minuti::text AS valore_minuti FROM assegnazioni WHERE slot_id = $1 AND stato = 'validata'`,
    [slotPregiata.id],
  );
  assert.equal(Number(riga.rows[0]!.valore_minuti), Number(atteso.toFixed(3)));
});

test('rigettaProposta: rigetto manuale su proposta accettata_da_tutti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const proposta = await propostaAccettata(pool, fx);
  const rigettata = await rigettaProposta(pool, proposta.id, 'motivo discrezionale di test');
  assert.equal(rigettata.stato, 'rigettata');
  assert.equal(rigettata.motivazioneRigetto, 'motivo discrezionale di test');
});
