import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as authApi from './api/auth.ts';
import * as deleghe from './api/deleghe.ts';
import * as stagioniApi from './api/stagioni.ts';
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
});
