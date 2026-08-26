import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../api/impiantiSpazi.ts';
import { ErroreRichiestaApi } from '../../api/client.ts';
import { IstituzioneForm } from './IstituzioneForm.tsx';

describe('IstituzioneForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creazione: submit chiama creaIstituzione coi campi compilati', async () => {
    const istituzioneCreata = {
      id: 'ist-1', denominazione: 'Liceo Test', codiceMeccanografico: 'PEIS00100X', indirizzo: 'Via Roma 1',
    };
    const creaSpy = vi.spyOn(api, 'creaIstituzione').mockResolvedValue(istituzioneCreata);
    const onSalvata = vi.fn();

    render(<IstituzioneForm onSalvata={onSalvata} onAnnulla={() => {}} />);

    await userEvent.type(screen.getByLabelText(/^denominazione$/i), 'Liceo Test');
    await userEvent.type(screen.getByLabelText(/^codice meccanografico$/i), 'PEIS00100X');
    await userEvent.type(screen.getByLabelText(/^indirizzo$/i), 'Via Roma 1');
    await userEvent.click(screen.getByRole('button', { name: /^salva$/i }));

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
    await userEvent.type(screen.getByLabelText(/^denominazione$/i), 'Solo Nome');
    await userEvent.click(screen.getByRole('button', { name: /^salva$/i }));

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

    expect((screen.getByLabelText(/^denominazione$/i) as HTMLInputElement).value).toBe('Liceo Test');
    expect((screen.getByLabelText(/^codice meccanografico$/i) as HTMLInputElement).value).toBe('PEIS00100X');
  });

  it('ricerca anagrafica: trova risultati, il click ne compila i campi', async () => {
    const spy = vi.spyOn(api, 'cercaAnagraficaScuole').mockResolvedValue([
      { codice: 'PEIS00100X', denominazione: 'IIS Trovato', comune: 'PESCARA', indirizzo: 'Via Napoli 2' },
    ]);

    render(<IstituzioneForm onSalvata={() => {}} onAnnulla={() => {}} />);

    await userEvent.type(screen.getByLabelText(/cerca nell'anagrafica miur/i), 'trovato');
    await userEvent.click(screen.getByRole('button', { name: /^cerca$/i }));

    expect(spy).toHaveBeenCalledWith('trovato');
    const risultato = await screen.findByRole('button', { name: /IIS Trovato \(PEIS00100X\) — PESCARA/i });
    await userEvent.click(risultato);

    expect((screen.getByLabelText(/^denominazione$/i) as HTMLInputElement).value).toBe('IIS Trovato');
    expect((screen.getByLabelText(/^codice meccanografico$/i) as HTMLInputElement).value).toBe('PEIS00100X');
    expect((screen.getByLabelText(/^indirizzo$/i) as HTMLInputElement).value).toBe('Via Napoli 2, PESCARA');
  });

  it('ricerca anagrafica: 503 (URL non configurato), rimanda a Impostazioni → Fonte Dati', async () => {
    vi.spyOn(api, 'cercaAnagraficaScuole').mockRejectedValue(new ErroreRichiestaApi(503, 'URL non configurato'));

    render(<IstituzioneForm onSalvata={() => {}} onAnnulla={() => {}} />);
    await userEvent.type(screen.getByLabelText(/cerca nell'anagrafica miur/i), 'qualcosa');
    await userEvent.click(screen.getByRole('button', { name: /^cerca$/i }));

    expect(await screen.findByText(/fonte dati/i)).toBeInTheDocument();
  });
});
