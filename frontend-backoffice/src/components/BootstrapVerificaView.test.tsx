import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as bootstrapApi from '../api/bootstrap.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { BootstrapVerificaView } from './BootstrapVerificaView.tsx';

function renderView(initialEntry: string) {
  const router = createMemoryRouter([
    { path: '/bootstrap/verifica', element: <BootstrapVerificaView /> },
    { path: '/bootstrap', element: <div>Pagina di richiesta bootstrap</div> },
    { path: '/login', element: <div>Pagina di login</div> },
  ], { initialEntries: [initialEntry] });
  return render(<RouterProvider router={router} />);
}

describe('BootstrapVerificaView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('nessun token nella query string: messaggio dedicato, mai chiama verificaBootstrap', async () => {
    const spy = vi.spyOn(bootstrapApi, 'verificaBootstrap');
    renderView('/bootstrap/verifica');

    expect(await screen.findByText(/token mancante/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('token valido: chiama verificaBootstrap col token dalla query string, mostra l\'email attivata', async () => {
    const spy = vi.spyOn(bootstrapApi, 'verificaBootstrap').mockResolvedValue({ email: 'admin@example.com' });
    renderView('/bootstrap/verifica?token=abc123');

    expect(spy).toHaveBeenCalledWith('abc123');
    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /vai al login/i })).toBeInTheDocument();
  });

  it('token non valido/scaduto: messaggio verbatim dal backend, link per richiederne uno nuovo', async () => {
    vi.spyOn(bootstrapApi, 'verificaBootstrap').mockRejectedValue(
      new ErroreRichiestaApi(401, 'token di verifica non valido o scaduto'),
    );
    renderView('/bootstrap/verifica?token=scaduto');

    expect(await screen.findByText(/token di verifica non valido o scaduto/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /richiedi un nuovo link/i })).toBeInTheDocument();
  });
});
