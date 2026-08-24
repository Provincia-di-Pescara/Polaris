import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import * as AuthContextModule from '../auth/AuthContext.tsx';
import type { Utente } from '../auth/AuthContext.tsx';
import { Header } from './Header.tsx';
import type { Stagione } from '../api/stagioni.ts';

const STAGIONI: Stagione[] = [
  { id: 's1', nome: 'Stagione 2030/2031', dataInizio: '2030-09-01', dataFine: '2031-06-30', stato: 'accreditamento' },
];

function mockUtente(ruolo: Utente['ruolo']): void {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    utente: { email: 'test@example.com', ruolo, sub: 'u1' },
    caricamento: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

describe('Header', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('operatore: nessun bottone "Gestisci stagioni"', () => {
    mockUtente('operatore');
    render(
      <MemoryRouter>
        <Header seasons={STAGIONI} selectedSeasonId="s1" setSelectedSeasonId={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /gestisci stagioni/i })).not.toBeInTheDocument();
  });

  it('admin: mostra il bottone "Gestisci stagioni" (creazione/modifica ora vivono in StagioniView)', () => {
    mockUtente('admin');
    render(
      <MemoryRouter>
        <Header seasons={STAGIONI} selectedSeasonId="s1" setSelectedSeasonId={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: /gestisci stagioni/i })).toBeInTheDocument();
  });

  it('selettore: elenca le stagioni passate, invoca setSelectedSeasonId al cambio', async () => {
    mockUtente('admin');
    const setSelectedSeasonId = vi.fn();
    render(
      <MemoryRouter>
        <Header
          seasons={[...STAGIONI, { id: 's2', nome: 'Stagione 2031/2032', dataInizio: '2031-09-01', dataFine: '2032-06-30', stato: 'censimento' }]}
          selectedSeasonId="s1"
          setSelectedSeasonId={setSelectedSeasonId}
        />
      </MemoryRouter>,
    );

    await userEvent.selectOptions(screen.getByDisplayValue(/Stagione 2030\/2031/i), 's2');
    expect(setSelectedSeasonId).toHaveBeenCalledWith('s2');
  });
});
