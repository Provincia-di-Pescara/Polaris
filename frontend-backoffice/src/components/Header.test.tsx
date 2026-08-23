import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as AuthContextModule from '../auth/AuthContext.tsx';
import type { Utente } from '../auth/AuthContext.tsx';
import * as stagioniApi from '../api/stagioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
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

  it('operatore: nessun bottone "Nuova stagione"', () => {
    mockUtente('operatore');
    render(<Header seasons={STAGIONI} selectedSeasonId="s1" setSelectedSeasonId={vi.fn()} onStagioneCreata={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /nuova stagione/i })).not.toBeInTheDocument();
  });

  it('admin: click su "Nuova stagione" apre il form, submit chiama creaStagione e poi onStagioneCreata con l\'id ricevuto', async () => {
    mockUtente('admin');
    const onStagioneCreata = vi.fn();
    const spy = vi.spyOn(stagioniApi, 'creaStagione').mockResolvedValue({
      id: 'nuova-id', nome: 'Stagione 2031/2032', dataInizio: '2031-09-01', dataFine: '2032-06-30', stato: 'censimento',
    });

    render(<Header seasons={STAGIONI} selectedSeasonId="s1" setSelectedSeasonId={vi.fn()} onStagioneCreata={onStagioneCreata} />);

    await userEvent.click(screen.getByRole('button', { name: /nuova stagione/i }));
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'Stagione 2031/2032');
    await userEvent.type(screen.getByLabelText(/data inizio/i), '2031-09-01');
    await userEvent.type(screen.getByLabelText(/data fine/i), '2032-06-30');
    await userEvent.click(screen.getByRole('button', { name: /^crea$/i }));

    expect(spy).toHaveBeenCalledWith({ nome: 'Stagione 2031/2032', dataInizio: '2031-09-01', dataFine: '2032-06-30' });
    expect(onStagioneCreata).toHaveBeenCalledWith('nuova-id');
  });

  it('admin: errore dal backend mostrato verbatim, form resta aperto', async () => {
    mockUtente('admin');
    vi.spyOn(stagioniApi, 'creaStagione').mockRejectedValue(new ErroreRichiestaApi(409, 'esiste già una stagione con questo nome'));

    render(<Header seasons={STAGIONI} selectedSeasonId="s1" setSelectedSeasonId={vi.fn()} onStagioneCreata={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /nuova stagione/i }));
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'Stagione duplicata');
    await userEvent.type(screen.getByLabelText(/data inizio/i), '2031-09-01');
    await userEvent.type(screen.getByLabelText(/data fine/i), '2032-06-30');
    await userEvent.click(screen.getByRole('button', { name: /^crea$/i }));

    expect(await screen.findByText(/esiste già una stagione con questo nome/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^nome$/i)).toBeInTheDocument();
  });
});
