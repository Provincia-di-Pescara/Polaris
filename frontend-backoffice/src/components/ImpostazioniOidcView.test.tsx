import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api/impostazioniOidc.ts';
import { ImpostazioniOidcView } from './ImpostazioniOidcView.tsx';

const CONFIG: api.ConfigOidc = {
  issuer: 'https://idp.test', clientId: 'client-test', redirectUri: 'http://localhost:5174/oidc/callback', clientSecretConfigurato: true,
};

const CONFIG_SENZA_REDIRECT: api.ConfigOidc = { ...CONFIG, redirectUri: null };

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

  it('salva la configurazione senza redirectUri (calcolato server-side, non inviato)', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    const salva = vi.spyOn(api, 'salvaConfigOidc').mockResolvedValue(CONFIG);
    render(<ImpostazioniOidcView />);
    await screen.findByLabelText(/issuer/i);

    await userEvent.click(screen.getByRole('button', { name: /salva configurazione/i }));

    expect(salva).toHaveBeenCalledWith({
      issuer: 'https://idp.test', clientId: 'client-test', clientSecret: undefined,
    });
  });

  it('redirectUri calcolato: mostrato in un campo sola lettura, non editabile', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    render(<ImpostazioniOidcView />);

    const campo = await screen.findByDisplayValue('http://localhost:5174/oidc/callback');
    expect(campo).toHaveAttribute('readonly');
  });

  it('redirectUri calcolato: il bottone copia scrive negli appunti', async () => {
    const scriviAppunti = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: scriviAppunti } });
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    render(<ImpostazioniOidcView />);

    await screen.findByDisplayValue('http://localhost:5174/oidc/callback');
    await userEvent.click(screen.getByRole('button', { name: /^copia$/i }));

    expect(scriviAppunti).toHaveBeenCalledWith('http://localhost:5174/oidc/callback');
    expect(await screen.findByText(/copiato/i)).toBeInTheDocument();
  });

  it('FRONTEND_PUBBLICO_BASE_URL non impostata: mostra un avviso invece del link', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG_SENZA_REDIRECT);
    render(<ImpostazioniOidcView />);

    expect(await screen.findByText(/FRONTEND_PUBBLICO_BASE_URL/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^copia$/i })).not.toBeInTheDocument();
  });
});
