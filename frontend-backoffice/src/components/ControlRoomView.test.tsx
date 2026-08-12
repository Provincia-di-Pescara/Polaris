import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import * as api from '../api/motore.ts';
import { ControlRoomView } from './ControlRoomView.tsx';

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
});
