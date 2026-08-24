import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as backupApi from '../api/backup.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { BackupView } from './BackupView.tsx';
import type { VoceBackup } from '../api/backup.ts';

const DAILY: VoceBackup = {
  nome: 'daily/polaris_db-20260824.dump',
  origine: 'schedulato',
  dimensioneByte: 2_500_000,
  creatoIl: '2026-08-24T03:00:00.000Z',
  formatoValido: true,
};

const MANUALE_NON_VALIDO: VoceBackup = {
  nome: 'manual/polaris-manuale-x.dump',
  origine: 'manuale',
  dimensioneByte: 100,
  creatoIl: '2026-08-23T10:00:00.000Z',
  formatoValido: false,
};

describe('BackupView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(backupApi, 'listaBackup').mockResolvedValue([DAILY, MANUALE_NON_VALIDO]);
  });

  it('elenca i backup con origine/dimensione/formato', async () => {
    render(<BackupView />);

    const rigaDaily = (await screen.findByText(DAILY.nome)).closest('tr')!;
    expect(within(rigaDaily).getByText('Schedulato')).toBeInTheDocument();
    expect(within(rigaDaily).getByText('Valido')).toBeInTheDocument();

    const rigaManuale = screen.getByText(MANUALE_NON_VALIDO.nome).closest('tr')!;
    expect(within(rigaManuale).getByText('Manuale')).toBeInTheDocument();
    expect(within(rigaManuale).getByText('Non valido')).toBeInTheDocument();
  });

  it('backup non valido: azioni scarica/ripristina disabilitate', async () => {
    render(<BackupView />);

    const rigaManuale = (await screen.findByText(MANUALE_NON_VALIDO.nome)).closest('tr')!;
    expect(within(rigaManuale).getByRole('button', { name: /scarica/i })).toBeDisabled();
    expect(within(rigaManuale).getByRole('button', { name: /ripristina/i })).toBeDisabled();
  });

  it('esegui backup ora: chiama eseguiBackupManuale, poi ricarica la lista', async () => {
    const spyEsegui = vi.spyOn(backupApi, 'eseguiBackupManuale').mockResolvedValue(DAILY);
    const spyLista = vi.spyOn(backupApi, 'listaBackup').mockResolvedValue([DAILY, MANUALE_NON_VALIDO]);
    render(<BackupView />);

    await screen.findByText(DAILY.nome);
    await userEvent.click(screen.getByRole('button', { name: /esegui backup ora/i }));

    expect(spyEsegui).toHaveBeenCalled();
    expect(await screen.findByText(/backup manuale completato/i)).toBeInTheDocument();
    expect(spyLista).toHaveBeenCalledTimes(2);
  });

  it('esegui backup ora: errore dal backend mostrato verbatim', async () => {
    vi.spyOn(backupApi, 'eseguiBackupManuale').mockRejectedValue(new ErroreRichiestaApi(500, 'pg_dump non disponibile'));
    render(<BackupView />);

    await screen.findByText(DAILY.nome);
    await userEvent.click(screen.getByRole('button', { name: /esegui backup ora/i }));

    expect(await screen.findByText(/pg_dump non disponibile/i)).toBeInTheDocument();
  });

  it('scarica: chiama scaricaBackup col nome del file', async () => {
    const spy = vi.spyOn(backupApi, 'scaricaBackup').mockResolvedValue(undefined);
    render(<BackupView />);

    const rigaDaily = (await screen.findByText(DAILY.nome)).closest('tr')!;
    await userEvent.click(within(rigaDaily).getByRole('button', { name: /scarica/i }));

    expect(spy).toHaveBeenCalledWith(DAILY.nome);
  });

  it('ripristina: apre il modale, carica le tabelle, il bottone conferma resta disabilitato finché non si digita RIPRISTINA', async () => {
    vi.spyOn(backupApi, 'elencoTabelle').mockResolvedValue(['associazioni', 'domande']);
    render(<BackupView />);

    const rigaDaily = (await screen.findByText(DAILY.nome)).closest('tr')!;
    await userEvent.click(within(rigaDaily).getByRole('button', { name: /ripristina/i }));

    expect(await screen.findByText('associazioni')).toBeInTheDocument();
    expect(screen.getByText('domande')).toBeInTheDocument();

    const form = screen.getByLabelText(/digita/i).closest('form')!;
    const bottoneInvio = within(form).getByRole('button', { name: /^ripristina$/i });
    expect(bottoneInvio).toBeDisabled();
  });

  it('ripristina: esclude le tabelle selezionate, chiama eseguiRipristino solo dopo la conferma testuale', async () => {
    vi.spyOn(backupApi, 'elencoTabelle').mockResolvedValue(['associazioni', 'domande']);
    const spy = vi.spyOn(backupApi, 'eseguiRipristino').mockResolvedValue({ tabelleRipristinate: ['associazioni'], tabelleEscluse: ['domande'] });
    render(<BackupView />);

    const rigaDaily = (await screen.findByText(DAILY.nome)).closest('tr')!;
    await userEvent.click(within(rigaDaily).getByRole('button', { name: /ripristina/i }));

    await screen.findByText('domande');
    await userEvent.click(screen.getByRole('checkbox', { name: /domande/i }));

    await userEvent.type(screen.getByLabelText(/digita/i), 'RIPRISTINA');

    const form = screen.getByLabelText(/digita/i).closest('form')!;
    const bottoneInvio = within(form).getByRole('button', { name: /^ripristina$/i });
    await userEvent.click(bottoneInvio);

    expect(spy).toHaveBeenCalledWith(DAILY.nome, ['domande']);
    expect(await screen.findByText(/ripristino completato/i)).toBeInTheDocument();
  });

  it('ripristina: senza digitare la conferma esatta, non chiama eseguiRipristino', async () => {
    vi.spyOn(backupApi, 'elencoTabelle').mockResolvedValue(['associazioni']);
    const spy = vi.spyOn(backupApi, 'eseguiRipristino');
    render(<BackupView />);

    const rigaDaily = (await screen.findByText(DAILY.nome)).closest('tr')!;
    await userEvent.click(within(rigaDaily).getByRole('button', { name: /ripristina/i }));

    await screen.findByText('associazioni');
    await userEvent.type(screen.getByLabelText(/digita/i), 'ripristina');

    const form = screen.getByLabelText(/digita/i).closest('form')!;
    const bottoneInvio = within(form).getByRole('button', { name: /^ripristina$/i });
    expect(bottoneInvio).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
  });
});
