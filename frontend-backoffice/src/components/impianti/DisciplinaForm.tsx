import React, { useState } from 'react';
import { creaDisciplina, aggiornaDisciplina, type Disciplina, ErroreRichiestaApi } from '../../api/impiantiSpazi.ts';

interface DisciplinaFormProps {
  disciplinaEsistente?: Disciplina;
  onSalvata: (d: Disciplina) => void;
  onAnnulla: () => void;
}

export function DisciplinaForm({ disciplinaEsistente, onSalvata, onAnnulla }: DisciplinaFormProps): React.ReactElement {
  const [codice, setCodice] = useState(disciplinaEsistente?.codice ?? '');
  const [denominazione, setDenominazione] = useState(disciplinaEsistente?.denominazione ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      const risultato = disciplinaEsistente
        ? await aggiornaDisciplina(disciplinaEsistente.codice, denominazione)
        : await creaDisciplina({ codice, denominazione });
      onSalvata(risultato);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="disciplina-codice" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Codice
        </label>
        <input
          id="disciplina-codice"
          className="form-control"
          value={codice}
          onChange={(e) => setCodice(e.target.value)}
          disabled={!!disciplinaEsistente}
          required
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="disciplina-denominazione" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Denominazione
        </label>
        <input
          id="disciplina-denominazione"
          className="form-control"
          value={denominazione}
          onChange={(e) => setDenominazione(e.target.value)}
          required
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
