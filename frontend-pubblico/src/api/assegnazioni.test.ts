// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens, ErroreRichiestaApi } from './client.ts';
import { creaAssociazione } from './associazioni.ts';
import { listaAssegnazioni } from './assegnazioni.ts';
import { creaDomanda } from './domande.ts';

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
  const nome = `stagione-api-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

async function creaSlotTest(pool: Pool, stagioneId: string): Promise<string> {
  const impiantoRes = await pool.query<{ id: string }>(
    `INSERT INTO impianti (denominazione) VALUES ($1) RETURNING id`,
    [`Impianto Test ${randomUUID().slice(0, 8)}`],
  );
  const impiantoId = impiantoRes.rows[0]!.id;

  const spazioRes = await pool.query<{ id: string }>(
    `INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, $2) RETURNING id`,
    [impiantoId, `Spazio Test ${randomUUID().slice(0, 8)}`],
  );
  const spazioId = spazioRes.rows[0]!.id;

  const slotRes = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 1, '09:00', '10:00') RETURNING id`,
    [stagioneId, spazioId],
  );
  return slotRes.rows[0]!.id;
}

descrivi('assegnazioni.ts', () => {
  let backend: BackendReale;
  let pool: Pool;
  const personeCreate: PersonaTest[] = [];
  const associazioniCreate: string[] = [];
  const stagioniCreate: string[] = [];
  const disciplineCreate: string[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    // Ripulitura: assegnazioni, domande e correlate, abilitazioni, associazioni, persone
    if (associazioniCreate.length > 0) {
      const personeDaAbilitazioni = (
        await pool.query<{ persona_fisica_id: string }>(
          'SELECT DISTINCT persona_fisica_id FROM abilitazioni WHERE associazione_id = ANY($1::uuid[])',
          [associazioniCreate],
        )
      ).rows.map((r) => r.persona_fisica_id);
      await pool.query('DELETE FROM associazioni_documenti WHERE associazione_id = ANY($1::uuid[])', [
        associazioniCreate,
      ]);
      // Cancella preferenze PRIMA di cancellare i slot (FK constraint)
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
    // Nota: pulizia slot/spazi/impianti saltata intenzionalmente quando i test corrono in parallelo
    // per evitare race condition.
    if (disciplineCreate.length > 0) {
      await pool.query('DELETE FROM discipline_sportive WHERE codice = ANY($1::text[])', [disciplineCreate]);
    }
    if (stagioniCreate.length > 0) {
      await pool.query('DELETE FROM stagioni_sportive WHERE id = ANY($1::uuid[])', [stagioniCreate]);
    }

    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.end();
  });

  it('listaAssegnazioni restituisce assegnazioni per una associazione in una stagione', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);
    const slotId = await creaSlotTest(pool, stagioneId);

    // Crea una disciplina di test
    const disciplinaCodice = `DISC${randomUUID().slice(0, 6).toUpperCase()}`;
    await pool.query(
      `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, 'Disciplina Test Assegnazioni')`,
      [disciplinaCodice],
    );
    disciplineCreate.push(disciplinaCodice);

    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Assegnazioni Test ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-6-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: persona.persona.nome,
      rappresentanteLegaleCognome: persona.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: 'asd-assegnazioni-test@example.com',
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
      referenteSicurezza: referenteTest,
      referenteEmergenzeDae: referenteEmergenzeDaeTest,
      assicurazioneRct: assicurazioneTest,
    });
    associazioniCreate.push(associazione.id);

    // Promuoviamo l'abilitazione a 'approvata'
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
      preferenze: [slotId],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    });

    // Ottieni il nome dell'impianto e dello spazio per le fixture
    const slotData = await pool.query<{ spazio_id: string }>(
      'SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1',
      [slotId],
    );
    const spazioId = slotData.rows[0]!.spazio_id;

    const spazioData = await pool.query<{ impianto_id: string; denominazione: string }>(
      'SELECT impianto_id, denominazione FROM spazi_sportivi WHERE id = $1',
      [spazioId],
    );
    const impiantoId = spazioData.rows[0]!.impianto_id;
    const spazioDenominazione = spazioData.rows[0]!.denominazione;

    const impiantoData = await pool.query<{ denominazione: string }>(
      'SELECT denominazione FROM impianti WHERE id = $1',
      [impiantoId],
    );
    const impiantoDenominazione = impiantoData.rows[0]!.denominazione;

    // Inserisci un'assegnazione via pg
    await pool.query(
      `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, stato, valore_minuti)
       VALUES ($1, $2, $3, 'singola', 'validata', 60.000)`,
      [slotId, domanda.id, associazione.id],
    );

    const assegnazioni = await listaAssegnazioni(associazione.id, stagioneId);
    expect(Array.isArray(assegnazioni)).toBe(true);
    expect(assegnazioni.length).toBeGreaterThan(0);

    const assegnazione = assegnazioni[0]!;
    expect(assegnazione.id).toBeTruthy();
    expect(assegnazione.tipo).toBe('singola');
    expect(assegnazione.stato).toBe('validata');
    expect(assegnazione.valoreMinuti).toMatch(/^60(\.000)?$/);
    expect(assegnazione.impiantoDenominazione).toBe(impiantoDenominazione);
    expect(assegnazione.spazioDenominazione).toBe(spazioDenominazione);
    expect(assegnazione.giornoSettimana).toBe(1);
    expect(assegnazione.orarioInizio).toMatch(/^09:00/);;
    expect(assegnazione.orarioFine).toMatch(/^10:00/);
    expect(assegnazione.durataMinuti).toBe(60);
    expect(assegnazione.pregiata).toBe(false);
  });

  it('listaAssegnazioni restituisce 403 senza abilitazione approvata', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);

    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Assegnazioni Forbidden ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-7-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: persona.persona.nome,
      rappresentanteLegaleCognome: persona.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: 'asd-assegnazioni-forbidden@example.com',
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
      referenteSicurezza: referenteTest,
      referenteEmergenzeDae: referenteEmergenzeDaeTest,
      assicurazioneRct: assicurazioneTest,
    });
    associazioniCreate.push(associazione.id);

    // NON promuoviamo l'abilitazione — rimane 'in_attesa'

    try {
      await listaAssegnazioni(associazione.id, stagioneId);
      expect.fail('Dovrebbe aver lanciato ErroreRichiestaApi con status 403');
    } catch (err) {
      expect(err).toBeInstanceOf(ErroreRichiestaApi);
      if (err instanceof ErroreRichiestaApi) {
        expect(err.status).toBe(403);
      }
    }
  });
});
