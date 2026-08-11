import React, { useState } from 'react';
import { creaImpianto, aggiornaImpianto, type Impianto, type Istituzione, type DatiImpianto, ErroreRichiestaApi } from '../../api/impiantiSpazi.ts';

interface ImpiantoFormProps {
  impiantoEsistente?: Impianto;
  istituzioni: Istituzione[];
  onSalvato: (i: Impianto) => void;
  onAnnulla: () => void;
}

export function ImpiantoForm({ impiantoEsistente, istituzioni, onSalvato, onAnnulla }: ImpiantoFormProps): React.ReactElement {
  const [denominazione, setDenominazione] = useState(impiantoEsistente?.denominazione ?? '');
  const [istituzioneScolasticaId, setIstituzioneScolasticaId] = useState(impiantoEsistente?.istituzioneScolasticaId ?? '');
  const [indirizzo, setIndirizzo] = useState(impiantoEsistente?.indirizzo ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      const dati: DatiImpianto = { denominazione };
      if (istituzioneScolasticaId) dati.istituzioneScolasticaId = istituzioneScolasticaId;
      if (indirizzo) dati.indirizzo = indirizzo;

      const risultato = impiantoEsistente
        ? await aggiornaImpianto(impiantoEsistente.id, dati)
        : await creaImpianto(dati);
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
        <label htmlFor="impianto-denominazione" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Denominazione
        </label>
        <input
          id="impianto-denominazione"
          className="form-control"
          value={denominazione}
          onChange={(e) => setDenominazione(e.target.value)}
          required
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="impianto-istituto" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Istituto scolastico titolare
        </label>
        <select
          id="impianto-istituto"
          className="form-control"
          value={istituzioneScolasticaId ?? ''}
          onChange={(e) => setIstituzioneScolasticaId(e.target.value)}
        >
          <option value="">— Nessuno —</option>
          {istituzioni.map((i) => (
            <option key={i.id} value={i.id}>
              {i.denominazione}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="impianto-indirizzo" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Indirizzo
        </label>
        <input
          id="impianto-indirizzo"
          className="form-control"
          value={indirizzo ?? ''}
          onChange={(e) => setIndirizzo(e.target.value)}
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
