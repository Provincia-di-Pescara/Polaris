import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import * as AuthContextModule from '../auth/AuthContext.tsx';
import type { Utente } from '../auth/AuthContext.tsx';
import { Sidebar } from './Sidebar.tsx';

function mockUtente(ruolo: Utente['ruolo']): void {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    utente: { email: 'test@example.com', ruolo, sub: 'u1' },
    caricamento: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function renderSidebar(rottaIniziale: string) {
  const router = createMemoryRouter(
    [{ path: '*', element: <><Sidebar /><Outlet /></>, children: [{ path: '*', element: <div>Contenuto</div> }] }],
    { initialEntries: [rottaIniziale] },
  );
  return render(<RouterProvider router={router} />);
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('operatore: il gruppo Impostazioni non è visibile', () => {
    mockUtente('operatore');
    renderSidebar('/control-room');

    expect(screen.queryByText('Impostazioni')).not.toBeInTheDocument();
  });

  it('admin: il gruppo Impostazioni è chiuso di default fuori dalle sue rotte figlie', () => {
    mockUtente('admin');
    renderSidebar('/control-room');

    expect(screen.getByText('Impostazioni')).toBeInTheDocument();
    expect(screen.queryByText('Utenti Backoffice')).not.toBeInTheDocument();
  });

  it('admin: il gruppo Impostazioni è aperto di default se la rotta corrente è una sua voce figlia', () => {
    mockUtente('admin');
    renderSidebar('/utenti');

    expect(screen.getByText('Utenti Backoffice')).toBeInTheDocument();
  });

  it('admin: click sul gruppo Impostazioni lo apre e mostra tutte le voci figlie', async () => {
    mockUtente('admin');
    renderSidebar('/control-room');

    await userEvent.click(screen.getByText('Impostazioni'));

    expect(screen.getByText('Parametri di Sistema')).toBeInTheDocument();
    expect(screen.getByText('OIDC (SPID/CIE)')).toBeInTheDocument();
    expect(screen.getByText('Utenti Backoffice')).toBeInTheDocument();
    expect(screen.getByText('Backup & Ripristino')).toBeInTheDocument();
    expect(screen.getByText('Stagioni')).toBeInTheDocument();
  });

  it('nessuna versione/stato fabbricati nella sidebar (v2.4.0/Engine Go: Connected non devono più esistere)', () => {
    mockUtente('admin');
    renderSidebar('/control-room');

    expect(screen.queryByText('v2.4.0')).not.toBeInTheDocument();
    expect(screen.queryByText(/engine go/i)).not.toBeInTheDocument();
  });
});
