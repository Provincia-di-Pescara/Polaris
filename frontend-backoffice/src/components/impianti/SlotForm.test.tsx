import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../api/impiantiSpazi.ts';
import { SlotForm } from './SlotForm.tsx';

describe('SlotForm', () => {
  it('creazione: submit chiama creaSlot con i campi compilati', async () => {
    const slotCreato = {
      id: 'slot-1', stagioneId: 'stag-1', spazioId: 'spa-1', giornoSettimana: 1,
      orarioInizio: '18:00', orarioFine: '19:00', durataMinuti: 60, pregiata: true,
      indisponibilePermanente: false, note: null,
    };
    const creaSpy = vi.spyOn(api, 'creaSlot').mockResolvedValue(slotCreato);
    const onSalvato = vi.fn();

    render(<SlotForm stagioneId="stag-1" spazioId="spa-1" onSalvato={onSalvato} onAnnulla={() => {}} />);

    await userEvent.selectOptions(screen.getByLabelText(/giorno/i), '1');
    await userEvent.type(screen.getByLabelText(/ora inizio/i), '18:00');
    await userEvent.type(screen.getByLabelText(/ora fine/i), '19:00');
    await userEvent.click(screen.getByLabelText(/fascia pregiata/i));
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(creaSpy).toHaveBeenCalledWith({
      stagioneId: 'stag-1',
      spazioId: 'spa-1',
      giornoSettimana: 1,
      orarioInizio: '18:00',
      orarioFine: '19:00',
      pregiata: true,
      indisponibilePermanente: false,
    });
    expect(onSalvato).toHaveBeenCalledWith(slotCreato);
  });

  it('modifica: precompila i campi esistenti', () => {
    render(
      <SlotForm
        stagioneId="stag-1"
        spazioId="spa-1"
        slotEsistente={{
          id: 'slot-1', stagioneId: 'stag-1', spazioId: 'spa-1', giornoSettimana: 3,
          orarioInizio: '17:00', orarioFine: '18:30', durataMinuti: 90, pregiata: false,
          indisponibilePermanente: true, note: 'manutenzione',
        }}
        onSalvato={() => {}}
        onAnnulla={() => {}}
      />,
    );

    expect((screen.getByLabelText(/giorno/i) as HTMLSelectElement).value).toBe('3');
    expect((screen.getByLabelText(/ora inizio/i) as HTMLInputElement).value).toBe('17:00');
    expect((screen.getByLabelText(/indisponibile/i) as HTMLInputElement).checked).toBe(true);
  });

  it('orario non valido (fine prima di inizio): mostra errore senza chiamare l\'API', async () => {
    const creaSpy = vi.spyOn(api, 'creaSlot');

    render(<SlotForm stagioneId="stag-1" spazioId="spa-1" onSalvato={() => {}} onAnnulla={() => {}} />);

    await userEvent.selectOptions(screen.getByLabelText(/giorno/i), '1');
    await userEvent.type(screen.getByLabelText(/ora inizio/i), '19:00');
    await userEvent.type(screen.getByLabelText(/ora fine/i), '18:00');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(await screen.findByText(/deve precedere/i)).toBeInTheDocument();
    expect(creaSpy).not.toHaveBeenCalled();
  });

  it('orario senza zero iniziale (es. "9:00"): mostra errore di formato, non chiama l\'API', async () => {
    // Regressione: '9:00' >= '10:00' è true in confronto lessicografico di stringhe
    // (non numerico), quindi senza una validazione di formato esplicita PRIMA del
    // confronto orarioInizio>=orarioFine, un utente che scrive 9:00->10:00 vedeva
    // l'errore sbagliato ("l'ora di inizio deve precedere l'ora di fine") invece di
    // un errore di formato — pur avendo inserito un intervallo valido.
    const creaSpy = vi.spyOn(api, 'creaSlot');

    render(<SlotForm stagioneId="stag-1" spazioId="spa-1" onSalvato={() => {}} onAnnulla={() => {}} />);

    await userEvent.selectOptions(screen.getByLabelText(/giorno/i), '1');
    await userEvent.type(screen.getByLabelText(/ora inizio/i), '9:00');
    await userEvent.type(screen.getByLabelText(/ora fine/i), '10:00');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(await screen.findByText(/formato orario non valido/i)).toBeInTheDocument();
    expect(creaSpy).not.toHaveBeenCalled();
  });

  it('errore dal backend (409, sovrapposizione) mostrato nel form', async () => {
    vi.spyOn(api, 'creaSlot').mockRejectedValue(new api.ErroreRichiestaApi(409, 'slot sovrapposto a uno esistente'));

    render(<SlotForm stagioneId="stag-1" spazioId="spa-1" onSalvato={() => {}} onAnnulla={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText(/giorno/i), '1');
    await userEvent.type(screen.getByLabelText(/ora inizio/i), '18:00');
    await userEvent.type(screen.getByLabelText(/ora fine/i), '19:00');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(await screen.findByText('slot sovrapposto a uno esistente')).toBeInTheDocument();
  });
});
