import React, { useState } from 'react';
import { creaSlot, aggiornaSlot, type Slot, ErroreRichiestaApi } from '../../api/impiantiSpazi.ts';

interface SlotFormProps {
  stagioneId: string;
  spazioId: string;
  slotEsistente?: Slot;
  onSalvato: (s: Slot) => void;
  onAnnulla: () => void;
}

const GIORNI = [
  { valore: 1, etichetta: 'Lunedì' },
  { valore: 2, etichetta: 'Martedì' },
  { valore: 3, etichetta: 'Mercoledì' },
  { valore: 4, etichetta: 'Giovedì' },
  { valore: 5, etichetta: 'Venerdì' },
  { valore: 6, etichetta: 'Sabato' },
  { valore: 7, etichetta: 'Domenica' },
];

// Stessa regex del backend (backend-node/src/backofficeSchema.ts) — un input
// come '9:00' (senza zero iniziale) è testo libero valido lessicograficamente
// ma non un HH:MM a due cifre: senza questo controllo il confronto
// orarioInizio >= orarioFine sotto lo tratterebbe come stringa e produrrebbe
// l'errore sbagliato ("inizio deve precedere fine") invece di un errore di
// formato.
const REGEX_ORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

export function SlotForm({ stagioneId, spazioId, slotEsistente, onSalvato, onAnnulla }: SlotFormProps): React.ReactElement {
  const [giornoSettimana, setGiornoSettimana] = useState(slotEsistente?.giornoSettimana ?? 1);
  const [orarioInizio, setOrarioInizio] = useState(slotEsistente?.orarioInizio ?? '');
  const [orarioFine, setOrarioFine] = useState(slotEsistente?.orarioFine ?? '');
  const [pregiata, setPregiata] = useState(slotEsistente?.pregiata ?? false);
  const [indisponibilePermanente, setIndisponibilePermanente] = useState(slotEsistente?.indisponibilePermanente ?? false);
  const [note, setNote] = useState(slotEsistente?.note ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);

    if (!REGEX_ORARIO.test(orarioInizio) || !REGEX_ORARIO.test(orarioFine)) {
      setErrore('Formato orario non valido, usa HH:MM.');
      return;
    }

    if (orarioInizio >= orarioFine) {
      setErrore('L\'ora di inizio deve precedere l\'ora di fine.');
      return;
    }

    setInCorso(true);
    try {
      const risultato = slotEsistente
        ? await aggiornaSlot(slotEsistente.id, {
            giornoSettimana, orarioInizio, orarioFine, pregiata, indisponibilePermanente,
            ...(note ? { note } : {}),
          })
        : await creaSlot({
            stagioneId, spazioId, giornoSettimana, orarioInizio, orarioFine, pregiata, indisponibilePermanente,
            ...(note ? { note } : {}),
          });
      onSalvato(risultato);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="slot-giorno" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Giorno della settimana
        </label>
        <select
          id="slot-giorno"
          className="form-control"
          value={giornoSettimana}
          onChange={(e) => setGiornoSettimana(Number(e.target.value))}
        >
          {GIORNI.map((g) => (
            <option key={g.valore} value={g.valore}>
              {g.etichetta}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
          <label htmlFor="slot-ora-inizio" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
            Ora inizio
          </label>
          <input
            id="slot-ora-inizio"
            className="form-control"
            placeholder="HH:MM"
            value={orarioInizio}
            onChange={(e) => setOrarioInizio(e.target.value)}
            required
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
          <label htmlFor="slot-ora-fine" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
            Ora fine
          </label>
          <input
            id="slot-ora-fine"
            className="form-control"
            placeholder="HH:MM"
            value={orarioFine}
            onChange={(e) => setOrarioFine(e.target.value)}
            required
          />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
        <input type="checkbox" checked={pregiata} onChange={(e) => setPregiata(e.target.checked)} />
        Fascia pregiata
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
        <input
          type="checkbox"
          checked={indisponibilePermanente}
          onChange={(e) => setIndisponibilePermanente(e.target.checked)}
        />
        Indisponibile permanentemente
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="slot-note" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Note
        </label>
        <textarea
          id="slot-note"
          className="form-control"
          value={note ?? ''}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      </div>

      {errore && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem' }}>
          {errore}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button type="submit" className="btn btn-primary" disabled={inCorso}>
          {inCorso ? 'Salvataggio...' : 'Salva'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onAnnulla}>
          Annulla
        </button>
      </div>
    </form>
  );
}
