import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import * as apiStatistiche from '../api/statistiche.ts';
import { StatisticheView } from './StatisticheView.tsx';

// Stesso pattern di ControlRoomView.test.tsx::renderConStagione: useOutletContext
// richiede un Outlet reale, non un mock del hook.
function renderConStagione(stagioneId: string) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={stagioneId} />,
      children: [{ index: true, element: <StatisticheView /> }],
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('StatisticheView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mostra il messaggio di selezione stagione se nessuna stagione è selezionata', () => {
    renderConStagione('');
    expect(screen.getByText(/seleziona una stagione/i)).toBeInTheDocument();
  });

  it('carica e mostra le statistiche quando una stagione è selezionata', async () => {
    vi.spyOn(apiStatistiche, 'leggiStatisticheStagione').mockResolvedValue({
      tassoUtilizzoImpiantiPct: '0.667',
      fascePregiateAssegnatePct: '0.500',
      isfMedioAssociazioni: '0.600',
      sociAtletiCoinvolti: 19,
      distribuzioneMinutiPerDisciplina: [{ disciplinaCodice: 'VOLLEY', disciplinaDenominazione: 'Pallavolo', minuti: '60.000' }],
      saturazionePerImpianto: [{ impiantoId: 'imp-1', impiantoDenominazione: 'Palestra Test', tassoUtilizzoPct: '0.667' }],
    });

    renderConStagione('stagione-1');

    await waitFor(() => expect(screen.getByText('66.7%')).toBeInTheDocument());
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText(/Pallavolo/)).toBeInTheDocument();
    expect(screen.getByText(/Palestra Test/)).toBeInTheDocument();
  });

  it('mostra un messaggio di errore se il caricamento fallisce', async () => {
    vi.spyOn(apiStatistiche, 'leggiStatisticheStagione').mockRejectedValue(
      new apiStatistiche.ErroreRichiestaApi(500, 'errore interno'),
    );

    renderConStagione('stagione-1');

    await waitFor(() => expect(screen.getByText('errore interno')).toBeInTheDocument());
  });
});
