import React, { useState } from 'react';
import { creaIstituzione, aggiornaIstituzione, type Istituzione, type DatiIstituzione, ErroreRichiestaApi } from '../../api/impiantiSpazi.ts';

interface IstituzioneFormProps {
  istituzioneEsistente?: Istituzione;
  onSalvata: (i: Istituzione) => void;
  onAnnulla: () => void;
}

export function IstituzioneForm({ istituzioneEsistente, onSalvata, onAnnulla }: IstituzioneFormProps): React.ReactElement {
  const [denominazione, setDenominazione] = useState(istituzioneEsistente?.denominazione ?? '');
  const [codiceMeccanografico, setCodiceMeccanografico] = useState(istituzioneEsistente?.codiceMeccanografico ?? '');
  const [indirizzo, setIndirizzo] = useState(istituzioneEsistente?.indirizzo ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      const dati: DatiIstituzione = { denominazione };
      if (codiceMeccanografico) dati.codiceMeccanografico = codiceMeccanografico;
      if (indirizzo) dati.indirizzo = indirizzo;

      const risultato = istituzioneEsistente
        ? await aggiornaIstituzione(istituzioneEsistente.id, dati)
        : await creaIstituzione(dati);
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
        <label htmlFor="istituzione-denominazione" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Denominazione
        </label>
        <input
          id="istituzione-denominazione"
          className="form-control"
          value={denominazione}
          onChange={(e) => setDenominazione(e.target.value)}
          required
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="istituzione-codice-meccanografico" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Codice meccanografico
        </label>
        <input
          id="istituzione-codice-meccanografico"
          className="form-control"
          value={codiceMeccanografico ?? ''}
          onChange={(e) => setCodiceMeccanografico(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="istituzione-indirizzo" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Indirizzo
        </label>
        <input
          id="istituzione-indirizzo"
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
