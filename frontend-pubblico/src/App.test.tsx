import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as authApi from './api/auth.ts';
import * as deleghe from './api/deleghe.ts';
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
});
