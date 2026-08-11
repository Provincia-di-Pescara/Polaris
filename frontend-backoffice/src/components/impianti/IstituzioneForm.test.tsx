import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../api/impiantiSpazi.ts';
import { IstituzioneForm } from './IstituzioneForm.tsx';

describe('IstituzioneForm', () => {
  it('creazione: submit chiama creaIstituzione coi campi compilati', async () => {
    const istituzioneCreata = {
      id: 'ist-1', denominazione: 'Liceo Test', codiceMeccanografico: 'PEIS00100X', indirizzo: 'Via Roma 1',
    };
    const creaSpy = vi.spyOn(api, 'creaIstituzione').mockResolvedValue(istituzioneCreata);
    const onSalvata = vi.fn();

    render(<IstituzioneForm onSalvata={onSalvata} onAnnulla={() => {}} />);

    await userEvent.type(screen.getByLabelText(/denominazione/i), 'Liceo Test');
    await userEvent.type(screen.getByLabelText(/codice meccanografico/i), 'PEIS00100X');
    await userEvent.type(screen.getByLabelText(/indirizzo/i), 'Via Roma 1');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(creaSpy).toHaveBeenCalledWith({
      denominazione: 'Liceo Test',
      codiceMeccanografico: 'PEIS00100X',
      indirizzo: 'Via Roma 1',
    });
    expect(onSalvata).toHaveBeenCalledWith(istituzioneCreata);
  });

  it('creazione senza campi opzionali: non li invia', async () => {
    const creaSpy = vi.spyOn(api, 'creaIstituzione').mockResolvedValue({
      id: 'ist-2', denominazione: 'Solo Nome', codiceMeccanografico: null, indirizzo: null,
    });

    render(<IstituzioneForm onSalvata={() => {}} onAnnulla={() => {}} />);
    await userEvent.type(screen.getByLabelText(/denominazione/i), 'Solo Nome');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(creaSpy).toHaveBeenCalledWith({ denominazione: 'Solo Nome' });
  });

  it('modifica: precompila i campi esistenti', () => {
    render(
      <IstituzioneForm
        istituzioneEsistente={{ id: 'ist-1', denominazione: 'Liceo Test', codiceMeccanografico: 'PEIS00100X', indirizzo: null }}
        onSalvata={() => {}}
        onAnnulla={() => {}}
      />,
    );

    expect((screen.getByLabelText(/denominazione/i) as HTMLInputElement).value).toBe('Liceo Test');
    expect((screen.getByLabelText(/codice meccanografico/i) as HTMLInputElement).value).toBe('PEIS00100X');
  });
});
