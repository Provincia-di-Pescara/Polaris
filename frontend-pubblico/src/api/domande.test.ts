// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens, ErroreRichiestaApi } from './client.ts';
import { creaAssociazione } from './associazioni.ts';
import { creaDomanda, listaDomandePerAssociazione, anteprimaFabbisogno, elencoEsitiPubblicati } from './domande.ts';

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

async function creaSlotTest(pool: Pool, stagioneId: string, impiantiCreate: string[]): Promise<string> {
  // Crea uno spazio e uno slot settimana tipo di test.
  // Necessario perché la schema di creaDomanda richiede almeno 1 slot UUID in preferenze.
  const impiantoRes = await pool.query<{ id: string }>(
    `INSERT INTO impianti (denominazione) VALUES ($1) RETURNING id`,
    [`Impianto Test ${randomUUID().slice(0, 8)}`],
  );
  const impiantoId = impiantoRes.rows[0]!.id;
  // Tracciato per id (non LIKE): evita sia il leak sia la race condition di una
  // DELETE globale che potrebbe colpire righe create da un altro file di test
  // in esecuzione in parallelo con un prefisso di nome sovrapposto.
  impiantiCreate.push(impiantoId);

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

descrivi('domande.ts', () => {
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
    // Ripulitura: associazioni_documenti, log_operazioni, domande e correlate,
    // abilitazioni, associazioni, infine persone_fisiche, slot, spazi, impianti.
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
      // Le domande hanno FK non-cascading dalla tabella domande.
      // Cancella preferenze PRIMA di cancellare i slot (FK constraint)
      await pool.query('DELETE FROM preferenze WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
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
    // Stagioni e discipline create nei test: rimosse ora che slot/domande che le
    // referenziano sono già stati eliminati sopra (stesso ordine FK-safe di
    // App.domanda.realBackend.test.tsx). La DELETE su stagioni_sportive fa
    // cascare via FK anche slot_settimana_tipo (ON DELETE CASCADE), quindi gli
    // spazi/impianti tracciati per id restano liberi da vincoli e possono essere
    // eliminati subito dopo, senza alcun pattern LIKE globale (niente race con
    // altri file di test in esecuzione in parallelo).
    if (disciplineCreate.length > 0) {
      await pool.query('DELETE FROM discipline_sportive WHERE codice = ANY($1::text[])', [disciplineCreate]);
    }
    if (stagioniCreate.length > 0) {
      await pool.query('DELETE FROM stagioni_sportive WHERE id = ANY($1::uuid[])', [stagioniCreate]);
    }
    if (impiantiCreate.length > 0) {
      // spazi_sportivi ha ON DELETE CASCADE da impianti: basta cancellare gli impianti.
      await pool.query('DELETE FROM impianti WHERE id = ANY($1::uuid[])', [impiantiCreate]);
    }

    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.end();
  });

  it('creaDomanda crea una nuova domanda con i dati forniti', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);
    const slotId = await creaSlotTest(pool, stagioneId, impiantiCreate);

    // Crea una disciplina di test
    const disciplinaCodice = `DISC${randomUUID().slice(0, 6).toUpperCase()}`;
    await pool.query(
      `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, 'Disciplina Test')`,
      [disciplinaCodice],
    );
    disciplineCreate.push(disciplinaCodice);

    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Domanda Test ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: persona.persona.nome,
      rappresentanteLegaleCognome: persona.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: 'asd-domanda-test@example.com',
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
      referenteSicurezza: referenteTest,
      referenteEmergenzeDae: referenteEmergenzeDaeTest,
      assicurazioneRct: assicurazioneTest,
    });
    associazioniCreate.push(associazione.id);

    // creaAssociazione crea l'abilitazione come 'in_attesa': creaDomanda richiede
    // un'abilitazione attiva ('approvata'), quindi la promuoviamo via pg.
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

    expect(domanda.id).toBeTruthy();
    expect(domanda.numeroProtocollo).toBeTruthy();
    expect(domanda.associazioneId).toBe(associazione.id);
    expect(domanda.stagioneId).toBe(stagioneId);
    expect(domanda.stato).toBe('presentata');
    expect(domanda.riesameStato).toBe('nessuno');
    expect(domanda.motivazioneEsclusione).toBeNull();
  });

  it('listaDomandePerAssociazione restituisce le domande create', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);
    const slotId = await creaSlotTest(pool, stagioneId, impiantiCreate);

    // Crea una disciplina di test
    const disciplinaCodice = `DISC${randomUUID().slice(0, 6).toUpperCase()}`;
    await pool.query(
      `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, 'Disciplina Test')`,
      [disciplinaCodice],
    );
    disciplineCreate.push(disciplinaCodice);

    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Domanda Test 2 ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-2-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: persona.persona.nome,
      rappresentanteLegaleCognome: persona.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: 'asd-domanda-test2@example.com',
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
      referenteSicurezza: referenteTest,
      referenteEmergenzeDae: referenteEmergenzeDaeTest,
      assicurazioneRct: assicurazioneTest,
    });
    associazioniCreate.push(associazione.id);

    // creaAssociazione crea l'abilitazione come 'in_attesa': creaDomanda richiede
    // un'abilitazione attiva ('approvata'), quindi la promuoviamo via pg.
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

    const domande = await listaDomandePerAssociazione(associazione.id);
    expect(Array.isArray(domande)).toBe(true);
    expect(domande.some((d) => d.id === domanda.id)).toBe(true);
  });


  it('anteprimaFabbisogno con dati validi restituisce 503 quando motore Go non è disponibile', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);

    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Anteprima Test 2 ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-4-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: persona.persona.nome,
      rappresentanteLegaleCognome: persona.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: 'asd-anteprima-test2@example.com',
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
      referenteSicurezza: referenteTest,
      referenteEmergenzeDae: referenteEmergenzeDaeTest,
      assicurazioneRct: assicurazioneTest,
    });
    associazioniCreate.push(associazione.id);

    // creaAssociazione crea l'abilitazione come 'in_attesa': anteprimaFabbisogno richiede
    // un'abilitazione attiva ('approvata'), quindi la promuoviamo via pg.
    await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE associazione_id = $1`, [associazione.id]);

    try {
      await anteprimaFabbisogno({
        associazioneId: associazione.id,
        stagioneId,
        classeAttivitaCodice: 'CLASSE-1',
        numeroSquadreFederali: 1,
        fdMinuti: '480',
      });
      expect.fail('Dovrebbe aver lanciato ErroreRichiestaApi con status 503');
    } catch (err) {
      expect(err).toBeInstanceOf(ErroreRichiestaApi);
      if (err instanceof ErroreRichiestaApi) {
        expect(err.status).toBe(503);
      }
    }
  });

  it('elencoEsitiPubblicati restituisce gli esiti con associazioneDenominazione', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);
    stagioniCreate.push(stagioneId);
    const slotId = await creaSlotTest(pool, stagioneId, impiantiCreate);

    // Crea una disciplina di test
    const disciplinaCodice = `DISC${randomUUID().slice(0, 6).toUpperCase()}`;
    await pool.query(
      `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, 'Disciplina Test Esiti')`,
      [disciplinaCodice],
    );
    disciplineCreate.push(disciplinaCodice);

    const suffisso = randomUUID().slice(0, 8);
    const denominazioneAssociazione = `ASD Esiti Test ${suffisso}`;
    const associazione = await creaAssociazione({
      denominazione: denominazioneAssociazione,
      codiceFiscalePartitaIva: `PIVA-5-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: persona.persona.nome,
      rappresentanteLegaleCognome: persona.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: 'asd-esiti-test@example.com',
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

    // Aggiorna la domanda a 'ammessa' e inserisci FR/coefficienti via pg
    await pool.query(
      `UPDATE domande SET stato = 'ammessa' WHERE id = $1`,
      [domanda.id],
    );

    // Ottieni la versione parametrico più recente
    const parametroRes = await pool.query<{ id: string }>(
      `SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`,
    );
    const parametroVersioneId = parametroRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO fabbisogni_riconosciuti (domanda_id, parametrico_versione_id, peso_base, incremento_squadre, fr_calcolato_minuti, fd_minuti, fr_finale_minuti)
       VALUES ($1, $2, 1, 0, 500.000, 200.000, 200.000)`,
      [domanda.id, parametroVersioneId],
    );

    await pool.query(
      `INSERT INTO coefficienti_associazione (domanda_id, parametrico_versione_id, crs, caa, csd, cp)
       VALUES ($1, $2, 1.000, 0.900, 0.800, 0.720)`,
      [domanda.id, parametroVersioneId],
    );

    const esiti = await elencoEsitiPubblicati(stagioneId);
    const esito = esiti.find((e) => e.domandaId === domanda.id);

    expect(esito).toBeTruthy();
    expect(esito!.associazioneId).toBe(associazione.id);
    expect(esito!.associazioneDenominazione).toBe(denominazioneAssociazione);
    expect(esito!.stato).toBe('ammessa');
    expect(esito!.motivazioneEsclusione).toBeNull();
    expect(esito!.fabbisognoRiconosciuto).toBeTruthy();
    expect(parseFloat(esito!.fabbisognoRiconosciuto!.frCalcolatoMinuti)).toBe(500);
    expect(parseFloat(esito!.fabbisognoRiconosciuto!.fdMinuti)).toBe(200);
    expect(parseFloat(esito!.fabbisognoRiconosciuto!.frFinaleMinuti)).toBe(200);
    expect(esito!.coefficienti).toBeTruthy();
    expect(parseFloat(esito!.coefficienti!.crs)).toBe(1);
    expect(parseFloat(esito!.coefficienti!.caa)).toBe(0.9);
    expect(parseFloat(esito!.coefficienti!.csd)).toBe(0.8);
    expect(parseFloat(esito!.coefficienti!.cp)).toBeCloseTo(0.72, 2);
  });
});
