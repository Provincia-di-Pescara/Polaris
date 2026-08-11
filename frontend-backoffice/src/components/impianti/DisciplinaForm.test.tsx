import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../api/impiantiSpazi.ts';
import { DisciplinaForm } from './DisciplinaForm.tsx';

describe('DisciplinaForm', () => {
  it('creazione: submit chiama creaDisciplina con codice e denominazione, poi onSalvata', async () => {
    const disciplinaCreata = { codice: 'VOLLEY', denominazione: 'Pallavolo' };
    const creaSpy = vi.spyOn(api, 'creaDisciplina').mockResolvedValue(disciplinaCreata);
    const onSalvata = vi.fn();

    render(<DisciplinaForm onSalvata={onSalvata} onAnnulla={() => {}} />);

    await userEvent.type(screen.getByLabelText(/codice/i), 'VOLLEY');
    await userEvent.type(screen.getByLabelText(/denominazione/i), 'Pallavolo');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(creaSpy).toHaveBeenCalledWith({ codice: 'VOLLEY', denominazione: 'Pallavolo' });
    expect(onSalvata).toHaveBeenCalledWith(disciplinaCreata);
  });

  it('modifica: precompila i campi, submit chiama aggiornaDisciplina, campo codice disabilitato', async () => {
    const aggiornaSpy = vi
      .spyOn(api, 'aggiornaDisciplina')
      .mockResolvedValue({ codice: 'VOLLEY', denominazione: 'Pallavolo Modificata' });
    const onSalvata = vi.fn();

    render(
      <DisciplinaForm
        disciplinaEsistente={{ codice: 'VOLLEY', denominazione: 'Pallavolo' }}
        onSalvata={onSalvata}
        onAnnulla={() => {}}
      />,
    );

    const campoCodice = screen.getByLabelText(/codice/i) as HTMLInputElement;
    expect(campoCodice.value).toBe('VOLLEY');
    expect(campoCodice).toBeDisabled();

    const campoDenominazione = screen.getByLabelText(/denominazione/i);
    await userEvent.clear(campoDenominazione);
    await userEvent.type(campoDenominazione, 'Pallavolo Modificata');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(aggiornaSpy).toHaveBeenCalledWith('VOLLEY', 'Pallavolo Modificata');
    expect(onSalvata).toHaveBeenCalled();
  });

  it('errore dal backend (409) mostrato nel form', async () => {
    vi.spyOn(api, 'creaDisciplina').mockRejectedValue(new api.ErroreRichiestaApi(409, 'codice già esistente'));

    render(<DisciplinaForm onSalvata={() => {}} onAnnulla={() => {}} />);

    await userEvent.type(screen.getByLabelText(/codice/i), 'VOLLEY');
    await userEvent.type(screen.getByLabelText(/denominazione/i), 'Pallavolo');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(await screen.findByText('codice già esistente')).toBeInTheDocument();
  });
});
