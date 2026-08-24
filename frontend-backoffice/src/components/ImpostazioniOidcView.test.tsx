import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api/impostazioniOidc.ts';
import { ImpostazioniOidcView } from './ImpostazioniOidcView.tsx';

const REDIRECT_URI = 'http://localhost:5174/oidc/callback';

const CONFIG: api.ConfigOidc = {
  issuer: 'https://idp.test', clientId: 'client-test', redirectUri: REDIRECT_URI, clientSecretConfigurato: true,
};

describe('ImpostazioniOidcView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'leggiRedirectUri').mockResolvedValue(REDIRECT_URI);
  });

  it('non ancora configurato: mostra il form vuoto', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(null);
    render(<ImpostazioniOidcView />);
    expect(await screen.findByLabelText(/issuer/i)).toHaveValue('');
    expect(screen.getByPlaceholderText(/obbligatorio al primo salvataggio/i)).toBeInTheDocument();
  });

  // Scenario reale trovato in produzione (2026-08-24): la primissima
  // configurazione di un'istanza (nessun issuer/clientId salvato ancora, GET
  // .../oidc risponde 404) deve comunque mostrare il redirect URI calcolato --
  // altrimenti un admin non può copiarlo per la registrazione lato IdP prima
  // di aver mai salvato nulla.
  it('non ancora configurato ma FRONTEND_PUBBLICO_BASE_URL impostata: mostra comunque il redirect URI', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(null);
    render(<ImpostazioniOidcView />);
    expect(await screen.findByDisplayValue(REDIRECT_URI)).toBeInTheDocument();
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

    const campo = await screen.findByDisplayValue(REDIRECT_URI);
    expect(campo).toHaveAttribute('readonly');
  });

  it('redirectUri calcolato: il bottone copia scrive negli appunti', async () => {
    const scriviAppunti = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: scriviAppunti } });
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    render(<ImpostazioniOidcView />);

    await screen.findByDisplayValue(REDIRECT_URI);
    await userEvent.click(screen.getByRole('button', { name: /^copia$/i }));

    expect(scriviAppunti).toHaveBeenCalledWith(REDIRECT_URI);
    expect(await screen.findByText(/copiato/i)).toBeInTheDocument();
  });

  it('FRONTEND_PUBBLICO_BASE_URL non impostata: mostra un avviso invece del link', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    vi.spyOn(api, 'leggiRedirectUri').mockResolvedValue(null);
    render(<ImpostazioniOidcView />);

    expect(await screen.findByText(/FRONTEND_PUBBLICO_BASE_URL/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^copia$/i })).not.toBeInTheDocument();
  });
});
