// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './client.ts';
import { creaAssociazione } from './associazioni.ts';
import { creaDomanda } from './domande.ts';
import {
  propostaProvvisoria,
  creaProposta,
  listaProposteConcertazione,
  trovaPropostaConcertazione,
  accettaProposta,
  annullaProposta,
} from './concertazione.ts';

class StorageLocaleFinta implements Storage {
  private mappa = new Map<string, string>();
  get length(): number {
    return this.mappa.size;
  }
  clear(): void {
    this.mappa.clear();
  }
  getItem(chiave: string): string | null {
    return this.mappa.has(chiave) ? this.mappa.get(chiave)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.mappa.keys())[index] ?? null;
  }
  removeItem(chiave: string): void {
    this.mappa.delete(chiave);
  }
  setItem(chiave: string, valore: string): void {
    this.mappa.set(chiave, valore);
  }
}
globalThis.localStorage = new StorageLocaleFinta();

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

const referenteTest = {
  nome: 'Luca',
  cognome: 'Bianchi',
  natoA: 'Pescara',
  natoIl: '1980-01-01',
  residenteVia: 'Via Roma 1',
  residenteCitta: 'Pescara',
  cellulare: '3331234567',
  cartaIdentita: 'CI12345',
};

const referenteEmergenzeDaeTest = {
  ...referenteTest,
  daeMarca: 'Marca DAE',
  daeMatricola: 'DAE-001',
  daeScadenza: '2030-01-01',
};

const assicurazioneTest = {
  compagnia: 'Compagnia Assicurativa SpA',
  numeroPolizza: 'POL-001',
  massimale: '1000000.00',
  coperturaDal: '2026-01-01',
  coperturaAl: '2027-01-01',
};

async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-concertazione-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

async function creaSlotTest(
  pool: Pool,
  stagioneId: string,
  impiantiCreate: string[],
  giornoSettimana: number,
): Promise<{ slotId: string; impiantoDenominazione: string; spazioDenominazione: string }> {
  const impiantoDenominazione = `Impianto Test ${randomUUID().slice(0, 8)}`;
  const impiantoRes = await pool.query<{ id: string }>(
    `INSERT INTO impianti (denominazione) VALUES ($1) RETURNING id`,
    [impiantoDenominazione],
  );
  const impiantoId = impiantoRes.rows[0]!.id;
  impiantiCreate.push(impiantoId);

  const spazioDenominazione = `Spazio Test ${randomUUID().slice(0, 8)}`;
  const spazioRes = await pool.query<{ id: string }>(
    `INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, $2) RETURNING id`,
    [impiantoId, spazioDenominazione],
  );
  const spazioId = spazioRes.rows[0]!.id;

  const slotRes = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, $3, '09:00', '10:00') RETURNING id`,
    [stagioneId, spazioId, giornoSettimana],
  );
  return { slotId: slotRes.rows[0]!.id, impiantoDenominazione, spazioDenominazione };
}

descrivi('concertazione.ts', () => {
  let backend: BackendReale;
  let pool: Pool;
  const personeCreate: PersonaTest[] = [];
  const associazioniCreate: string[] = [];
  const stagioniCreate: string[] = [];
  const disciplineCreate: string[] = [];
  const impiantiCreate: string[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    if (associazioniCreate.length > 0) {
      const personeDaAbilitazioni = (
        await pool.query<{ persona_fisica_id: string }>(
          'SELECT DISTINCT persona_fisica_id FROM abilitazioni WHERE associazione_id = ANY($1::uuid[])',
          [associazioniCreate],
        )
      ).rows.map((r) => r.persona_fisica_id);
      await pool.query('DELETE FROM associazioni_documenti WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM concertazione_proposta_parti WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query(
        'DELETE FROM concertazione_proposta_slot WHERE associazione_cedente_id = ANY($1::uuid[]) OR associazione_ricevente_id = ANY($1::uuid[])',
        [associazioniCreate],
      );
      await pool.query('DELETE FROM concertazione_proposte WHERE proponente_associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM preferenze WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM assegnazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM richieste_giornata_gara WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM blocco_allenamento_slot WHERE blocco_id IN (SELECT id FROM blocchi_allenamento_richiesti WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[])))', [associazioniCreate]);
      await pool.query('DELETE FROM blocchi_allenamento_richiesti WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM domanda_discipline WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM fabbisogni_riconosciuti WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM coefficienti_associazione WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM osservazioni_istruttoria WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM domande WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM log_operazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM abilitazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM associazioni WHERE id = ANY($1::uuid[])', [associazioniCreate]);
      const idPersoneTracciate = new Set(personeCreate.map((p) => p.persona.id));
      const idPersoneShell = personeDaAbilitazioni.filter((id) => !idPersoneTracciate.has(id));
      if (idPersoneShell.length > 0) {
        await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [idPersoneShell]);
        await pool.query('DELETE FROM persone_fisiche WHERE id = ANY($1::uuid[])', [idPersoneShell]);
      }
    }
    if (disciplineCreate.length > 0) {
      await pool.query('DELETE FROM discipline_sportive WHERE codice = ANY($1::text[])', [disciplineCreate]);
    }
    if (stagioniCreate.length > 0) {
      await pool.query('DELETE FROM stagioni_sportive WHERE id = ANY($1::uuid[])', [stagioniCreate]);
    }
    if (impiantiCreate.length > 0) {
      await pool.query('DELETE FROM impianti WHERE id = ANY($1::uuid[])', [impiantiCreate]);
    }

    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.end();
  });

  async function creaDisciplinaTest(): Promise<string> {
    const disciplinaCodice = `DISC${randomUUID().slice(0, 6).toUpperCase()}`;
    await pool.query(`INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, 'Disciplina Test Concertazione')`, [
      disciplinaCodice,
    ]);
    disciplineCreate.push(disciplinaCodice);
    return disciplinaCodice;
  }

  async function creaAssociazioneConDomandaAmmessa(
    persona: PersonaTest,
    stagioneId: string,
    disciplinaCodice: string,
    label: string,
    preferenzaSlotId: string,
  ): Promise<string> {
    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Concertazione ${label} ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-${label}-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: persona.persona.nome,
      rappresentanteLegaleCognome: persona.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: `asd-concertazione-${label}-${suffisso}@example.com`.toLowerCase(),
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
      referenteSicurezza: referenteTest,
      referenteEmergenzeDae: referenteEmergenzeDaeTest,
      assicurazioneRct: assicurazioneTest,
    });
    associazioniCreate.push(associazione.id);
    await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE associazione_id = $1`, [associazione.id]);

    const domanda = await creaDomanda({
      associazioneId: associazione.id,
      stagioneId,
      disciplineCodici: [disciplinaCodice],
      numeroTesserati: 20,
      numeroAtletiPartecipanti: 15,
      numeroSquadre: 1,
      numeroSquadreFederaliStagionePrecedente: 1,
      attivitaGiovanile: true,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '240',
      fabbisognoOttimaleMinuti: '480',
      preferenze: [preferenzaSlotId],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    });
    await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
    return associazione.id;
  }

  it('propostaProvvisoria restituisce le voci con denominazioni e dettagli slot leggibili', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);
    const disciplinaCodice = await creaDisciplinaTest();
    const slot = await creaSlotTest(pool, stagioneId, impiantiCreate, 1);

    const associazioneId = await creaAssociazioneConDomandaAmmessa(persona, stagioneId, disciplinaCodice, 'PP', slot.slotId);

    const domandaRes = await pool.query<{ id: string }>(`SELECT id FROM domande WHERE associazione_id = $1`, [associazioneId]);
    const domandaId = domandaRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, stato, valore_minuti)
       VALUES ($1, $2, $3, 'singola', 'validata', 60.000)`,
      [slot.slotId, domandaId, associazioneId],
    );

    await pool.query(`UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1`, [stagioneId]);

    const voci = await propostaProvvisoria(stagioneId);
    expect(Array.isArray(voci)).toBe(true);
    const voce = voci.find((v) => v.slotId === slot.slotId);
    expect(voce).toBeTruthy();
    expect(voce!.associazioneId).toBe(associazioneId);
    expect(voce!.associazioneDenominazione).toContain('ASD Concertazione PP');
    expect(voce!.tipo).toBe('singola');
    expect(voce!.valoreMinutiAssegnato).toMatch(/^60(\.000)?$/);
    expect(voce!.impiantoDenominazione).toBe(slot.impiantoDenominazione);
    expect(voce!.spazioDenominazione).toBe(slot.spazioDenominazione);
    expect(voce!.giornoSettimana).toBe(1);
    expect(voce!.orarioInizio).toBe('09:00');
    expect(voce!.orarioFine).toBe('10:00');
    expect(voce!.durataMinuti).toBe(60);
    expect(voce!.pregiata).toBe(false);
  });

  it('creaProposta, listaProposteConcertazione e trovaPropostaConcertazione: proposta scambio_bilaterale tra due associazioni', async () => {
    const personaA = await creaPersonaTest(dsn!);
    personeCreate.push(personaA);
    const personaB = await creaPersonaTest(dsn!);
    personeCreate.push(personaB);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);
    const disciplinaCodice = await creaDisciplinaTest();
    const slotA = await creaSlotTest(pool, stagioneId, impiantiCreate, 2);
    const slotB = await creaSlotTest(pool, stagioneId, impiantiCreate, 3);

    impostaTokens(personaA.accessToken, personaA.refreshToken);
    const associazioneAId = await creaAssociazioneConDomandaAmmessa(personaA, stagioneId, disciplinaCodice, 'A', slotA.slotId);

    impostaTokens(personaB.accessToken, personaB.refreshToken);
    const associazioneBId = await creaAssociazioneConDomandaAmmessa(personaB, stagioneId, disciplinaCodice, 'B', slotB.slotId);

    await pool.query(`UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1`, [stagioneId]);

    // proponente: associazione A (personaA)
    impostaTokens(personaA.accessToken, personaA.refreshToken);
    const proposta = await creaProposta({
      stagioneId,
      proponenteAssociazioneId: associazioneAId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: slotA.slotId, associazioneCedenteId: associazioneAId, associazioneRiceventeId: associazioneBId },
        { slotId: slotB.slotId, associazioneCedenteId: associazioneBId, associazioneRiceventeId: associazioneAId },
      ],
    });

    expect(proposta.id).toBeTruthy();
    expect(proposta.stagioneId).toBe(stagioneId);
    expect(proposta.tipo).toBe('scambio_bilaterale');
    expect(proposta.proponenteAssociazioneId).toBe(associazioneAId);
    expect(proposta.stato).toBe('in_attesa_accettazione');
    expect(proposta.parti).toHaveLength(2);
    expect(proposta.slot).toHaveLength(2);

    const lista = await listaProposteConcertazione(stagioneId);
    expect(lista.some((p) => p.id === proposta.id)).toBe(true);

    const trovata = await trovaPropostaConcertazione(proposta.id);
    expect(trovata.id).toBe(proposta.id);
    expect(trovata.stato).toBe('in_attesa_accettazione');
    expect(trovata.parti).toHaveLength(2);

    // accettaProposta: l'associazione B (non proponente) accetta
    impostaTokens(personaB.accessToken, personaB.refreshToken);
    const accettata = await accettaProposta(proposta.id, associazioneBId);
    expect(accettata.stato).toBe('accettata_da_tutti');
  });

  it('annullaProposta: il proponente annulla una propria proposta pendente', async () => {
    const personaA = await creaPersonaTest(dsn!);
    personeCreate.push(personaA);
    const personaB = await creaPersonaTest(dsn!);
    personeCreate.push(personaB);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);
    const disciplinaCodice = await creaDisciplinaTest();
    const slotA = await creaSlotTest(pool, stagioneId, impiantiCreate, 4);
    const slotB = await creaSlotTest(pool, stagioneId, impiantiCreate, 5);

    impostaTokens(personaA.accessToken, personaA.refreshToken);
    const associazioneAId = await creaAssociazioneConDomandaAmmessa(personaA, stagioneId, disciplinaCodice, 'C', slotA.slotId);

    impostaTokens(personaB.accessToken, personaB.refreshToken);
    const associazioneBId = await creaAssociazioneConDomandaAmmessa(personaB, stagioneId, disciplinaCodice, 'D', slotB.slotId);

    await pool.query(`UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1`, [stagioneId]);

    impostaTokens(personaA.accessToken, personaA.refreshToken);
    const proposta = await creaProposta({
      stagioneId,
      proponenteAssociazioneId: associazioneAId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: slotA.slotId, associazioneCedenteId: associazioneAId, associazioneRiceventeId: associazioneBId },
        { slotId: slotB.slotId, associazioneCedenteId: associazioneBId, associazioneRiceventeId: associazioneAId },
      ],
    });
    expect(proposta.stato).toBe('in_attesa_accettazione');

    const annullata = await annullaProposta(proposta.id);
    expect(annullata.stato).toBe('annullata');
  });
});
