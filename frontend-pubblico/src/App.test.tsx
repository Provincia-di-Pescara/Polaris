import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as authApi from './api/auth.ts';
import * as deleghe from './api/deleghe.ts';
import * as stagioniApi from './api/stagioni.ts';
import * as associazioniApi from './api/associazioni.ts';
import { ErroreRichiestaApi } from './api/client.ts';
import { App } from './App.tsx';

// Riempie tutti i campi obbligatori del form di creazione associazione tranne
// denominazione/CF (compilati separatamente da ciascun test) — stesso helper
// usato in components/AccreditamentoDelegaView.test.tsx.
function compilaCampiObbligatoriAssociazione(): void {
  const set = (id: string, value: string): void => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Campo #${id} non trovato`);
    fireEvent.change(el, { target: { value } });
  };
  set('acc-rl-nome', 'Mario');
  set('acc-rl-cognome', 'Rossi');
  set('acc-indirizzo-via', 'Via Roma');
  set('acc-indirizzo-civico', '1');
  set('acc-indirizzo-citta', 'Pescara');
  set('acc-email', 'asd@example.com');
  set('acc-rct-compagnia', 'Generali');
  set('acc-rct-polizza', 'POL123');
  set('acc-rct-massimale', '1000000.00');
  set('acc-rct-dal', '2026-01-01');
  set('acc-rct-al', '2027-01-01');
  set('acc-sic-nome', 'Luigi');
  set('acc-sic-cognome', 'Verdi');
  set('acc-sic-nato-a', 'Pescara');
  set('acc-sic-nato-il', '1980-01-01');
  set('acc-sic-via', 'Via Milano');
  set('acc-sic-citta', 'Pescara');
  set('acc-sic-cellulare', '3331234567');
  set('acc-sic-cid', 'AB1234567');
  set('acc-eme-nome', 'Anna');
  set('acc-eme-cognome', 'Bianchi');
  set('acc-eme-nato-a', 'Pescara');
  set('acc-eme-nato-il', '1985-05-05');
  set('acc-eme-via', 'Via Napoli');
  set('acc-eme-citta', 'Pescara');
  set('acc-eme-cellulare', '3339876543');
  set('acc-eme-cid', 'CD7654321');
  set('acc-dae-marca', 'Philips');
  set('acc-dae-matricola', 'DAE001');
  set('acc-dae-scadenza', '2028-01-01');
}

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('senza sessione, mostra LoginView', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockRejectedValue(new Error('401'));
    render(<App />);
    expect(await screen.findByRole('button', { name: /accedi con spid/i })).toBeInTheDocument();
  });

  it('con sessione valida, mostra Header con la persona reale', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockResolvedValue({
      sub: 'p1', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
    });
    vi.spyOn(deleghe, 'listaEntitaRappresentate').mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByText(/Mario Rossi/)).toBeInTheDocument();
  });

  it('carica le stagioni ma non ne pre-seleziona nessuna (2026-08-24: più stagioni non chiuse possono coesistere)', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockResolvedValue({ sub: 'p1', codiceFiscale: 'CF', nome: 'Mario', cognome: 'Rossi' });
    vi.spyOn(deleghe, 'listaEntitaRappresentate').mockResolvedValue([]);
    vi.spyOn(stagioniApi, 'listaStagioni').mockResolvedValue([
      { id: 'st-chiusa', nome: 'Vecchia', dataInizio: '2024-09-01', dataFine: '2025-06-30', stato: 'chiusa' },
      { id: 'st-definitiva', nome: 'Corrente', dataInizio: '2025-09-01', dataFine: '2026-06-30', stato: 'definitiva' },
      { id: 'st-censimento', nome: 'Prossima', dataInizio: '2026-09-01', dataFine: '2027-06-30', stato: 'censimento' },
    ]);
    render(<App />);
    const selettore = await screen.findByRole('combobox', { name: /stagione/i });
    expect(selettore).toHaveValue('');
    // Entrambe le non-chiuse selezionabili, quella chiusa esclusa dalle opzioni.
    expect(screen.getByRole('option', { name: /Corrente — Definitiva/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Prossima — Censimento/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Vecchia/ })).not.toBeInTheDocument();
  });

  it('un ricarica() successivo (es. dopo upload fallito) non smonta la view e non ne cancella lo stato locale', async () => {
    // Regressione: AppAutenticata usava `if (caricamento) return <Caricamento/>`
    // per OGNI caricamento, non solo il primo. Un ricarica() (chiamato da
    // AccreditamentoDelegaView dopo un upload documento fallito) rimetteva
    // caricamento a true, smontando l'intero albero autenticato — inclusa
    // AccreditamentoDelegaView e il suo avviso locale "upload fallito" —
    // prima che l'utente potesse leggerlo.
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockResolvedValue({
      sub: 'p1', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
    });
    vi.spyOn(deleghe, 'listaEntitaRappresentate').mockResolvedValue([]);
    vi.spyOn(stagioniApi, 'listaStagioni').mockResolvedValue([
      { id: 'st1', nome: 'Corrente', dataInizio: '2026-09-01', dataFine: '2027-06-30', stato: 'censimento' },
    ]);
    vi.spyOn(associazioniApi, 'creaAssociazione').mockResolvedValue({
      id: 'nuova-ass', denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', rnaNumeroIscrizione: null, dataCostituzione: null,
      rappresentanteLegaleNome: 'Mario', rappresentanteLegaleCognome: 'Rossi', delegatoNome: null, delegatoCognome: null,
      indirizzoVia: 'Via Roma', indirizzoCivico: '1', indirizzoCitta: 'Pescara', pec: null, email: 'asd@example.com',
      tipologiaSoggetto: 'associazione_sportiva', iscrittaRasd: false, organismoSportivoCodice: null, codiceAffiliazione: null,
      haPersonaleAssunto: false,
    });
    vi.spyOn(associazioniApi, 'caricaDocumento').mockRejectedValue(new ErroreRichiestaApi(415, 'il contenuto del file non è un PDF valido'));

    render(<App />);

    await screen.findByText(/Mario Rossi/);
    // Selezione esplicita: nessun default automatico (2026-08-24) -- il
    // bottone "Richiedi nuova delega" resta disabilitato senza una stagione.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /stagione/i }), 'st1');
    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    compilaCampiObbligatoriAssociazione();
    const file = new File(['contenuto'], 'doc.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/carica documento/i), file);
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    // L'avviso deve comparire e restare visibile anche dopo che il
    // ricarica() innescato dalla submit ha completato il suo giro (persona
    // ed entities rifetchate) — non solo nell'istante subito dopo il submit.
    const avviso = await screen.findByText(/associazione creata, ma il caricamento del documento è fallito/i);
    expect(avviso).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText(/associazione creata, ma il caricamento del documento è fallito/i)).toBeInTheDocument();
    expect(screen.getByText(/Mario Rossi/)).toBeInTheDocument();
  });
});
