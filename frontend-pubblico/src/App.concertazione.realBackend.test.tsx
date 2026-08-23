import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

// Stesso pattern di App.esiti.realBackend.test.tsx: nessun helper condiviso lato
// frontend per creare una "stagione" di test, inserimento diretto via pg. Qui la
// portiamo direttamente a 'concertazione' via UPDATE: è un dettaglio di
// implementazione della fixture (il round-robin del motore Go e la pubblicazione
// B.23 non sono oggetto di questo test, già coperti altrove), non del
// comportamento testato.
async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-app-concertazione-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  const stagioneId = r.rows[0]!.id;
  await pool.query(`UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1`, [stagioneId]);
  return stagioneId;
}

// Impianto/spazio/2 slot di fixture: uno per associazione, così che ciascuna
// abbia uno slot proprio da offrire nello scambio bilaterale.
async function creaSlotTest(pool: Pool, stagioneId: string, giornoSettimana: number): Promise<string> {
  const impiantoDenominazione = `Impianto App Concertazione Test ${randomUUID().slice(0, 8)}`;
  const impiantoRes = await pool.query<{ id: string }>(
    `INSERT INTO impianti (denominazione) VALUES ($1) RETURNING id`,
    [impiantoDenominazione],
  );
  const spazioRes = await pool.query<{ id: string }>(
    `INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, $2) RETURNING id`,
    [impiantoRes.rows[0]!.id, `Spazio App Concertazione Test ${randomUUID().slice(0, 8)}`],
  );
  const slotRes = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine, pregiata)
     VALUES ($1, $2, $3, '17:00', '19:00', TRUE) RETURNING id`,
    [stagioneId, spazioRes.rows[0]!.id, giornoSettimana],
  );
  return slotRes.rows[0]!.id;
}

async function creaPersonaEAssociazioneApprovata(
  pool: Pool,
  dsnValue: string,
  stagioneId: string,
  etichetta: string,
): Promise<{ persona: PersonaTest; associazioneId: string }> {
  const persona = await creaPersonaTest(dsnValue);
  // creaAssociazione è una route pubblica autenticata: il token va impostato
  // PRIMA di chiamarla — stesso ordine di App.esiti.realBackend.test.tsx.
  impostaTokens(persona.accessToken, persona.refreshToken);
  const suffisso = randomUUID().slice(0, 8);
  const associazione = await creaAssociazione({
    denominazione: `ASD App Concertazione Test ${etichetta} ${suffisso}`,
    codiceFiscalePartitaIva: `PIVA-${suffisso}`,
    stagioneId,
    rappresentanteLegaleNome: persona.persona.nome,
    rappresentanteLegaleCognome: persona.persona.cognome,
    indirizzoVia: 'Via Milano 10',
    indirizzoCivico: '10',
    indirizzoCitta: 'Pescara',
    email: `asd-app-concertazione-${suffisso}@example.com`,
    tipologiaSoggetto: 'associazione_sportiva',
    iscrittaRasd: false,
    haPersonaleAssunto: false,
    referenteSicurezza: referenteTest,
    referenteEmergenzeDae: referenteEmergenzeDaeTest,
    assicurazioneRct: assicurazioneTest,
  });
  // creaAssociazione crea l'abilitazione come 'in_attesa': la view mostra dati
  // reali solo per un'entità con delega 'approvata' — promossa via pg, stesso
  // pattern di App.esiti.realBackend.test.tsx.
  await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE associazione_id = $1`, [associazione.id]);
  return { persona, associazioneId: associazione.id };
}

// Domanda ammessa inserita direttamente via pg: precondizione richiesta da
// creaProposta (backend-node/src/concertazione.ts::domandaAmmessaId) per ogni
// associazione coinvolta in una proposta — nessun bisogno di passare dal wizard
// di presentazione domanda, già coperto da App.domanda.realBackend.test.tsx.
async function creaDomandaAmmessa(
  pool: Pool,
  associazioneId: string,
  stagioneId: string,
  personaFisicaId: string,
): Promise<string> {
  const numeroProtocollo = `PROT-CONCERTAZIONE-TEST-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO domande
       (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
        fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
     VALUES ($1, $2, $3, $4, 120.000, 120.000, 'ammessa')
     RETURNING id`,
    [numeroProtocollo, associazioneId, stagioneId, personaFisicaId],
  );
  return r.rows[0]!.id;
}

// Assegnazione 'provvisoria' di fixture: è la riga che compare nel bollettino
// (trovaPropostaProvvisoria filtra stato IN ('provvisoria','validata')).
async function creaAssegnazioneProvvisoria(
  pool: Pool,
  slotId: string,
  domandaId: string,
  associazioneId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato)
     VALUES ($1, $2, $3, 'singola', 120.000, 'provvisoria')`,
    [slotId, domandaId, associazioneId],
  );
}

descrivi('App — concertazione tra associazioni (backend reale)', () => {
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
    // Ordine FK-safe: assegnazioni.concertazione_proposta_id referenzia
    // concertazione_proposte (nessun ON DELETE CASCADE, vedi migration
    // 000012_concertazione_link_assegnazioni.up.sql) — le assegnazioni vanno
    // eliminate PRIMA delle proposte. concertazione_proposta_slot/_parti hanno
    // invece ON DELETE CASCADE da concertazione_proposte (vedi
    // db/migrations/000001_init.up.sql), quindi la loro cancellazione è
    // implicita e non richiede DELETE separate. Per il resto, stesso ordine
    // già stabilito in App.esiti.realBackend.test.tsx.
    if (associazioniCreate.length > 0) {
      await pool.query('DELETE FROM assegnazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM concertazione_proposte WHERE stagione_id = $1', [stagioneId]);
      await pool.query('DELETE FROM domande WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM log_operazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM abilitazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM associazioni WHERE id = ANY($1::uuid[])', [associazioniCreate]);
    }
    await pool.query('DELETE FROM slot_settimana_tipo WHERE spazio_id IN (SELECT id FROM spazi_sportivi WHERE denominazione LIKE \'Spazio App Concertazione Test %\')');
    await pool.query('DELETE FROM spazi_sportivi WHERE denominazione LIKE \'Spazio App Concertazione Test %\'');
    await pool.query('DELETE FROM impianti WHERE denominazione LIKE \'Impianto App Concertazione Test %\'');
    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.query('DELETE FROM stagioni_sportive WHERE id = $1', [stagioneId]);
    await pool.end();
  });

  it('scambio bilaterale: propone, l\'altra associazione accetta, la proposta transita ad accettata_da_tutti', async () => {
    const { persona: persona1, associazioneId: associazione1Id } = await creaPersonaEAssociazioneApprovata(
      pool, dsn!, stagioneId, 'uno',
    );
    personeCreate.push(persona1);
    associazioniCreate.push(associazione1Id);

    const { persona: persona2, associazioneId: associazione2Id } = await creaPersonaEAssociazioneApprovata(
      pool, dsn!, stagioneId, 'due',
    );
    personeCreate.push(persona2);
    associazioniCreate.push(associazione2Id);

    const slot1Id = await creaSlotTest(pool, stagioneId, 2);
    const slot2Id = await creaSlotTest(pool, stagioneId, 4);

    const domanda1Id = await creaDomandaAmmessa(pool, associazione1Id, stagioneId, persona1.persona.id);
    const domanda2Id = await creaDomandaAmmessa(pool, associazione2Id, stagioneId, persona2.persona.id);

    await creaAssegnazioneProvvisoria(pool, slot1Id, domanda1Id, associazione1Id);
    await creaAssegnazioneProvvisoria(pool, slot2Id, domanda2Id, associazione2Id);

    // --- 1. Persona 1: render, seleziona stagione, naviga a concertazione ---
    impostaTokens(persona1.accessToken, persona1.refreshToken);
    const primoRender = render(<App />);

    // Il DB di test condiviso accumula stagioni di altri file di test mai
    // ripulite: App.tsx auto-seleziona di default la prima stagione non chiusa
    // per data_inizio DESC, quasi certamente NON quella creata da questo test.
    // Selezioniamo esplicitamente la nostra stagione dal selettore dell'Header.
    const selettoreStagione1 = await screen.findByRole('combobox', { name: 'Stagione' });
    await userEvent.selectOptions(selettoreStagione1, stagioneId);

    await userEvent.click(await screen.findByRole('button', { name: /concertazione scambi/i }));

    // --- 2. Bollettino mostra entrambe le voci (due associazioni, due slot) ---
    expect(await screen.findByText('La tua associazione')).toBeInTheDocument();
    const bollettinoTabella = (await screen.findByText('Bollettino proposta provvisoria (art. B.23)')).closest('.pa-card') as HTMLElement;
    // 1 riga di intestazione + 2 righe voce (una per associazione/slot di fixture).
    // Nessun fabbisogni_riconosciuti/coefficienti di fixture creato in questo
    // blocco (a differenza di App.esiti.realBackend.test.tsx): copre solo il
    // flusso di concertazione, non il calcolo ISF — FR/ISF in tabella restano
    // '—' (fr.fr_finale_minuti NULL), verificati altrove.
    expect(within(bollettinoTabella).getAllByRole('row').length).toBe(3);

    // --- 3. Compila e invia il form "Proponi nuova concertazione" ---
    // Tipo di default è già 'scambio_bilaterale'. Aggiunge una riga: cede il
    // proprio slot (slot1), riceve lo slot dell'altra associazione (slot2).
    await userEvent.click(screen.getByRole('button', { name: /aggiungi riga slot/i }));

    const selettoreCeduto = screen.getByLabelText(/slot da cedere/i);
    await userEvent.selectOptions(selettoreCeduto, slot1Id);

    const selettoreRicevente = screen.getByLabelText(/associazione ricevente/i);
    await userEvent.selectOptions(selettoreRicevente, associazione2Id);

    const selettoreRicevuto = screen.getByLabelText(/slot ricevuto/i);
    await userEvent.selectOptions(selettoreRicevuto, slot2Id);

    await userEvent.click(screen.getByRole('button', { name: /^invia proposta$/i }));

    const messaggioSuccesso = await screen.findByText(/proposta creata con successo/i, {}, { timeout: 10000 });
    expect(messaggioSuccesso).toBeInTheDocument();

    const propostaRow = await pool.query<{ id: string; stato: string }>(
      `SELECT id, stato FROM concertazione_proposte WHERE stagione_id = $1`,
      [stagioneId],
    );
    expect(propostaRow.rows.length).toBe(1);
    const propostaId = propostaRow.rows[0]!.id;
    expect(propostaRow.rows[0]!.stato).toBe('in_attesa_accettazione');

    // --- 4. Smonta, cambia token alla persona 2, rimonta, seleziona stagione, naviga ---
    primoRender.unmount();
    impostaTokens(persona2.accessToken, persona2.refreshToken);
    render(<App />);

    const selettoreStagione2 = await screen.findByRole('combobox', { name: 'Stagione' });
    await userEvent.selectOptions(selettoreStagione2, stagioneId);

    await userEvent.click(await screen.findByRole('button', { name: /concertazione scambi/i }));

    // --- 5. La proposta compare in "Le mie proposte" con stato in_attesa_accettazione e bottone Accetta ---
    expect(await screen.findByText('In attesa di accettazione')).toBeInTheDocument();
    const bottoneAccetta = await screen.findByRole('button', { name: /^accetta$/i });
    await userEvent.click(bottoneAccetta);

    // Attende che l'accettazione sia DAVVERO conclusa sul backend (badge tornato
    // a "Accettata, in attesa di validazione") prima di leggere via pg — stesso
    // motivo dei commenti su vi.waitFor in App.esiti.realBackend.test.tsx: non
    // fidarsi di un semplice "il bottone non c'è più".
    await screen.findByText('Accettata, in attesa di validazione', {}, { timeout: 10000 });

    // --- 6. Verifica diretta pg: stato transitato a accettata_da_tutti ---
    const propostaDopo = await pool.query<{ stato: string }>(
      `SELECT stato FROM concertazione_proposte WHERE id = $1`,
      [propostaId],
    );
    expect(propostaDopo.rows[0]!.stato).toBe('accettata_da_tutti');
  }, 40000);
});
