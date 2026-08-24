import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as utentiApi from '../api/utenti.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { UtentiView } from './UtentiView.tsx';
import type { UtenteBackoffice } from '../api/utenti.ts';

const ADMIN: UtenteBackoffice = {
  id: 'u1', email: 'admin@example.com', nome: 'Mario', cognome: 'Rossi', ruolo: 'admin', stato: 'attivo',
  creatoDa: null, creatoIl: '2026-01-01T10:00:00.000Z', ultimoAccessoIl: '2026-08-20T09:00:00.000Z',
};

const OPERATORE_INVITATO: UtenteBackoffice = {
  id: 'u2', email: 'operatore@example.com', nome: 'Anna', cognome: 'Bianchi', ruolo: 'operatore', stato: 'in_attesa_verifica',
  creatoDa: 'u1', creatoIl: '2026-08-20T10:00:00.000Z', ultimoAccessoIl: null,
};

function mockGlobalConfirm(risposta: boolean): void {
  vi.spyOn(window, 'confirm').mockReturnValue(risposta);
}

describe('UtentiView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(utentiApi, 'listaUtenti').mockResolvedValue([ADMIN, OPERATORE_INVITATO]);
  });

  it('elenca gli utenti con ruolo/stato/ultimo accesso', async () => {
    render(<UtentiView />);

    const rigaAdmin = (await screen.findByText('admin@example.com')).closest('tr')!;
    expect(within(rigaAdmin).getByText('admin')).toBeInTheDocument();
    expect(within(rigaAdmin).getByText('Attivo')).toBeInTheDocument();

    const rigaOperatore = screen.getByText('operatore@example.com').closest('tr')!;
    expect(within(rigaOperatore).getByText('operatore')).toBeInTheDocument();
    expect(within(rigaOperatore).getByText('Invito in attesa')).toBeInTheDocument();
  });

  it('nuovo utente: submit chiama creaUtente coi dati inseriti, poi ricarica', async () => {
    const spyCrea = vi.spyOn(utentiApi, 'creaUtente').mockResolvedValue({ ...OPERATORE_INVITATO, id: 'u3' });
    const spyLista = vi.spyOn(utentiApi, 'listaUtenti').mockResolvedValue([ADMIN, OPERATORE_INVITATO]);
    render(<UtentiView />);

    await screen.findByText('admin@example.com');
    await userEvent.click(screen.getByRole('button', { name: /nuovo utente/i }));
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'Luca');
    await userEvent.type(screen.getByLabelText(/^cognome$/i), 'Verdi');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'luca.verdi@example.com');
    await userEvent.selectOptions(screen.getByLabelText(/^ruolo$/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /crea e invia invito/i }));

    expect(spyCrea).toHaveBeenCalledWith({ email: 'luca.verdi@example.com', nome: 'Luca', cognome: 'Verdi', ruolo: 'admin' });
    expect(await screen.findByText(/email di invito inviata/i)).toBeInTheDocument();
    expect(spyLista).toHaveBeenCalledTimes(2);
  });

  it('nuovo utente: errore dal backend mostrato verbatim', async () => {
    vi.spyOn(utentiApi, 'creaUtente').mockRejectedValue(new ErroreRichiestaApi(503, 'SMTP non configurato (SMTP_HOST/BACKOFFICE_BASE_URL in .env)'));
    render(<UtentiView />);

    await screen.findByText('admin@example.com');
    await userEvent.click(screen.getByRole('button', { name: /nuovo utente/i }));
    await userEvent.type(screen.getByLabelText(/^nome$/i), 'Luca');
    await userEvent.type(screen.getByLabelText(/^cognome$/i), 'Verdi');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'luca.verdi@example.com');
    await userEvent.click(screen.getByRole('button', { name: /crea e invia invito/i }));

    expect(await screen.findByText(/SMTP non configurato/i)).toBeInTheDocument();
  });

  it('modifica: submit chiama aggiornaUtente con i campi editati', async () => {
    const spy = vi.spyOn(utentiApi, 'aggiornaUtente').mockResolvedValue({ ...ADMIN, nome: 'Mariangela' });
    render(<UtentiView />);

    const rigaAdmin = (await screen.findByText('admin@example.com')).closest('tr')!;
    await userEvent.click(within(rigaAdmin).getByRole('button', { name: /modifica/i }));

    const campoNome = screen.getByLabelText(/^nome$/i);
    await userEvent.clear(campoNome);
    await userEvent.type(campoNome, 'Mariangela');
    await userEvent.click(screen.getByRole('button', { name: /^salva$/i }));

    expect(spy).toHaveBeenCalledWith('u1', { nome: 'Mariangela', cognome: 'Rossi', ruolo: 'admin' });
  });

  it('disattiva: chiede conferma, se confermata chiama cambiaStatoUtente con "disattivato"', async () => {
    mockGlobalConfirm(true);
    const spy = vi.spyOn(utentiApi, 'cambiaStatoUtente').mockResolvedValue({ ...ADMIN, stato: 'disattivato' });
    render(<UtentiView />);

    const rigaAdmin = (await screen.findByText('admin@example.com')).closest('tr')!;
    await userEvent.click(within(rigaAdmin).getByRole('button', { name: /disattiva/i }));

    expect(spy).toHaveBeenCalledWith('u1', 'disattivato');
  });

  it('disattiva: se l\'utente annulla la conferma, non chiama l\'API', async () => {
    mockGlobalConfirm(false);
    const spy = vi.spyOn(utentiApi, 'cambiaStatoUtente');
    render(<UtentiView />);

    const rigaAdmin = (await screen.findByText('admin@example.com')).closest('tr')!;
    await userEvent.click(within(rigaAdmin).getByRole('button', { name: /disattiva/i }));

    expect(spy).not.toHaveBeenCalled();
  });

  it('riattiva: mostrata solo per utenti disattivati, chiama cambiaStatoUtente con "attivo"', async () => {
    vi.spyOn(utentiApi, 'listaUtenti').mockResolvedValue([{ ...ADMIN, stato: 'disattivato' }]);
    mockGlobalConfirm(true);
    const spy = vi.spyOn(utentiApi, 'cambiaStatoUtente').mockResolvedValue({ ...ADMIN, stato: 'attivo' });
    render(<UtentiView />);

    const riga = (await screen.findByText('admin@example.com')).closest('tr')!;
    await userEvent.click(within(riga).getByRole('button', { name: /riattiva/i }));

    expect(spy).toHaveBeenCalledWith('u1', 'attivo');
  });

  it('reset invito: chiede conferma, chiama richiediResetPassword', async () => {
    mockGlobalConfirm(true);
    const spy = vi.spyOn(utentiApi, 'richiediResetPassword').mockResolvedValue(ADMIN);
    render(<UtentiView />);

    const rigaAdmin = (await screen.findByText('admin@example.com')).closest('tr')!;
    await userEvent.click(within(rigaAdmin).getByRole('button', { name: /reset invito/i }));

    expect(spy).toHaveBeenCalledWith('u1');
    expect(await screen.findByText(/nuovo link inviato/i)).toBeInTheDocument();
  });
});
