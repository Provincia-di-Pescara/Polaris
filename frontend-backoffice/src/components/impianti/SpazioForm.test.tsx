import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../api/impiantiSpazi.ts';
import { SpazioForm } from './SpazioForm.tsx';

const DISCIPLINE = [
  { codice: 'VOLLEY', denominazione: 'Pallavolo' },
  { codice: 'BASKET', denominazione: 'Pallacanestro' },
];

describe('SpazioForm', () => {
  it('creazione: submit chiama creaSpazio con impiantoId, denominazione, disciplineCompatibili selezionate', async () => {
    const spazioCreato = {
      id: 'spa-1', impiantoId: 'imp-1', denominazione: 'Campo A', omologazioni: [], note: null, disciplineCompatibili: ['VOLLEY'],
    };
    const creaSpy = vi.spyOn(api, 'creaSpazio').mockResolvedValue(spazioCreato);
    const onSalvato = vi.fn();

    render(<SpazioForm impiantoId="imp-1" discipline={DISCIPLINE} onSalvato={onSalvato} onAnnulla={() => {}} />);

    await userEvent.type(screen.getByLabelText(/denominazione/i), 'Campo A');
    await userEvent.click(screen.getByLabelText(/pallavolo/i));
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(creaSpy).toHaveBeenCalledWith({
      impiantoId: 'imp-1',
      denominazione: 'Campo A',
      disciplineCompatibili: ['VOLLEY'],
    });
    expect(onSalvato).toHaveBeenCalledWith(spazioCreato);
  });

  it('modifica: precompila denominazione/note/discipline compatibili esistenti', () => {
    render(
      <SpazioForm
        impiantoId="imp-1"
        spazioEsistente={{
          id: 'spa-1', impiantoId: 'imp-1', denominazione: 'Campo A', omologazioni: [], note: 'Nota test', disciplineCompatibili: ['BASKET'],
        }}
        discipline={DISCIPLINE}
        onSalvato={() => {}}
        onAnnulla={() => {}}
      />,
    );

    expect((screen.getByLabelText(/denominazione/i) as HTMLInputElement).value).toBe('Campo A');
    expect((screen.getByLabelText(/note/i) as HTMLTextAreaElement).value).toBe('Nota test');
    expect((screen.getByLabelText(/pallacanestro/i) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/pallavolo/i) as HTMLInputElement).checked).toBe(false);
  });

  it('tetto sulle discipline renderizzate: quelle già selezionate restano visibili anche oltre il taglio', () => {
    // Regressione: il Postgres di sviluppo condiviso ha accumulato migliaia di
    // discipline fixture — renderizzare un checkbox per ognuna rende il form
    // inutilizzabile, quindi la lista è tagliata a 50. Un taglio naive
    // (discipline.filter(...).slice(0,50) senza dare priorità alle già
    // selezionate) avrebbe fatto sparire dalla vista — pur restando selezionata
    // nello stato — una disciplina già assegnata allo spazio se capitava oltre
    // la posizione 50 nell'elenco originale.
    const moltissime = Array.from({ length: 60 }, (_, i) => ({ codice: `D${i}`, denominazione: `Disciplina ${i}` }));
    const fuoriDalTaglio = { codice: 'FUORI-TAGLIO', denominazione: 'Disciplina Fuori Dal Taglio' };
    const discipline = [...moltissime, fuoriDalTaglio]; // posizione 60, oltre il tetto di 50

    render(
      <SpazioForm
        impiantoId="imp-1"
        spazioEsistente={{
          id: 'spa-1', impiantoId: 'imp-1', denominazione: 'Campo A', omologazioni: [], note: null,
          disciplineCompatibili: ['FUORI-TAGLIO'],
        }}
        discipline={discipline}
        onSalvato={() => {}}
        onAnnulla={() => {}}
      />,
    );

    const checkbox = screen.getByLabelText(/fuori dal taglio/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('errore dal backend mostrato nel form', async () => {
    vi.spyOn(api, 'creaSpazio').mockRejectedValue(new api.ErroreRichiestaApi(400, 'denominazione obbligatoria'));

    render(<SpazioForm impiantoId="imp-1" discipline={DISCIPLINE} onSalvato={() => {}} onAnnulla={() => {}} />);
    await userEvent.type(screen.getByLabelText(/denominazione/i), 'X');
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    expect(await screen.findByText('denominazione obbligatoria')).toBeInTheDocument();
  });
});
