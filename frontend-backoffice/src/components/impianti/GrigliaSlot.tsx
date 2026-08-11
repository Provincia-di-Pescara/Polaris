import React from 'react';
import { Clock } from 'lucide-react';
import type { Slot } from '../../api/impiantiSpazi.ts';

interface GrigliaSlotProps {
  slot: Slot[];
  onClickSlot: (s: Slot) => void;
}

const NOMI_GIORNI: Record<number, string> = {
  1: 'Lunedì', 2: 'Martedì', 3: 'Mercoledì', 4: 'Giovedì', 5: 'Venerdì', 6: 'Sabato', 7: 'Domenica',
};

export function GrigliaSlot({ slot, onClickSlot }: GrigliaSlotProps): React.ReactElement {
  if (slot.length === 0) {
    return (
      <div style={{ color: 'var(--pa-text-muted)', fontStyle: 'italic', padding: '1rem' }}>
        Nessuno slot definito per questo spazio in questa stagione.
      </div>
    );
  }

  const slotOrdinati = [...slot].sort((a, b) => a.giornoSettimana - b.giornoSettimana || a.orarioInizio.localeCompare(b.orarioInizio));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {slotOrdinati.map((s) => (
        <div
          key={s.id}
          onClick={() => onClickSlot(s)}
          className="pa-card"
          style={{
            cursor: 'pointer',
            padding: '0.75rem 1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: s.indisponibilePermanente ? '#F8F9FA' : s.pregiata ? '#FEF9E7' : 'white',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Clock size={16} color="var(--pa-text-muted)" />
            <span style={{ fontWeight: 600, color: 'var(--pa-blue-dark)' }}>{NOMI_GIORNI[s.giornoSettimana]}</span>
            <span>{s.orarioInizio} - {s.orarioFine}</span>
            <span style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)' }}>{s.durataMinuti} min</span>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {s.pregiata && <span className="badge badge-warning" style={{ fontSize: '0.675rem' }}>Pregiata</span>}
            {s.indisponibilePermanente && <span className="badge badge-neutral" style={{ fontSize: '0.675rem' }}>Indisponibile</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
