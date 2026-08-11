import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../api/impiantiSpazi.ts';
import { ImpiantoForm } from './ImpiantoForm.tsx';

const ISTITUZIONI = [
  { id: 'ist-1', denominazione: 'Liceo Uno', codiceMeccanografico: null, indirizzo: null },
  { id: 'ist-2', denominazione: 'Liceo Due', codiceMeccanografico: null, indirizzo: null },
];

describe('ImpiantoForm', () => {
  it('creazione: submit chiama creaImpianto con istituzioneScolasticaId selezionata', async () => {
    const impiantoCreato = { id: 'imp-1', denominazione: 'Palestra A', istituzioneScolasticaId: 'ist-2', indirizzo: null };
    const creaSpy = vi.spyOn(api, 'creaImpianto').mockResolvedValue(impiantoCreato);
    const onSalvato = vi.fn();

    render(<ImpiantoForm istituzioni={ISTITUZIONI} onSalvato={onSalvato} onAnnulla={() => {}} />);

    await userEvent.type(screen.getByLabelText(/denominazione/i), 'Palestra A');
    await userEvent.selectOptions(screen.getByLabelText(/istituto/i), 'ist-2');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(creaSpy).toHaveBeenCalledWith({ denominazione: 'Palestra A', istituzioneScolasticaId: 'ist-2' });
    expect(onSalvato).toHaveBeenCalledWith(impiantoCreato);
  });

  it('il select istituto elenca tutte le istituzioni passate', () => {
    render(<ImpiantoForm istituzioni={ISTITUZIONI} onSalvato={() => {}} onAnnulla={() => {}} />);

    expect(screen.getByRole('option', { name: 'Liceo Uno' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Liceo Due' })).toBeInTheDocument();
  });

  it('modifica: precompila denominazione/indirizzo/istituto esistenti', () => {
    render(
      <ImpiantoForm
        impiantoEsistente={{ id: 'imp-1', denominazione: 'Palestra A', istituzioneScolasticaId: 'ist-1', indirizzo: 'Via Test 1' }}
        istituzioni={ISTITUZIONI}
        onSalvato={() => {}}
        onAnnulla={() => {}}
      />,
    );

    expect((screen.getByLabelText(/denominazione/i) as HTMLInputElement).value).toBe('Palestra A');
    expect((screen.getByLabelText(/indirizzo/i) as HTMLInputElement).value).toBe('Via Test 1');
    expect((screen.getByLabelText(/istituto/i) as HTMLSelectElement).value).toBe('ist-1');
  });

  it('errore dal backend mostrato nel form', async () => {
    vi.spyOn(api, 'creaImpianto').mockRejectedValue(new api.ErroreRichiestaApi(400, 'denominazione obbligatoria'));

    render(<ImpiantoForm istituzioni={ISTITUZIONI} onSalvato={() => {}} onAnnulla={() => {}} />);
    await userEvent.type(screen.getByLabelText(/denominazione/i), 'X');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(await screen.findByText('denominazione obbligatoria')).toBeInTheDocument();
  });
});
