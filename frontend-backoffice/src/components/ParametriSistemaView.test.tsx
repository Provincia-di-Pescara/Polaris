import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as api from '../api/parametrico.ts';
import { ParametriSistemaView } from './ParametriSistemaView.tsx';
import type { VersioneParametrica, VersioneParametricaSintetica } from '../api/parametrico.ts';

const VERSIONE: VersioneParametrica = {
  id: 'v-1',
  validaDal: '2026-01-01T00:00:00.000Z',
  pubblicataDa: null,
  note: null,
  moltiplicatoreMinutiPerPunto: '60.000',
  pesoFasciaPregiata: '1.250',
  minutiSettimanaliMax: '600.000',
  slotMaxStessoImpianto: 4,
  fascePregiateMax: 2,
  giornateGaraMax: 1,
  incrementoSquadreNeutro: 0,
  caaNeutro: '1.000',
  csdNeutro: '1.000',
  tolleranzaIsfPct: '0.0050',
  sogliaMancatiUtilizziDiffida: 2,
  sogliaMancatiUtilizziDecadenza: 3,
  sogliaScostamentoDichiaratoPct: '0.2000',
  sogliaIsfCompensazione: '0.2000',
  retentionLogOperazioniGiorni: 30,
  quotaNuoveAssociazioniPct: '0.0000',
  termineGiustificazioneGiorni: 7,
  creataIl: '2026-01-01T00:00:00.000Z',
  csdScaglioni: [{ rapportoFdFrMin: '0', rapportoFdFrMax: null, coefficiente: '1.000' }],
};

const STORICO: VersioneParametricaSintetica[] = [{ id: 'v-1', validaDal: VERSIONE.validaDal, pubblicataDa: null, note: null }];

describe('ParametriSistemaView', () => {
  it('mostra la versione attiva e lo storico', async () => {
    vi.spyOn(api, 'leggiVersioneAttiva').mockResolvedValue(VERSIONE);
    vi.spyOn(api, 'listaVersioni').mockResolvedValue(STORICO);

    render(<ParametriSistemaView />);

    expect(await screen.findByText(/60\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Storico Versioni/i)).toBeInTheDocument();
  });

  it('errore di caricamento mostrato', async () => {
    vi.spyOn(api, 'leggiVersioneAttiva').mockRejectedValue(new api.ErroreRichiestaApi(404, 'nessuna versione parametrica trovata'));
    vi.spyOn(api, 'listaVersioni').mockResolvedValue([]);

    render(<ParametriSistemaView />);
    expect(await screen.findByText('nessuna versione parametrica trovata')).toBeInTheDocument();
  });
});
