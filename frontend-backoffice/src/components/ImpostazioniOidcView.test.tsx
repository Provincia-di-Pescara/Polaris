import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api/impostazioniOidc.ts';
import { ImpostazioniOidcView } from './ImpostazioniOidcView.tsx';

const CONFIG: api.ConfigOidc = {
  issuer: 'https://idp.test', clientId: 'client-test', redirectUri: 'http://localhost:5174/oidc/callback', clientSecretConfigurato: true,
};

describe('ImpostazioniOidcView', () => {
  it('non ancora configurato: mostra il form vuoto', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(null);
    render(<ImpostazioniOidcView />);
    expect(await screen.findByLabelText(/issuer/i)).toHaveValue('');
    expect(screen.getByPlaceholderText(/obbligatorio al primo salvataggio/i)).toBeInTheDocument();
  });

  it('già configurato: precompila il form, secret non mostrato in chiaro', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    render(<ImpostazioniOidcView />);
    expect(await screen.findByLabelText(/issuer/i)).toHaveValue('https://idp.test');
    expect(screen.getByPlaceholderText(/invariato/i)).toBeInTheDocument();
  });

  it('salva la configurazione senza clientSecret quando il campo resta vuoto', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    const salva = vi.spyOn(api, 'salvaConfigOidc').mockResolvedValue(CONFIG);
    render(<ImpostazioniOidcView />);
    await screen.findByLabelText(/issuer/i);

    await userEvent.click(screen.getByRole('button', { name: /salva configurazione/i }));

    expect(salva).toHaveBeenCalledWith({
      issuer: 'https://idp.test', clientId: 'client-test', redirectUri: 'http://localhost:5174/oidc/callback', clientSecret: undefined,
    });
  });
});
