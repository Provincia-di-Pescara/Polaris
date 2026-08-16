import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// Variante con stagione cambiabile a runtime (bottone di test), per verificare che
// il passaggio da una stagione all'altra non mostri i dati della vecchia stagione
// insieme all'indicatore di caricamento della nuova.
function renderConStagioneCambiabile(stagioneIniziale: string, prossimaStagioneId: string) {
  function Wrapper() {
    const [stagioneId, setStagioneId] = useState(stagioneIniziale);
    return (
      <>
        <button onClick={() => setStagioneId(prossimaStagioneId)}>Cambia stagione</button>
        <Outlet context={stagioneId} />
      </>
    );
  }
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Wrapper />,
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

  it('non mostra i dati della stagione precedente mentre carica la nuova stagione selezionata', async () => {
    let risolviSeconda: (v: apiStatistiche.StatisticheStagione) => void = () => {};
    const promessaSeconda = new Promise<apiStatistiche.StatisticheStagione>((resolve) => {
      risolviSeconda = resolve;
    });

    vi.spyOn(apiStatistiche, 'leggiStatisticheStagione').mockImplementation((stagioneId: string) => {
      if (stagioneId === 'stagione-1') {
        return Promise.resolve({
          tassoUtilizzoImpiantiPct: '0.667',
          fascePregiateAssegnatePct: '0.500',
          isfMedioAssociazioni: '0.600',
          sociAtletiCoinvolti: 19,
          distribuzioneMinutiPerDisciplina: [{ disciplinaCodice: 'VOLLEY', disciplinaDenominazione: 'Pallavolo', minuti: '60.000' }],
          saturazionePerImpianto: [{ impiantoId: 'imp-1', impiantoDenominazione: 'Palestra Test', tassoUtilizzoPct: '0.667' }],
        });
      }
      return promessaSeconda;
    });

    const utente = userEvent.setup();
    renderConStagioneCambiabile('stagione-1', 'stagione-2');

    await waitFor(() => expect(screen.getByText(/Pallavolo/)).toBeInTheDocument());

    await utente.click(screen.getByRole('button', { name: /cambia stagione/i }));

    expect(screen.getByText(/Caricamento statistiche/i)).toBeInTheDocument();
    expect(screen.queryByText(/Pallavolo/)).not.toBeInTheDocument();
    expect(screen.queryByText('66.7%')).not.toBeInTheDocument();

    risolviSeconda({
      tassoUtilizzoImpiantiPct: '0.250',
      fascePregiateAssegnatePct: '0.100',
      isfMedioAssociazioni: null,
      sociAtletiCoinvolti: 5,
      distribuzioneMinutiPerDisciplina: [],
      saturazionePerImpianto: [],
    });

    await waitFor(() => expect(screen.getByText('25.0%')).toBeInTheDocument());
  });
});
