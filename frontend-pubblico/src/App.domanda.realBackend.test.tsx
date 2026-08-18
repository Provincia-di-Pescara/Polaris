import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { render, screen } from '@testing-library/react';
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

// Stesso pattern di App.accreditamento.realBackend.test.tsx: nessun helper
// condiviso lato frontend per creare una "stagione" di test, inserimento
// diretto via pg.
async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-app-domanda-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

// Spazio/impianto/slot minimo per popolare lo step 4 del wizard: stesso
// pattern di backend-node/src/server.pubblico.test.ts (GET /pubblico/stagioni/:id/slot)
// e frontend-pubblico/src/api/domande.test.ts:creaSlotTest.
async function creaSlotTest(
  pool: Pool,
  stagioneId: string,
  disciplinaCodice: string,
): Promise<{ slotId: string; impiantoDenominazione: string }> {
  const impiantoDenominazione = `Impianto App Domanda Test ${randomUUID().slice(0, 8)}`;
  const impiantoRes = await pool.query<{ id: string }>(
    `INSERT INTO impianti (denominazione) VALUES ($1) RETURNING id`,
    [impiantoDenominazione],
  );
  const spazioRes = await pool.query<{ id: string }>(
    `INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, $2) RETURNING id`,
    [impiantoRes.rows[0]!.id, `Spazio App Domanda Test ${randomUUID().slice(0, 8)}`],
  );
  // Il filtro Step 4 del wizard (?disciplinaCodice=) richiede che lo spazio sia
  // dichiarato compatibile con la disciplina, altrimenti lo slot non compare
  // mai nella lista filtrata (GET /pubblico/stagioni/:id/slot).
  await pool.query(
    `INSERT INTO spazio_disciplina_compatibile (spazio_id, disciplina_codice) VALUES ($1, $2)`,
    [spazioRes.rows[0]!.id, disciplinaCodice],
  );
  const slotRes = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine)
     VALUES ($1, $2, 1, '09:00', '10:00') RETURNING id`,
    [stagioneId, spazioRes.rows[0]!.id],
  );
  return { slotId: slotRes.rows[0]!.id, impiantoDenominazione };
}

descrivi('App — presentazione domanda (backend reale)', () => {
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
    // Stesso ordine di pulizia di api/domande.test.ts: associazioni_documenti,
    // domande e correlate, abilitazioni, associazioni, poi persone/stagione.
    if (associazioniCreate.length > 0) {
      await pool.query('DELETE FROM associazioni_documenti WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM richieste_giornata_gara WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM preferenze WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM blocco_allenamento_slot WHERE blocco_id IN (SELECT id FROM blocchi_allenamento_richiesti WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[])))', [associazioniCreate]);
      await pool.query('DELETE FROM blocchi_allenamento_richiesti WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM domanda_discipline WHERE domanda_id IN (SELECT id FROM domande WHERE associazione_id = ANY($1::uuid[]))', [associazioniCreate]);
      await pool.query('DELETE FROM domande WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM log_operazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM abilitazioni WHERE associazione_id = ANY($1::uuid[])', [associazioniCreate]);
      await pool.query('DELETE FROM associazioni WHERE id = ANY($1::uuid[])', [associazioniCreate]);
    }
    await pool.query('DELETE FROM slot_settimana_tipo WHERE spazio_id IN (SELECT id FROM spazi_sportivi WHERE denominazione LIKE \'Spazio App Domanda Test %\')');
    await pool.query('DELETE FROM spazio_disciplina_compatibile WHERE spazio_id IN (SELECT id FROM spazi_sportivi WHERE denominazione LIKE \'Spazio App Domanda Test %\')');
    await pool.query('DELETE FROM spazi_sportivi WHERE denominazione LIKE \'Spazio App Domanda Test %\'');
    await pool.query('DELETE FROM impianti WHERE denominazione LIKE \'Impianto App Domanda Test %\'');
    // Stesso gap di hygiene che ha causato l'accumulo di ~8800 righe garbage in
    // discipline_sportive nel DB di test condiviso (nessun test la ripuliva):
    // ogni run di questo file deve rimuovere la disciplina che ha creato.
    await pool.query('DELETE FROM discipline_sportive WHERE denominazione LIKE \'Disciplina App Domanda Test %\'');
    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.query('DELETE FROM stagioni_sportive WHERE id = $1', [stagioneId]);
    await pool.end();
  });

  it('presenta una domanda reale attraverso l\'intera UI e la ritrova al remount', async () => {
    const p = await creaPersonaTest(dsn!);
    personeCreate.push(p);
    impostaTokens(p.accessToken, p.refreshToken);

    const disciplinaCodice = `DISC${randomUUID().slice(0, 6).toUpperCase()}`;
    const disciplinaDenominazione = `Disciplina App Domanda Test ${randomUUID().slice(0, 6)}`;
    await pool.query(
      `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, $2)`,
      [disciplinaCodice, disciplinaDenominazione],
    );

    const { slotId, impiantoDenominazione } = await creaSlotTest(pool, stagioneId, disciplinaCodice);

    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD App Domanda Test ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-${suffisso}`,
      stagioneId,
      rappresentanteLegaleNome: p.persona.nome,
      rappresentanteLegaleCognome: p.persona.cognome,
      indirizzoVia: 'Via Milano 10',
      indirizzoCivico: '10',
      indirizzoCitta: 'Pescara',
      email: `asd-app-domanda-${suffisso}@example.com`,
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
      referenteSicurezza: referenteTest,
      referenteEmergenzeDae: referenteEmergenzeDaeTest,
      assicurazioneRct: assicurazioneTest,
    });
    associazioniCreate.push(associazione.id);

    // creaAssociazione crea l'abilitazione come 'in_attesa': il wizard mostra il
    // form solo per un'entità con delega 'approvata' (App.tsx la auto-seleziona
    // solo tra le entità approvate), quindi la promuoviamo via pg — stesso
    // pattern di api/domande.test.ts.
    await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE associazione_id = $1`, [associazione.id]);

    const primoRender = render(<App />);

    // Il DB di test condiviso accumula migliaia di stagioni create da altri
    // file di test (mai ripulite): App.tsx auto-seleziona di default la prima
    // stagione non chiusa per data_inizio DESC, che quasi certamente NON è
    // quella creata da questo test. Selezioniamo esplicitamente la nostra
    // stagione dal selettore dell'Header, come farebbe un utente reale.
    const selettoreStagione = await screen.findByRole('combobox', { name: 'Stagione' });
    await userEvent.selectOptions(selettoreStagione, stagioneId);

    await userEvent.click(await screen.findByRole('button', { name: /presentazione domanda/i }));

    // Step 1: disciplina.
    await userEvent.click(await screen.findByLabelText(disciplinaDenominazione));
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));

    // Step 2: fabbisogni minimo/ottimale. Nessun clic su "Calcola Anteprima":
    // il motore Go non è configurato in questo ambiente di test e l'anteprima
    // è esplicitamente non bloccante per il submit (WizardDomandaView.tsx).
    await userEvent.type(screen.getByLabelText(/fabbisogno minimo/i), '360');
    await userEvent.type(screen.getByLabelText(/fabbisogno ottimale/i), '480');
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));

    // Step 3: nessun blocco giornata gara richiesto.
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));

    // Step 4: seleziona lo slot di fixture tra le preferenze e invia.
    const checkboxSlot = await screen.findByLabelText(new RegExp(impiantoDenominazione));
    await userEvent.click(checkboxSlot);
    await userEvent.click(screen.getByRole('button', { name: /invia domanda definitiva/i }));

    expect(await screen.findByText(/domanda già presentata/i, {}, { timeout: 10000 })).toBeInTheDocument();
    const protocolloMatch = await screen.findByText(/numero protocollo:/i);
    const numeroProtocollo = protocolloMatch.textContent?.replace(/numero protocollo:\s*/i, '').trim();
    expect(numeroProtocollo).toBeTruthy();

    // Verifica che al remount la view mostri lo stato "già presentata" con lo
    // stesso numeroProtocollo (creaDomanda persiste realmente sul backend, non
    // resta solo nello stato React locale). Smonta prima il primo render:
    // altrimenti restano due <App/> montate contemporaneamente sullo stesso
    // document.body e le query per ruolo/testo diventano ambigue.
    primoRender.unmount();
    render(<App />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Stagione' }), stagioneId);
    await userEvent.click(await screen.findByRole('button', { name: /presentazione domanda/i }));
    expect(await screen.findByText(/domanda già presentata/i, {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`numero protocollo:\\s*${numeroProtocollo}`, 'i'))).toBeInTheDocument();

    // Slot ora impegnato dalla preferenza presentata: verifica di stato diretta
    // sul backend, coerente con il vincolo "una sola domanda per associazione e
    // per stagione, mai modificabile" mostrato in UI.
    const domandaRow = await pool.query<{ id: string; numero_protocollo: string; stato: string }>(
      'SELECT id, numero_protocollo, stato FROM domande WHERE associazione_id = $1 AND stagione_id = $2',
      [associazione.id, stagioneId],
    );
    expect(domandaRow.rows.length).toBe(1);
    expect(domandaRow.rows[0]!.numero_protocollo).toBe(numeroProtocollo);
    expect(domandaRow.rows[0]!.stato).toBe('presentata');

    const preferenzaRow = await pool.query<{ slot_id: string }>(
      'SELECT slot_id FROM preferenze WHERE domanda_id = $1',
      [domandaRow.rows[0]!.id],
    );
    expect(preferenzaRow.rows.some((r) => r.slot_id === slotId)).toBe(true);
  }, 40000);
});
