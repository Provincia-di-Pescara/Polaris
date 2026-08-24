import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api/stagioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { StagioniView } from './StagioniView.tsx';
import type { Stagione } from '../api/stagioni.ts';

const IN_CENSIMENTO: Stagione = {
  id: 's1', nome: 'Stagione 2030/2031', dataInizio: '2030-09-01', dataFine: '2031-06-30', stato: 'censimento',
};

const IN_DEFINITIVA: Stagione = {
  id: 's2', nome: 'Stagione 2029/2030', dataInizio: '2029-09-01', dataFine: '2030-06-30', stato: 'definitiva',
};

describe('StagioniView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listaStagioni').mockResolvedValue([IN_CENSIMENTO, IN_DEFINITIVA]);
  });

  it('elenca le stagioni con stato', async () => {
    render(<StagioniView />);

    const rigaCensimento = (await screen.findByText('Stagione 2030/2031')).closest('tr')!;
    expect(within(rigaCensimento).getByText('Censimento')).toBeInTheDocument();

    const rigaDefinitiva = screen.getByText('Stagione 2029/2030').closest('tr')!;
    expect(within(rigaDefinitiva).getByText('Definitiva')).toBeInTheDocument();
  });

  it('modifica/elimina disabilitate fuori da "censimento"', async () => {
    render(<StagioniView />);

    const rigaDefinitiva = (await screen.findByText('Stagione 2029/2030')).closest('tr')!;
    expect(within(rigaDefinitiva).getByRole('button', { name: /modifica/i })).toBeDisabled();
    expect(within(rigaDefinitiva).getByRole('button', { name: /elimina/i })).toBeDisabled();

    const rigaCensimento = screen.getByText('Stagione 2030/2031').closest('tr')!;
    expect(within(rigaCensimento).getByRole('button', { name: /modifica/i })).not.toBeDisabled();
    expect(within(rigaCensimento).getByRole('button', { name: /elimina/i })).not.toBeDisabled();
  });

  it('crea una nuova stagione: submit chiama creaStagione, poi ricarica', async () => {
    const spyCrea = vi.spyOn(api, 'creaStagione').mockResolvedValue({ ...IN_CENSIMENTO, id: 's3', nome: 'Nuova' });
    const spyLista = vi.spyOn(api, 'listaStagioni').mockResolvedValue([IN_CENSIMENTO, IN_DEFINITIVA]);
    render(<StagioniView />);

    await screen.findByText('Stagione 2030/2031');
    await userEvent.click(screen.getByRole('button', { name: /nuova stagione/i }));
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'Nuova');
    await userEvent.type(screen.getByLabelText(/data inizio/i), '2032-09-01');
    await userEvent.type(screen.getByLabelText(/data fine/i), '2033-06-30');
    await userEvent.click(screen.getByRole('button', { name: /^crea$/i }));

    expect(spyCrea).toHaveBeenCalledWith({ nome: 'Nuova', dataInizio: '2032-09-01', dataFine: '2033-06-30' });
    expect(await screen.findByText(/stagione creata/i)).toBeInTheDocument();
    expect(spyLista).toHaveBeenCalledTimes(2);
  });

  it('modifica: submit chiama aggiornaStagione coi nuovi valori', async () => {
    const spy = vi.spyOn(api, 'aggiornaStagione').mockResolvedValue({ ...IN_CENSIMENTO, nome: 'Rinominata' });
    render(<StagioniView />);

    const riga = (await screen.findByText('Stagione 2030/2031')).closest('tr')!;
    await userEvent.click(within(riga).getByRole('button', { name: /modifica/i }));

    const campoNome = screen.getByLabelText(/^nome$/i);
    await userEvent.clear(campoNome);
    await userEvent.type(campoNome, 'Rinominata');
    await userEvent.click(screen.getByRole('button', { name: /^salva$/i }));

    expect(spy).toHaveBeenCalledWith('s1', { nome: 'Rinominata', dataInizio: '2030-09-01', dataFine: '2031-06-30' });
  });

  it('modifica: 409 dal backend mostrato verbatim', async () => {
    vi.spyOn(api, 'aggiornaStagione').mockRejectedValue(new ErroreRichiestaApi(409, 'la stagione ha già dati collegati'));
    render(<StagioniView />);

    const riga = (await screen.findByText('Stagione 2030/2031')).closest('tr')!;
    await userEvent.click(within(riga).getByRole('button', { name: /modifica/i }));
    await userEvent.click(screen.getByRole('button', { name: /^salva$/i }));

    expect(await screen.findByText(/la stagione ha già dati collegati/i)).toBeInTheDocument();
  });

  it('elimina: chiede conferma, se confermata chiama eliminaStagione', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const spy = vi.spyOn(api, 'eliminaStagione').mockResolvedValue(undefined);
    render(<StagioniView />);

    const riga = (await screen.findByText('Stagione 2030/2031')).closest('tr')!;
    await userEvent.click(within(riga).getByRole('button', { name: /elimina/i }));

    expect(spy).toHaveBeenCalledWith('s1');
    expect(await screen.findByText(/stagione eliminata/i)).toBeInTheDocument();
  });

  it('elimina: se l\'utente annulla la conferma, non chiama l\'API', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const spy = vi.spyOn(api, 'eliminaStagione');
    render(<StagioniView />);

    const riga = (await screen.findByText('Stagione 2030/2031')).closest('tr')!;
    await userEvent.click(within(riga).getByRole('button', { name: /elimina/i }));

    expect(spy).not.toHaveBeenCalled();
  });
});
