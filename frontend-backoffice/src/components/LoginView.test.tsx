import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as AuthContextModule from '../auth/AuthContext.tsx';
import { ErroreServizioNonRaggiungibile } from '../auth/AuthContext.tsx';
import { LoginView } from './LoginView.tsx';

describe('LoginView', () => {
  it('submit con credenziali valide chiama login con email e password inserite', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      utente: null,
      caricamento: false,
      login: loginMock,
      logout: vi.fn(),
    });

    render(<LoginView />);

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

    render(<LoginView />);

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

    render(<LoginView />);

    await userEvent.type(screen.getByLabelText(/email/i), 'admin@test.local');
    await userEvent.type(screen.getByLabelText(/password/i), 'qualsiasi-password');
    await userEvent.click(screen.getByRole('button', { name: /accedi/i }));

    expect(await screen.findByText(/servizio non raggiungibile/i)).toBeInTheDocument();
  });
});
