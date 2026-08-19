import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { avviaBackendReale, type BackendReale } from './testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from './testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './api/client.ts';
import { creaAssociazione } from './api/associazioni.ts';
import { App } from './App.tsx';

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

// Stesso pattern di App.domanda.realBackend.test.tsx: nessun helper condiviso
// lato frontend per creare una "stagione" di test, inserimento diretto via pg.
async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-app-esiti-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

// Impianto/spazio/slot minimo per l'assegnazione di fixture: nessuna disciplina
// coinvolta in questo flusso (a differenza del wizard di presentazione domanda).
async function creaSlotTest(pool: Pool, stagioneId: string): Promise<{ slotId: string; impiantoDenominazione: string }> {
  const impiantoDenominazione = `Impianto App Esiti Test ${randomUUID().slice(0, 8)}`;
  const impiantoRes = await pool.query<{ id: string }>(
    `INSERT INTO impianti (denominazione) VALUES ($1) RETURNING id`,
    [impiantoDenominazione],
  );
  const spazioRes = await pool.query<{ id: string }>(
    `INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, $2) RETURNING id`,
    [impiantoRes.rows[0]!.id, `Spazio App Esiti Test ${randomUUID().slice(0, 8)}`],
  );
  const slotRes = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine, pregiata)
     VALUES ($1, $2, 2, '17:00', '19:00', TRUE) RETURNING id`,
    [stagioneId, spazioRes.rows[0]!.id],
  );
  return { slotId: slotRes.rows[0]!.id, impiantoDenominazione };
}

async function creaPersonaEAssociazioneApprovata(
  pool: Pool,
  dsnValue: string,
  stagioneId: string,
  etichetta: string,
): Promise<{ persona: PersonaTest; associazioneId: string }> {
  const persona = await creaPersonaTest(dsnValue);
  // creaAssociazione è una route pubblica autenticata: il token va impostato
  // PRIMA di chiamarla, non dopo (a differenza dell'ordine "crea poi autentica"
  // che avrebbe senso per un fixture non protetto).
  impostaTokens(persona.accessToken, persona.refreshToken);
  const suffisso = randomUUID().slice(0, 8);
  const associazione = await creaAssociazione({
    denominazione: `ASD App Esiti Test ${etichetta} ${suffisso}`,
    codiceFiscalePartitaIva: `PIVA-${suffisso}`,
    stagioneId,
    rappresentanteLegaleNome: persona.persona.nome,
    rappresentanteLegaleCognome: persona.persona.cognome,
    indirizzoVia: 'Via Milano 10',
    indirizzoCivico: '10',
    indirizzoCitta: 'Pescara',
    email: `asd-app-esiti-${suffisso}@example.com`,
    tipologiaSoggetto: 'associazione_sportiva',
    iscrittaRasd: false,
    haPersonaleAssunto: false,
    referenteSicurezza: referenteTest,
    referenteEmergenzeDae: referenteEmergenzeDaeTest,
    assicurazioneRct: assicurazioneTest,
  });
  // creaAssociazione crea l'abilitazione come 'in_attesa': la view mostra dati
  // reali solo per un'entità con delega 'approvata' (auto-selezionata da App.tsx),
  // quindi la promuoviamo via pg — stesso pattern di App.domanda.realBackend.test.tsx.
  await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE associazione_id = $1`, [associazione.id]);
  return { persona, associazioneId: associazione.id };
}

// Inserisce una domanda già istruita direttamente via pg (nessun bisogno di
// passare dal wizard: questo blocco copre la LETTURA degli esiti, non la
// presentazione della domanda, già coperta da App.domanda.realBackend.test.tsx).
async function creaDomandaIstruita(
  pool: Pool,
  associazioneId: string,
  stagioneId: string,
  personaFisicaId: string,
  stato: 'ammessa' | 'esclusa',
  motivazioneEsclusione: string | null,
): Promise<string> {
  const numeroProtocollo = `PROT-ESITI-TEST-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO domande
       (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
        fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato, motivazione_esclusione)
     VALUES ($1, $2, $3, $4, 360.000, 480.000, $5, $6)
     RETURNING id`,
    [numeroProtocollo, associazioneId, stagioneId, personaFisicaId, stato, motivazioneEsclusione],
  );
  return r.rows[0]!.id;
}

async function creaFabbisognoECoefficienti(
  pool: Pool,
  domandaId: string,
  frFinaleMinuti: number,
): Promise<void> {
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  const parametricoVersioneId = versione.rows[0]!.id;
  await pool.query(
    `INSERT INTO fabbisogni_riconosciuti (domanda_id, parametrico_versione_id, peso_base, incremento_squadre, fr_calcolato_minuti, fd_minuti, fr_finale_minuti)
     VALUES ($1, $2, 1, 0, $3, $3, $3)`,
    [domandaId, parametricoVersioneId, frFinaleMinuti],
  );
  await pool.query(
    `INSERT INTO coefficienti_associazione (domanda_id, parametrico_versione_id, crs, caa, csd, cp)
     VALUES ($1, $2, 1.000, 1.000, 1.000, 1.000)`,
    [domandaId, parametricoVersioneId],
  );
}

descrivi('App — esiti istruttoria e tabellone ISF (backend reale)', () => {
  let backend: BackendReale;
  let pool: Pool;
  const personeCreate: PersonaTest[] = [];
  const associazioniCreate: string[] = [];
  let stagioneId: string;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
    stagioneId = await creaStagioneTest(pool);
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    // Stesso ordine FK-safe di App.domanda.realBackend.test.tsx, esteso alle
    // tabelle di questo blocco (assegnazioni -> coefficienti_associazione ->
    // fabbisogni_riconosciuti -> osservazioni_istruttoria -> domande -> ...).
    // Nessuna riga discipline_sportive creata da questo test: non coinvolta nel
    // flusso di lettura esiti (nessuna preferenza/disciplina di domanda).
    if (associazioniCreate.length > 0) {
      await pool.query('DELETE FROM assegnazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM coefficienti_associazione WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM fabbisogni_riconosciuti WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM osservazioni_istruttoria WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM associazioni_documenti WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM domande WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM log_operazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM abilitazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM associazioni WHERE id = ANY($1::uuid[])', [associazioniCreate]);
    }
    await pool.query('DELETE FROM slot_settimana_tipo WHERE spazio_id IN (SELECT id FROM spazi_sportivi WHERE denominazione LIKE \'Spazio App Esiti Test %\')');
    await pool.query('DELETE FROM spazi_sportivi WHERE denominazione LIKE \'Spazio App Esiti Test %\'');
    await pool.query('DELETE FROM impianti WHERE denominazione LIKE \'Impianto App Esiti Test %\'');
    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.query('DELETE FROM stagioni_sportive WHERE id = $1', [stagioneId]);
    await pool.end();
  });

  it('domanda ammessa: mostra KPI reali (FR, CP, ISF, slot assegnati) nel tabellone e nella sezione "La mia domanda"', async () => {
    const { persona, associazioneId } = await creaPersonaEAssociazioneApprovata(pool, dsn!, stagioneId, 'ammessa');
    personeCreate.push(persona);
    associazioniCreate.push(associazioneId);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const { slotId } = await creaSlotTest(pool, stagioneId);
    const domandaId = await creaDomandaIstruita(pool, associazioneId, stagioneId, persona.persona.id, 'ammessa', null);
    // FR finale 300, VA 120 (un solo slot pregiato da 120 min) -> ISF = 0.400 (40.0%).
    await creaFabbisognoECoefficienti(pool, domandaId, 300);
    await pool.query(
      `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato)
       VALUES ($1, $2, $3, 'singola', 120.000, 'validata')`,
      [slotId, domandaId, associazioneId],
    );

    render(<App />);

    // Il DB di test condiviso accumula stagioni di altri file di test mai
    // ripulite: App.tsx auto-seleziona di default la prima stagione non chiusa
    // per data_inizio DESC, quasi certamente NON quella creata da questo test.
    // Selezioniamo esplicitamente la nostra stagione dal selettore dell'Header.
    const selettoreStagione = await screen.findByRole('combobox', { name: 'Stagione' });
    await userEvent.selectOptions(selettoreStagione, stagioneId);

    await userEvent.click(await screen.findByRole('button', { name: /esiti & punteggio isf/i }));

    // Sezione "La mia domanda": KPI calcolati da fabbisogni_riconosciuti +
    // coefficienti_associazione + assegnazioni reali (nessun mock).
    expect(await screen.findByText('300.000 minuti')).toBeInTheDocument();
    expect(screen.getByText(/CRS 1\.000 • CAA 1\.000 • CSD 1\.000/)).toBeInTheDocument();
    expect(await screen.findByText('1 slot (120 min)')).toBeInTheDocument();
    // Formato orario HH:MM senza secondi: copre la regressione Node<->UI in cui
    // il backend restituiva 'HH:MM:SS' (::text invece di to_char(...,'HH24:MI')).
    expect(screen.getByText('17:00 - 19:00')).toBeInTheDocument();
    // L'ISF compare sia nel KPI "La mia domanda" sia nella riga propria del
    // tabellone (stesso valore, due punti della UI): findAllByText, mai
    // findByText, altrimenti "elemento multiplo trovato" a schermo pieno.
    expect((await screen.findAllByText('0.400 (40.0%)')).length).toBeGreaterThan(0);

    // Tabellone pubblico: stessa fetch condivisa (elencoEsitiPubblicati), riga
    // propria marcata e con lo stesso ISF calcolato sopra.
    const rigaPropria = (await screen.findByText('La tua associazione')).closest('tr')!;
    expect(within(rigaPropria).getByText('300.000')).toBeInTheDocument();
    expect(within(rigaPropria).getByText('0.400 (40.0%)')).toBeInTheDocument();

    // Verifica diretta sul backend: lo slot assegnato è realmente quello di fixture.
    const assegnazioneRow = await pool.query<{ slot_id: string; stato: string }>(
      'SELECT slot_id, stato FROM assegnazioni WHERE domanda_id = $1',
      [domandaId],
    );
    expect(assegnazioneRow.rows.length).toBe(1);
    expect(assegnazioneRow.rows[0]!.slot_id).toBe(slotId);
    expect(assegnazioneRow.rows[0]!.stato).toBe('validata');
  }, 40000);

  it('domanda esclusa: mostra la motivazione e permette di presentare un\'osservazione reale', async () => {
    const { persona, associazioneId } = await creaPersonaEAssociazioneApprovata(pool, dsn!, stagioneId, 'esclusa');
    personeCreate.push(persona);
    associazioniCreate.push(associazioneId);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const motivazione = 'Documentazione assicurativa incompleta.';
    await creaDomandaIstruita(pool, associazioneId, stagioneId, persona.persona.id, 'esclusa', motivazione);

    render(<App />);

    const selettoreStagione = await screen.findByRole('combobox', { name: 'Stagione' });
    await userEvent.selectOptions(selettoreStagione, stagioneId);

    await userEvent.click(await screen.findByRole('button', { name: /esiti & punteggio isf/i }));

    expect(await screen.findByText(/osservazioni e richiesta di riesame/i)).toBeInTheDocument();
    expect(screen.getByText(motivazione)).toBeInTheDocument();
    expect(screen.getByText(/nessuna osservazione presentata/i)).toBeInTheDocument();

    const testoOsservazione = 'Le polizze assicurative erano state allegate correttamente in fase di accreditamento.';
    const campoTesto = screen.getByLabelText(/testo dell'osservazione/i);
    await userEvent.type(campoTesto, testoOsservazione);
    await userEvent.click(screen.getByRole('button', { name: /presenta osservazione/i }));

    // Presentata realmente sul backend: attende che l'invio sia DAVVERO concluso
    // (bottone tornato al testo normale e textarea svuotata da inviaOsservazione)
    // prima di leggere l'esito — mai `findByText(testoOsservazione)` da solo:
    // sotto carico pesante può intercettare il valore ancora presente/non ancora
    // ripulito nella textarea invece del testo effettivamente renderizzato nella
    // lista osservazioni (getByText non distingue in modo affidabile un nodo di
    // controllo form da un nodo di testo statico).
    await screen.findByRole('button', { name: /presenta osservazione/i }, { timeout: 10000 });
    await vi.waitFor(() => expect(campoTesto).toHaveValue(''), { timeout: 10000 });

    const badgeInEsame = await screen.findByText('In esame', {}, { timeout: 10000 });
    // Risale dal badge al contenitore della singola osservazione (badge -> riga
    // flex stato/data -> box osservazione) per leggere il testo SOLO in quello
    // scope, mai con un `getByText(testoOsservazione)` non scoped sull'intera
    // pagina (stesso motivo del commento sopra).
    const rigaOsservazione = badgeInEsame.parentElement!.parentElement as HTMLElement;
    expect(within(rigaOsservazione).getByText(testoOsservazione)).toBeInTheDocument();
    expect(campoTesto).toHaveValue('');
    expect(screen.queryByText(/nessuna osservazione presentata/i)).not.toBeInTheDocument();

    const osservazioneRow = await pool.query<{ testo: string; stato: string }>(
      `SELECT o.testo, o.stato FROM osservazioni_istruttoria o
       JOIN domande d ON d.id = o.domanda_id
       WHERE d.associazione_id = $1`,
      [associazioneId],
    );
    expect(osservazioneRow.rows.length).toBe(1);
    expect(osservazioneRow.rows[0]!.testo).toBe(testoOsservazione);
    expect(osservazioneRow.rows[0]!.stato).toBe('in_esame');
  }, 40000);
});
