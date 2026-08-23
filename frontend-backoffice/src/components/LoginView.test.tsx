import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as AuthContextModule from '../auth/AuthContext.tsx';
import { ErroreServizioNonRaggiungibile } from '../auth/AuthContext.tsx';
import * as bootstrapApi from '../api/bootstrap.ts';
import { LoginView } from './LoginView.tsx';

function renderView() {
  const router = createMemoryRouter([
    { path: '/login', element: <LoginView /> },
    { path: '/bootstrap', element: <div>Pagina di bootstrap</div> },
  ], { initialEntries: ['/login'] });
  return render(<RouterProvider router={router} />);
}

describe('LoginView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(bootstrapApi, 'statoBootstrap').mockResolvedValue({ disponibile: false });
  });

  it('submit con credenziali valide chiama login con email e password inserite', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      utente: null,
      caricamento: false,
      login: loginMock,
      logout: vi.fn(),
    });

    renderView();

    await userEvent.type(screen.getByLabelText(/email/i), 'admin@test.local');
    await userEvent.type(screen.getByLabelText(/password/i), 'password-corretta');
    await userEvent.click(screen.getByRole('button', { name: /accedi/i }));

    expect(loginMock).toHaveBeenCalledWith('admin@test.local', 'password-corretta');
  });

  it('submit con credenziali sbagliate mostra un messaggio di errore', async () => {
    const loginMock = vi.fn().mockRejectedValue(new Error('credenziali non valide'));
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      utente: null,
      caricamento: false,
      login: loginMock,
      logout: vi.fn(),
    });

    renderView();

    await userEvent.type(screen.getByLabelText(/email/i), 'admin@test.local');
    await userEvent.type(screen.getByLabelText(/password/i), 'password-sbagliata');
    await userEvent.click(screen.getByRole('button', { name: /accedi/i }));

    expect(await screen.findByText(/credenziali non valide/i)).toBeInTheDocument();
  });

  it('submit con backend irraggiungibile mostra un messaggio distinto da "credenziali non valide"', async () => {
    const loginMock = vi.fn().mockRejectedValue(new ErroreServizioNonRaggiungibile('backend irraggiungibile'));
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      utente: null,
      caricamento: false,
      login: loginMock,
      logout: vi.fn(),
    });

    renderView();

    await userEvent.type(screen.getByLabelText(/email/i), 'admin@test.local');
    await userEvent.type(screen.getByLabelText(/password/i), 'qualsiasi-password');
    await userEvent.click(screen.getByRole('button', { name: /accedi/i }));

    expect(await screen.findByText(/servizio non raggiungibile/i)).toBeInTheDocument();
  });

  it('bootstrap non disponibile: nessun link al wizard primo admin', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      utente: null,
      caricamento: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    renderView();

    await screen.findByRole('button', { name: /accedi/i });
    expect(screen.queryByRole('link', { name: /crea il primo account/i })).not.toBeInTheDocument();
  });

  it('bootstrap disponibile: mostra il link al wizard primo admin', async () => {
    vi.spyOn(bootstrapApi, 'statoBootstrap').mockResolvedValue({ disponibile: true });
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      utente: null,
      caricamento: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    renderView();

    expect(await screen.findByRole('link', { name: /crea il primo account/i })).toBeInTheDocument();
  });
});
