import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as utentiApi from '../api/utenti.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { AccettaInvitoView } from './AccettaInvitoView.tsx';

function renderView(initialEntry: string) {
  const router = createMemoryRouter([
    { path: '/utenti/accetta-invito', element: <AccettaInvitoView /> },
    { path: '/login', element: <div>Pagina di login</div> },
  ], { initialEntries: [initialEntry] });
  return render(<RouterProvider router={router} />);
}

describe('AccettaInvitoView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('nessun token nella query string: messaggio dedicato, nessun form', async () => {
    renderView('/utenti/accetta-invito');

    expect(await screen.findByText(/token mancante/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
  });

  it('password e conferma diverse: errore locale, mai chiama accettaInvito', async () => {
    const spy = vi.spyOn(utentiApi, 'accettaInvito');
    const user = userEvent.setup();
    renderView('/utenti/accetta-invito?token=abc123');

    await user.type(screen.getByLabelText(/^password/i), 'password-lunga-123');
    await user.type(screen.getByLabelText(/conferma password/i), 'password-diversa-456');
    await user.click(screen.getByRole('button', { name: /imposta password/i }));

    expect(await screen.findByText(/non coincidono/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('token e password valide: chiama accettaInvito col token dalla query string, mostra successo', async () => {
    const spy = vi.spyOn(utentiApi, 'accettaInvito').mockResolvedValue({
      id: '1', email: 'utente@example.com', nome: 'Mario', cognome: 'Rossi',
      ruolo: 'operatore', stato: 'attivo', creatoDa: null, creatoIl: '', ultimoAccessoIl: null,
    });
    const user = userEvent.setup();
    renderView('/utenti/accetta-invito?token=abc123');

    await user.type(screen.getByLabelText(/^password/i), 'password-lunga-123');
    await user.type(screen.getByLabelText(/conferma password/i), 'password-lunga-123');
    await user.click(screen.getByRole('button', { name: /imposta password/i }));

    expect(spy).toHaveBeenCalledWith({ token: 'abc123', password: 'password-lunga-123' });
    expect(await screen.findByText(/successo/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /vai al login/i })).toBeInTheDocument();
  });

  it('token non valido/scaduto: messaggio verbatim dal backend', async () => {
    vi.spyOn(utentiApi, 'accettaInvito').mockRejectedValue(
      new ErroreRichiestaApi(400, 'token di invito non valido o scaduto'),
    );
    const user = userEvent.setup();
    renderView('/utenti/accetta-invito?token=scaduto');

    await user.type(screen.getByLabelText(/^password/i), 'password-lunga-123');
    await user.type(screen.getByLabelText(/conferma password/i), 'password-lunga-123');
    await user.click(screen.getByRole('button', { name: /imposta password/i }));

    expect(await screen.findByText(/token di invito non valido o scaduto/i)).toBeInTheDocument();
  });
});
