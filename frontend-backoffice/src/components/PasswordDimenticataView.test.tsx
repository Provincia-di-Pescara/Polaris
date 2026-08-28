import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as utentiApi from '../api/utenti.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { PasswordDimenticataView } from './PasswordDimenticataView.tsx';

function renderView() {
  const router = createMemoryRouter([
    { path: '/password-dimenticata', element: <PasswordDimenticataView /> },
    { path: '/login', element: <div>Pagina di login</div> },
  ], { initialEntries: ['/password-dimenticata'] });
  return render(<RouterProvider router={router} />);
}

describe('PasswordDimenticataView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invio riuscito: chiama richiediPasswordDimenticata con l\'email, mostra messaggio generico', async () => {
    const spy = vi.spyOn(utentiApi, 'richiediPasswordDimenticata').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderView();

    await user.type(screen.getByLabelText(/^email/i), 'utente@example.com');
    await user.click(screen.getByRole('button', { name: /invia email di recupero/i }));

    expect(spy).toHaveBeenCalledWith('utente@example.com');
    expect(await screen.findByText(/riceverà a breve/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /torna al login/i })).toBeInTheDocument();
  });

  it('stesso messaggio generico anche se il backend risponde 200 per email inesistente (no enumeration lato UI)', async () => {
    vi.spyOn(utentiApi, 'richiediPasswordDimenticata').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderView();

    await user.type(screen.getByLabelText(/^email/i), 'inesistente@example.com');
    await user.click(screen.getByRole('button', { name: /invia email di recupero/i }));

    expect(await screen.findByText(/riceverà a breve/i)).toBeInTheDocument();
  });

  it('errore imprevisto (es. 503 SMTP non configurato): messaggio verbatim dal backend', async () => {
    vi.spyOn(utentiApi, 'richiediPasswordDimenticata').mockRejectedValue(
      new ErroreRichiestaApi(503, 'SMTP non configurato (SMTP_HOST/BACKOFFICE_BASE_URL in .env)'),
    );
    const user = userEvent.setup();
    renderView();

    await user.type(screen.getByLabelText(/^email/i), 'utente@example.com');
    await user.click(screen.getByRole('button', { name: /invia email di recupero/i }));

    expect(await screen.findByText(/SMTP non configurato/i)).toBeInTheDocument();
  });
});
