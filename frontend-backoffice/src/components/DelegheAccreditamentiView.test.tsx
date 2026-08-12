import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api/deleghe.ts';
import { DelegheAccreditamentiView } from './DelegheAccreditamentiView.tsx';

const DELEGA_IN_ATTESA: api.AbilitazioneConDettagli = {
  id: 'del-1',
  personaFisicaId: 'pf-1',
  associazioneId: 'ass-1',
  istituzioneScolasticaId: null,
  stagioneId: 'stag-1',
  titolo: 'legale_rappresentante',
  ruolo: 'rappresentante',
  stato: 'in_attesa',
  motivazione: null,
  creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario',
  personaFisicaCognome: 'Rossi',
  personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test',
  associazioneCodiceFiscalePartitaIva: '01234567890',
};

describe('DelegheAccreditamentiView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listaDeleghe').mockResolvedValue([DELEGA_IN_ATTESA]);
    vi.spyOn(api, 'listaDocumenti').mockResolvedValue([]);
  });

  it('mostra le deleghe caricate dal backend', async () => {
    render(<DelegheAccreditamentiView />);
    expect(await screen.findByText('Rossi Mario')).toBeInTheDocument();
    expect(screen.getByText('ASD Test')).toBeInTheDocument();
  });

  it('approva chiama approvaDelega e ricarica la lista', async () => {
    const approvaSpy = vi.spyOn(api, 'approvaDelega').mockResolvedValue({ ...DELEGA_IN_ATTESA, stato: 'approvata' });
    render(<DelegheAccreditamentiView />);
    await screen.findByText('Rossi Mario');

    await userEvent.click(screen.getByRole('button', { name: /valuta delega/i }));
    await userEvent.click(screen.getByRole('button', { name: /approva delega/i }));

    expect(approvaSpy).toHaveBeenCalledWith('del-1');
  });

  it('respingi richiede una motivazione e chiama respingiDelega', async () => {
    const respingiSpy = vi.spyOn(api, 'respingiDelega').mockResolvedValue({ ...DELEGA_IN_ATTESA, stato: 'respinta' });
    render(<DelegheAccreditamentiView />);
    await screen.findByText('Rossi Mario');

    await userEvent.click(screen.getByRole('button', { name: /valuta delega/i }));
    await userEvent.type(screen.getByLabelText(/motivazione/i), 'documentazione incompleta');
    await userEvent.click(screen.getByRole('button', { name: /respingi delega/i }));

    expect(respingiSpy).toHaveBeenCalledWith('del-1', 'documentazione incompleta');
  });

  it('revoca chiede conferma prima di chiamare revocaDelega (azione irreversibile, Finding 7)', async () => {
    const revocaSpy = vi.spyOn(api, 'revocaDelega').mockResolvedValue([{ ...DELEGA_IN_ATTESA, stato: 'revocata' }]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DelegheAccreditamentiView />);
    await screen.findByText('Rossi Mario');

    await userEvent.click(screen.getByRole('button', { name: /valuta delega/i }));
    await userEvent.click(screen.getByRole('button', { name: /^revoca$/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(revocaSpy).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /^revoca$/i }));
    expect(revocaSpy).toHaveBeenCalledWith('del-1');
  });
});
