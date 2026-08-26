import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '../auth/AuthContext.tsx';
import { routes } from '../routes.tsx';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens } from '../api/client.ts';
import { ImpiantiSpaziView } from './ImpiantiSpaziView.tsx';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

// Il Postgres di sviluppo condiviso ha accumulato migliaia di righe disposable
// in `impianti` (nessuna riga in quella tabella viene mai seminata dalle
// migration — sono tutte fixture di test precedenti mai ripulite) e questa
// vista le renderizza tutte senza paginazione: ogni interazione userEvent su
// un DOM con 6000+ nodi in jsdom è sensibilmente più lenta del default
// @testing-library (`asyncUtilTimeout` 1000ms). Timeout elevato solo qui,
// non a livello globale, per non mascherare regressioni di velocità altrove.
const WAIT_FOR_TIMEOUT = { timeout: 60000 };

descrivi('ImpiantiSpaziView', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  async function loginComeAdmin(): Promise<void> {
    const u = await creaUtenteTest(dsn!, 'admin');
    utentiCreati.push(u);
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);
  }

  it('crea un impianto da zero e lo vede comparire in lista', async () => {
    await loginComeAdmin();

    render(<ImpiantiSpaziView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /nuovo impianto/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);

    await userEvent.click(screen.getByRole('button', { name: /nuovo impianto/i }));

    const nome = `Palestra E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nome);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    await waitFor(() => expect(screen.getByText(nome)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
  }, 240000);

  it('crea uno spazio dentro un impianto e lo vede comparire', async () => {
    await loginComeAdmin();

    render(<ImpiantiSpaziView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /nuovo impianto/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByRole('button', { name: /nuovo impianto/i }));
    const nomeImpianto = `Palestra Spazi E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nomeImpianto);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));
    await waitFor(() => expect(screen.getByText(nomeImpianto)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);

    await userEvent.click(screen.getByText(nomeImpianto));
    await userEvent.click(screen.getByRole('button', { name: /nuovo spazio/i }));

    const nomeSpazio = `Campo E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nomeSpazio);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    await waitFor(() => expect(screen.getByText(nomeSpazio)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
  }, 240000);

  // Important 1: form scritti, testati, mai raggiungibili da UI prima di questo fix.
  it('crea una disciplina sportiva da UI (pannello Anagrafiche)', async () => {
    await loginComeAdmin();

    render(<ImpiantiSpaziView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /nuova disciplina/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByRole('button', { name: /nuova disciplina/i }));

    const codice = `E2E${randomUUID().slice(0, 6).toUpperCase()}`;
    const denominazione = `Disciplina E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/codice/i), codice);
    await userEvent.type(screen.getByLabelText(/denominazione/i), denominazione);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    // Il Postgres di sviluppo condiviso ha migliaia di discipline accumulate da
    // fixture di test precedenti: il pannello Anagrafiche mostra solo le prime 50
    // (tetto fisso anti-degrado jsdom, vedi ImpiantiSpaziView.tsx) — bisogna
    // cercare la disciplina appena creata col box di ricerca per essere certi che
    // compaia, non basta aspettare che appaia da sola nella lista non filtrata.
    await userEvent.type(screen.getByLabelText(/cerca disciplina/i), codice);
    await waitFor(() => expect(screen.getByText(new RegExp(denominazione))).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
  }, 240000);

  it('crea una istituzione scolastica da UI (pannello Anagrafiche)', async () => {
    await loginComeAdmin();

    // AuthProvider necessario qui (a differenza degli altri render bare di
    // <ImpiantiSpaziView /> in questo file): IstituzioneForm ora usa useAuth()
    // per decidere se mostrare la configurazione dell'URL anagrafica MIUR
    // solo all'admin -- useAuth lancia fuori da un provider.
    render(
      <AuthProvider>
        <ImpiantiSpaziView />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /nuova istituzione/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByRole('button', { name: /nuova istituzione/i }));

    const denominazione = `Istituto E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/^denominazione$/i), denominazione);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    // Stesso motivo del test disciplina sopra: il pannello mostra solo le prime
    // 50 istituzioni, serve cercare per essere certi che quella nuova compaia.
    await userEvent.type(screen.getByLabelText(/cerca istituzione/i), denominazione);
    await waitFor(() => expect(screen.getByText(denominazione)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
  }, 240000);

  // Important 2: SpazioForm supporta l'update ma nessun bottone "Modifica" lo apriva.
  it('modifica uno spazio esistente da UI', async () => {
    await loginComeAdmin();

    render(<ImpiantiSpaziView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /nuovo impianto/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByRole('button', { name: /nuovo impianto/i }));
    const nomeImpianto = `Palestra Mod E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nomeImpianto);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));
    await waitFor(() => expect(screen.getByText(nomeImpianto)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByText(nomeImpianto));

    await userEvent.click(screen.getByRole('button', { name: /nuovo spazio/i }));
    const nomeSpazio = `Campo Mod E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nomeSpazio);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));
    await waitFor(() => expect(screen.getByText(nomeSpazio)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);

    await userEvent.click(screen.getByText(nomeSpazio));
    await waitFor(() => expect(screen.getByRole('button', { name: /^modifica$/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByRole('button', { name: /^modifica$/i }));

    const campoNome = screen.getByLabelText(/denominazione/i);
    await userEvent.clear(campoNome);
    const nomeSpazioModificato = `Campo Mod E2E RINOMINATO ${randomUUID().slice(0, 8)}`;
    await userEvent.type(campoNome, nomeSpazioModificato);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    await waitFor(() => expect(screen.getByText(nomeSpazioModificato)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
  }, 240000);

  // Important 3: deselezionare tutte le discipline in modifica ometteva il campo dal
  // payload — il backend interpreta "campo omesso" come "preserva il valore esistente",
  // quindi l'azione falliva silenziosamente. Verificato qui contro il backend reale
  // (non solo che la funzione sia chiamata con l'array vuoto).
  it('deselezionare tutte le discipline di uno spazio in modifica le svuota davvero (contro il backend reale)', async () => {
    await loginComeAdmin();

    // Serve almeno una disciplina esistente da poter selezionare/deselezionare.
    const codiceDisciplina = `E2E${randomUUID().slice(0, 6).toUpperCase()}`;
    await apiFetch('/backoffice/discipline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codice: codiceDisciplina, denominazione: `Disciplina Svuota E2E ${randomUUID().slice(0, 8)}` }),
    });

    render(<ImpiantiSpaziView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /nuovo impianto/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByRole('button', { name: /nuovo impianto/i }));
    const nomeImpianto = `Palestra Svuota E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nomeImpianto);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));
    await waitFor(() => expect(screen.getByText(nomeImpianto)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByText(nomeImpianto));

    await userEvent.click(screen.getByRole('button', { name: /nuovo spazio/i }));
    const nomeSpazio = `Campo Svuota E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nomeSpazio);
    // Seleziona la disciplina appena creata prima di salvare. Non ancora
    // selezionata: con migliaia di discipline fixture nel DB condiviso, il
    // checklist è tagliato a 50 e questa non ci rientra per posizione — va
    // cercata col filtro dello SpazioForm prima di poterla spuntare.
    await userEvent.type(screen.getByLabelText(/cerca disciplina compatibile/i), codiceDisciplina);
    await waitFor(() => expect(screen.getByLabelText(new RegExp(codiceDisciplina))).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByLabelText(new RegExp(codiceDisciplina)));
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));
    await waitFor(() => expect(screen.getByText(nomeSpazio)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);

    // Riapre in modifica e deseleziona tutto.
    await userEvent.click(screen.getByText(nomeSpazio));
    await waitFor(() => expect(screen.getByRole('button', { name: /^modifica$/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByRole('button', { name: /^modifica$/i }));

    const checkbox = await screen.findByLabelText(new RegExp(codiceDisciplina));
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    // Verifica diretta contro il backend reale, non solo lo stato locale del form:
    // la UI potrebbe mostrare correttamente 0 badge anche per un bug che manda
    // un payload sbagliato, se lo stato locale non viene ricaricato dal server.
    await waitFor(async () => {
      const impiantiCreati = await (await apiFetch('/backoffice/impianti')).json();
      const impiantoCreato = (impiantiCreati as Array<{ id: string; denominazione: string }>).find((i) => i.denominazione === nomeImpianto);
      expect(impiantoCreato).toBeDefined();
      const spaziDelImpianto = await (await apiFetch(`/backoffice/impianti/${impiantoCreato!.id}/spazi`)).json();
      const spazioAggiornato = (spaziDelImpianto as Array<{ denominazione: string; disciplineCompatibili: string[] }>).find(
        (s) => s.denominazione === nomeSpazio,
      );
      expect(spazioAggiornato).toBeDefined();
      expect(spazioAggiornato!.disciplineCompatibili).toEqual([]);
    }, WAIT_FOR_TIMEOUT);
  }, 240000);

  // Important 4: la validazione di formato orario (regex HH:MM, prima del confronto
  // lessicografico inizio>=fine) è testata a livello di componente puro, senza
  // backend, in SlotForm.test.tsx — nessun bisogno di ripeterla qui end-to-end.

  describe('propagazione della stagione selezionata in Header (Critical fix)', () => {
    // Prima del fix, ImpiantiSpaziView chiamava una propria listaStagioni() e
    // usava sempre s[0] (la più recente), ignorando del tutto il selettore
    // stagione dell'Header — creaSlot scriveva silenziosamente nella stagione
    // sbagliata. Il fix propaga selectedSeasonId da BackofficeLayout tramite
    // l'Outlet context di react-router; qui montiamo l'albero di route REALE
        // (routes.tsx, lo stesso usato in produzione e in App.test.tsx) e verifichiamo
    // che cambiare la stagione dal select dell'Header cambi davvero quale slot
    // vede/scrive la griglia — non solo che il componente non esploda.
    function renderApp(initialEntry: string) {
      const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
      return render(
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>,
      );
    }

    async function creaStagioneTest(nome: string, dataInizio: string, dataFine: string): Promise<{ id: string; nome: string }> {
      const r = await apiFetch('/backoffice/stagioni', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome, dataInizio, dataFine }),
      });
      return r.json();
    }

    it('cambiando la stagione nel selettore Header, la griglia slot rifetcha con la nuova stagioneId (e creaSlot scrive nella stagione giusta)', async () => {
      const u = await creaUtenteTest(dsn!, 'admin');
      utentiCreati.push(u);
      const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: u.password }),
      });
      const { accessToken, refreshToken } = await loginRes.json();
      localStorage.setItem('polaris_access_token', accessToken);
      localStorage.setItem('polaris_refresh_token', refreshToken);

      const suffisso = randomUUID().slice(0, 8);
      const stagioneX = await creaStagioneTest(`Stagione X ${suffisso}`, '2031-09-01', '2032-06-30');
      const stagioneY = await creaStagioneTest(`Stagione Y ${suffisso}`, '2032-09-01', '2033-06-30');

      renderApp('/impianti-spazi');

      await waitFor(() => expect(screen.getByRole('button', { name: /nuovo impianto/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);

      const selectStagione = screen.getByRole('combobox');
      await waitFor(() => {
        expect(within(selectStagione).getByText(new RegExp(`Stagione X ${suffisso}`))).toBeInTheDocument();
        expect(within(selectStagione).getByText(new RegExp(`Stagione Y ${suffisso}`))).toBeInTheDocument();
      }, WAIT_FOR_TIMEOUT);

      // Crea impianto + spazio (indipendenti dalla stagione).
      await userEvent.click(screen.getByRole('button', { name: /nuovo impianto/i }));
      const nomeImpianto = `Palestra Ctx E2E ${suffisso}`;
      await userEvent.type(screen.getByLabelText(/denominazione/i), nomeImpianto);
      await userEvent.click(screen.getByRole('button', { name: /salva/i }));
      await waitFor(() => expect(screen.getByText(nomeImpianto)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
      await userEvent.click(screen.getByText(nomeImpianto));

      await userEvent.click(screen.getByRole('button', { name: /nuovo spazio/i }));
      const nomeSpazio = `Campo Ctx E2E ${suffisso}`;
      await userEvent.type(screen.getByLabelText(/denominazione/i), nomeSpazio);
      await userEvent.click(screen.getByRole('button', { name: /salva/i }));
      await waitFor(() => expect(screen.getByText(nomeSpazio)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
      await userEvent.click(screen.getByText(nomeSpazio));

      // Seleziona esplicitamente la Stagione X, poi crea uno slot: deve finire su X.
      await userEvent.selectOptions(selectStagione, stagioneX.id);
      await waitFor(() => expect(screen.getByRole('button', { name: /nuovo slot/i })).toBeEnabled(), WAIT_FOR_TIMEOUT);
      await userEvent.click(screen.getByRole('button', { name: /nuovo slot/i }));
      await userEvent.type(screen.getByLabelText(/ora inizio/i), '09:00');
      await userEvent.type(screen.getByLabelText(/ora fine/i), '10:00');
      await userEvent.click(screen.getByRole('button', { name: /salva/i }));
      await waitFor(() => expect(screen.getByText('09:00 - 10:00')).toBeInTheDocument(), WAIT_FOR_TIMEOUT);

      // Passa alla Stagione Y: lo slot creato su X non deve comparire (la griglia
      // ha rifetchato con la nuova stagioneId, non è rimasta sullo stato vecchio).
      await userEvent.selectOptions(selectStagione, stagioneY.id);
      await waitFor(() => expect(screen.queryByText('09:00 - 10:00')).not.toBeInTheDocument(), WAIT_FOR_TIMEOUT);

      // Torna sulla Stagione X: lo slot creato prima riappare — prova che è stato
      // scritto davvero sotto X (non sotto "l'ultima stagione", il bug originale).
      await userEvent.selectOptions(selectStagione, stagioneX.id);
      await waitFor(() => expect(screen.getByText('09:00 - 10:00')).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    }, 240000);
  });
});
