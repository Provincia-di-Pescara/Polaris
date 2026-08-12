import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../api/parametrico.ts';
import { VersioneParametricaForm } from './VersioneParametricaForm.tsx';

const VERSIONE_ATTIVA: api.VersioneParametrica = {
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

describe('VersioneParametricaForm', () => {
  it('precompila i campi con la versione attiva', () => {
    render(<VersioneParametricaForm versioneAttuale={VERSIONE_ATTIVA} onSalvata={() => {}} onAnnulla={() => {}} />);
    expect((screen.getByLabelText(/moltiplicatore minuti/i) as HTMLInputElement).value).toBe('60.000');
    expect((screen.getByLabelText(/limite minuti settimanali/i) as HTMLInputElement).value).toBe('600.000');
  });

  it('submit chiama creaVersione con i valori del form', async () => {
    const nuovaVersione = { ...VERSIONE_ATTIVA, id: 'v-2' };
    const creaSpy = vi.spyOn(api, 'creaVersione').mockResolvedValue(nuovaVersione);
    const onSalvata = vi.fn();

    render(<VersioneParametricaForm versioneAttuale={VERSIONE_ATTIVA} onSalvata={onSalvata} onAnnulla={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /salva e pubblica/i }));

    expect(creaSpy).toHaveBeenCalled();
    expect(onSalvata).toHaveBeenCalledWith(nuovaVersione);
  });

  it('errore dal backend mostrato nel form', async () => {
    vi.spyOn(api, 'creaVersione').mockRejectedValue(new api.ErroreRichiestaApi(400, 'csdScaglioni non può essere vuoto'));
    render(<VersioneParametricaForm versioneAttuale={VERSIONE_ATTIVA} onSalvata={() => {}} onAnnulla={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /salva e pubblica/i }));
    expect(await screen.findByText('csdScaglioni non può essere vuoto')).toBeInTheDocument();
  });

  it('permette di aggiungere e rimuovere uno scaglione CSD', async () => {
    render(<VersioneParametricaForm versioneAttuale={VERSIONE_ATTIVA} onSalvata={() => {}} onAnnulla={() => {}} />);
    expect(screen.getAllByLabelText(/coefficiente scaglione/i)).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /aggiungi scaglione/i }));
    expect(screen.getAllByLabelText(/coefficiente scaglione/i)).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: /rimuovi scaglione/i })[0]!);
    expect(screen.getAllByLabelText(/coefficiente scaglione/i)).toHaveLength(1);
  });
});
