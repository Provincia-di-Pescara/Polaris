import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api/impiantiSpazi.ts';
import { FonteDatiView } from './FonteDatiView.tsx';

describe('FonteDatiView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('mostra l\'URL già configurato', async () => {
    vi.spyOn(api, 'leggiUrlAnagraficaScuole').mockResolvedValue({ url: 'https://esempio.it/anagrafica.json' });

    render(<FonteDatiView />);

    expect(await screen.findByLabelText(/url anagrafica miur/i)).toHaveValue('https://esempio.it/anagrafica.json');
  });

  it('submit chiama salvaUrlAnagraficaScuole e mostra conferma', async () => {
    vi.spyOn(api, 'leggiUrlAnagraficaScuole').mockResolvedValue({ url: null });
    const salvaSpy = vi.spyOn(api, 'salvaUrlAnagraficaScuole').mockResolvedValue({ url: 'https://esempio.it/anagrafica.json' });

    render(<FonteDatiView />);

    const campoUrl = await screen.findByLabelText(/url anagrafica miur/i);
    await userEvent.type(campoUrl, 'https://esempio.it/anagrafica.json');
    await userEvent.click(screen.getByRole('button', { name: /salva url/i }));

    expect(salvaSpy).toHaveBeenCalledWith('https://esempio.it/anagrafica.json');
    expect(await screen.findByText(/url salvato/i)).toBeInTheDocument();
  });
});
