import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as authApi from '../api/auth.ts';
import * as deleghe from '../api/deleghe.ts';
import { AuthProvider, useAuth } from './AuthContext.tsx';

function Sonda(): React.ReactElement {
  const { persona, entities, caricamento } = useAuth();
  if (caricamento) return <div>caricamento</div>;
  return <div>{persona ? `${persona.nome} ${persona.cognome} - ${entities.length} entità` : 'nessuna sessione'}</div>;
}

describe('AuthContext', () => {
  it('carica persona ed entità quando la sessione è valida', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockResolvedValue({
      sub: 'p1', codiceFiscale: 'CF', nome: 'Mario', cognome: 'Rossi',
    });
    vi.spyOn(deleghe, 'listaEntitaRappresentate').mockResolvedValue([]);

    render(<AuthProvider><Sonda /></AuthProvider>);

    expect(await screen.findByText('Mario Rossi - 0 entità')).toBeInTheDocument();
  });

  it('nessuna sessione: persona resta null', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockRejectedValue(new Error('401'));

    render(<AuthProvider><Sonda /></AuthProvider>);

    expect(await screen.findByText('nessuna sessione')).toBeInTheDocument();
  });
});
