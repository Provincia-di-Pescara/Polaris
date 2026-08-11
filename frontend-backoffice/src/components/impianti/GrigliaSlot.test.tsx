import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GrigliaSlot } from './GrigliaSlot.tsx';

const SLOT = [
  {
    id: 'slot-1', stagioneId: 'stag-1', spazioId: 'spa-1', giornoSettimana: 1,
    orarioInizio: '18:00', orarioFine: '19:00', durataMinuti: 60, pregiata: true,
    indisponibilePermanente: false, note: null,
  },
];

describe('GrigliaSlot', () => {
  it('mostra ogni slot con giorno/orario, badge pregiata se pregiata', () => {
    render(<GrigliaSlot slot={SLOT} onClickSlot={() => {}} />);

    expect(screen.getByText(/18:00/)).toBeInTheDocument();
    expect(screen.getByText(/19:00/)).toBeInTheDocument();
    expect(screen.getByText(/pregiata/i)).toBeInTheDocument();
  });

  it('nessuno slot: mostra un messaggio, non un errore', () => {
    render(<GrigliaSlot slot={[]} onClickSlot={() => {}} />);
    expect(screen.getByText(/nessuno slot/i)).toBeInTheDocument();
  });

  it('click su uno slot chiama onClickSlot con lo slot corretto', async () => {
    const onClickSlot = vi.fn();
    render(<GrigliaSlot slot={SLOT} onClickSlot={onClickSlot} />);

    await userEvent.click(screen.getByText(/18:00/));

    expect(onClickSlot).toHaveBeenCalledWith(SLOT[0]);
  });
});
