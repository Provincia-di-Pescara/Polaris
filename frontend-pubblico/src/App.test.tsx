import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as authApi from './api/auth.ts';
import * as deleghe from './api/deleghe.ts';
import * as stagioniApi from './api/stagioni.ts';
import * as associazioniApi from './api/associazioni.ts';
import { ErroreRichiestaApi } from './api/client.ts';
import { App } from './App.tsx';

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

  it('carica le stagioni e seleziona di default la prima non chiusa', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockResolvedValue({ sub: 'p1', codiceFiscale: 'CF', nome: 'Mario', cognome: 'Rossi' });
    vi.spyOn(deleghe, 'listaEntitaRappresentate').mockResolvedValue([]);
    vi.spyOn(stagioniApi, 'listaStagioni').mockResolvedValue([
      { id: 'st-chiusa', nome: 'Vecchia', dataInizio: '2024-09-01', dataFine: '2025-06-30', stato: 'chiusa' },
      { id: 'st-attiva', nome: 'Corrente', dataInizio: '2026-09-01', dataFine: '2027-06-30', stato: 'censimento' },
    ]);
    render(<App />);
    // Non basta verificare la presenza testuale di "Corrente": Header.tsx
    // renderizza un'<option> per ogni stagione, quindi il testo sarebbe
    // presente anche se la selezione di default fosse errata (es. la
    // stagione chiusa). Verifichiamo il valore effettivamente selezionato
    // nel combobox della stagione.
    expect(await screen.findByRole('combobox', { name: /stagione/i })).toHaveValue('st-attiva');
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
    });
    vi.spyOn(associazioniApi, 'caricaDocumento').mockRejectedValue(new ErroreRichiestaApi(415, 'il contenuto del file non è un PDF valido'));

    render(<App />);

    await screen.findByText(/Mario Rossi/);
    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
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
