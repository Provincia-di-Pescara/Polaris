import React, { useState } from 'react';
import { creaSpazio, aggiornaSpazio, type SpazioSportivo, type Disciplina, ErroreRichiestaApi } from '../../api/impiantiSpazi.ts';

interface SpazioFormProps {
  impiantoId: string;
  spazioEsistente?: SpazioSportivo;
  discipline: Disciplina[];
  onSalvato: (s: SpazioSportivo) => void;
  onAnnulla: () => void;
}

export function SpazioForm({ impiantoId, spazioEsistente, discipline, onSalvato, onAnnulla }: SpazioFormProps): React.ReactElement {
  const [denominazione, setDenominazione] = useState(spazioEsistente?.denominazione ?? '');
  const [note, setNote] = useState(spazioEsistente?.note ?? '');
  const [disciplineSelezionate, setDisciplineSelezionate] = useState<string[]>(spazioEsistente?.disciplineCompatibili ?? []);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const toggleDisciplina = (codice: string): void => {
    setDisciplineSelezionate((prev) =>
      prev.includes(codice) ? prev.filter((c) => c !== codice) : [...prev, codice],
    );
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      const datiComuni = {
        denominazione,
        ...(note ? { note } : {}),
        ...(disciplineSelezionate.length > 0 ? { disciplineCompatibili: disciplineSelezionate } : {}),
      };

      const risultato = spazioEsistente
        ? await aggiornaSpazio(spazioEsistente.id, datiComuni)
        : await creaSpazio({ impiantoId, ...datiComuni });
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
        <label htmlFor="spazio-denominazione" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Denominazione
        </label>
        <input
          id="spazio-denominazione"
          className="form-control"
          value={denominazione}
          onChange={(e) => setDenominazione(e.target.value)}
          required
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="spazio-note" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Note
        </label>
        <textarea
          id="spazio-note"
          className="form-control"
          value={note ?? ''}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>Discipline compatibili</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {discipline.map((d) => (
            <label key={d.codice} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
              <input
                type="checkbox"
                checked={disciplineSelezionate.includes(d.codice)}
                onChange={() => toggleDisciplina(d.codice)}
              />
              {d.denominazione}
            </label>
          ))}
        </div>
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
