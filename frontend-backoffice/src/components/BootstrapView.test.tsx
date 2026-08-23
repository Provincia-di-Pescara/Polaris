import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as bootstrapApi from '../api/bootstrap.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { BootstrapView } from './BootstrapView.tsx';

function renderView() {
  const router = createMemoryRouter([
    { path: '/bootstrap', element: <BootstrapView /> },
    { path: '/login', element: <div>Pagina di login</div> },
  ], { initialEntries: ['/bootstrap'] });
  return render(<RouterProvider router={router} />);
}

describe('BootstrapView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('bootstrap non disponibile: messaggio dedicato, nessun form', async () => {
    vi.spyOn(bootstrapApi, 'statoBootstrap').mockResolvedValue({ disponibile: false });
    renderView();

    expect(await screen.findByText(/esiste già un account amministratore/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
  });

  it('errore nel controllo dello stato: messaggio d\'errore, nessun form', async () => {
    vi.spyOn(bootstrapApi, 'statoBootstrap').mockRejectedValue(new ErroreRichiestaApi(500, 'errore interno'));
    renderView();

    expect(await screen.findByText(/errore interno/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
  });

  it('bootstrap disponibile: submit chiama richiediPrimoAdmin coi dati inseriti, poi mostra conferma', async () => {
    vi.spyOn(bootstrapApi, 'statoBootstrap').mockResolvedValue({ disponibile: true });
    const spy = vi.spyOn(bootstrapApi, 'richiediPrimoAdmin').mockResolvedValue(undefined);
    renderView();

    await screen.findByLabelText(/^email$/i);
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'Mario');
    await userEvent.type(screen.getByLabelText(/^cognome$/i), 'Rossi');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'mario.rossi@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'password-lunga-sicura');
    await userEvent.click(screen.getByRole('button', { name: /crea account/i }));

    expect(spy).toHaveBeenCalledWith({
      email: 'mario.rossi@example.com',
      password: 'password-lunga-sicura',
      nome: 'Mario',
      cognome: 'Rossi',
    });
    expect(await screen.findByText(/richiesta inviata/i)).toBeInTheDocument();
    expect(screen.getByText('mario.rossi@example.com')).toBeInTheDocument();
  });

  it('errore nella richiesta di creazione: messaggio verbatim dal backend', async () => {
    vi.spyOn(bootstrapApi, 'statoBootstrap').mockResolvedValue({ disponibile: true });
    vi.spyOn(bootstrapApi, 'richiediPrimoAdmin').mockRejectedValue(
      new ErroreRichiestaApi(503, 'SMTP di bootstrap non configurato (SMTP_HOST/BACKOFFICE_BASE_URL in .env)'),
    );
    renderView();

    await screen.findByLabelText(/^email$/i);
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'Mario');
    await userEvent.type(screen.getByLabelText(/^cognome$/i), 'Rossi');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'mario.rossi@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'password-lunga-sicura');
    await userEvent.click(screen.getByRole('button', { name: /crea account/i }));

    expect(await screen.findByText(/SMTP di bootstrap non configurato/i)).toBeInTheDocument();
  });
});
