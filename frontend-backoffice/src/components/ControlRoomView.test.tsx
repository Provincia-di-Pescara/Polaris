import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import * as api from '../api/motore.ts';
import { ControlRoomView } from './ControlRoomView.tsx';

// ControlRoomView legge il ruolo dell'utente da AuthContext (Finding 2 della final
// review: gli operatori vedevano 5 pulsanti azione admin-only che rispondevano 403
// a ogni click). Mock leggero invece di montare un vero AuthProvider — quest'ultimo
// farebbe una vera `apiFetch('/auth/me')` al mount, superflua per questi test che
// non hanno un backend reale in ascolto.
let ruoloUtenteMock: 'admin' | 'operatore' = 'admin';
vi.mock('../auth/AuthContext.tsx', () => ({
  useAuth: () => ({
    utente: { sub: 'utente-test', email: 'test@test.local', ruolo: ruoloUtenteMock },
    caricamento: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

afterEach(() => {
  ruoloUtenteMock = 'admin';
});

function renderConStagione(stagioneId: string) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={stagioneId} />,
      children: [{ index: true, element: <ControlRoomView /> }],
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('ControlRoomView', () => {
  it('carica le elaborazioni della stagione selezionata', async () => {
    vi.spyOn(api, 'listaElaborazioni').mockResolvedValue([
      {
        id: 'el-1',
        stagioneId: 'stag-1',
        tipo: 'istruttoria',
        parametricoVersioneId: null,
        iniziataIl: '2026-08-01T10:00:00.000Z',
        conclusaIl: '2026-08-01T10:00:05.000Z',
        stato: 'completata',
        numeroRoundEseguiti: null,
        logDettaglio: null,
      },
    ]);

    renderConStagione('stag-1');

    expect(await screen.findByText(/istruttoria/i)).toBeInTheDocument();
  });

  it('esegue istruttoria e mostra il risultato', async () => {
    vi.spyOn(api, 'listaElaborazioni').mockResolvedValue([]);
    const spy = vi.spyOn(api, 'eseguiIstruttoria').mockResolvedValue({ domandeCalcolate: 5 });

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /istruttoria/i }));

    expect(spy).toHaveBeenCalledWith('stag-1');
    expect(await screen.findByText(/5/)).toBeInTheDocument();
  });

  it('mostra l\'errore reale del backend (409 elaborazione in corso)', async () => {
    vi.spyOn(api, 'listaElaborazioni').mockResolvedValue([]);
    vi.spyOn(api, 'eseguiIstruttoria').mockRejectedValue(new api.ErroreRichiestaApi(409, 'elaborazione già in corso per questa stagione'));

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /istruttoria/i }));

    expect(await screen.findByText('elaborazione già in corso per questa stagione')).toBeInTheDocument();
  });

  it('nasconde le azioni di avanzamento algoritmico a un operatore (le 5 route POST sono admin-only)', async () => {
    ruoloUtenteMock = 'operatore';
    vi.spyOn(api, 'listaElaborazioni').mockResolvedValue([
      {
        id: 'el-1',
        stagioneId: 'stag-1',
        tipo: 'istruttoria',
        parametricoVersioneId: null,
        iniziataIl: '2026-08-01T10:00:00.000Z',
        conclusaIl: '2026-08-01T10:00:05.000Z',
        stato: 'completata',
        numeroRoundEseguiti: null,
        logDettaglio: null,
      },
    ]);

    renderConStagione('stag-1');

    // Lo storico elaborazioni (GET, admin+operatore) resta visibile...
    expect(await screen.findByText(/istruttoria/i)).toBeInTheDocument();
    // ...ma nessuno dei 5 pulsanti azione (POST, solo admin) è renderizzato.
    expect(screen.queryByRole('button', { name: /^istruttoria$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /blocchi gara/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prima assegnazione/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /riassegnazione residua/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approva definitiva/i })).not.toBeInTheDocument();
  });

  it('approva definitiva chiede conferma prima di chiamare approvaDefinitiva (azione irreversibile, Finding 7)', async () => {
    vi.spyOn(api, 'listaElaborazioni').mockResolvedValue([]);
    const approvaDefinitivaSpy = vi.spyOn(api, 'approvaDefinitiva').mockResolvedValue({ convenzioniCreate: 3, assegnazioniSenzaIstituzioneSaltate: 0 });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /approva definitiva/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(approvaDefinitivaSpy).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /approva definitiva/i }));
    expect(approvaDefinitivaSpy).toHaveBeenCalledWith('stag-1');
  });
});
