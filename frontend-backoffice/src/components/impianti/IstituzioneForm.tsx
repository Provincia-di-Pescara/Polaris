import React, { useState } from 'react';
import {
  creaIstituzione, aggiornaIstituzione, cercaAnagraficaScuole, leggiUrlAnagraficaScuole, salvaUrlAnagraficaScuole,
  type Istituzione, type DatiIstituzione, type ScuolaAnagrafica, ErroreRichiestaApi,
} from '../../api/impiantiSpazi.ts';
import { useAuth } from '../../auth/AuthContext.tsx';
import { Search } from 'lucide-react';

interface IstituzioneFormProps {
  istituzioneEsistente?: Istituzione;
  onSalvata: (i: Istituzione) => void;
  onAnnulla: () => void;
}

export function IstituzioneForm({ istituzioneEsistente, onSalvata, onAnnulla }: IstituzioneFormProps): React.ReactElement {
  const { utente } = useAuth();
  const [denominazione, setDenominazione] = useState(istituzioneEsistente?.denominazione ?? '');
  const [codiceMeccanografico, setCodiceMeccanografico] = useState(istituzioneEsistente?.codiceMeccanografico ?? '');
  const [indirizzo, setIndirizzo] = useState(istituzioneEsistente?.indirizzo ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  // "Once only": ricerca nell'anagrafica open data del MIUR per nome e/o codice
  // meccanografico invece di ritrascrivere a mano denominazione/indirizzo, già
  // pubblici altrove -- vedi anagraficaScuole.ts lato backend.
  const [ricercaQuery, setRicercaQuery] = useState('');
  const [risultatiRicerca, setRisultatiRicerca] = useState<ScuolaAnagrafica[] | null>(null);
  const [ricercaInCorso, setRicercaInCorso] = useState(false);
  const [erroreRicerca, setErroreRicerca] = useState<string | null>(null);
  const [anagraficaNonConfigurata, setAnagraficaNonConfigurata] = useState(false);
  const [urlAnagrafica, setUrlAnagrafica] = useState('');
  const [salvataggioUrlInCorso, setSalvataggioUrlInCorso] = useState(false);

  const handleCerca = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErroreRicerca(null);
    setAnagraficaNonConfigurata(false);
    setRicercaInCorso(true);
    try {
      const risultati = await cercaAnagraficaScuole(ricercaQuery);
      setRisultatiRicerca(risultati);
    } catch (err) {
      if (err instanceof ErroreRichiestaApi && err.status === 503) {
        setAnagraficaNonConfigurata(true);
      } else {
        setErroreRicerca(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante la ricerca.');
      }
    } finally {
      setRicercaInCorso(false);
    }
  };

  const handleSelezionaRisultato = (s: ScuolaAnagrafica): void => {
    setDenominazione(s.denominazione);
    setCodiceMeccanografico(s.codice);
    setIndirizzo([s.indirizzo, s.comune].filter(Boolean).join(', '));
    setRisultatiRicerca(null);
    setRicercaQuery('');
  };

  const handleSalvaUrlAnagrafica = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSalvataggioUrlInCorso(true);
    try {
      await salvaUrlAnagraficaScuole(urlAnagrafica);
      setAnagraficaNonConfigurata(false);
      setUrlAnagrafica('');
    } catch (err) {
      setErroreRicerca(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante il salvataggio.');
    } finally {
      setSalvataggioUrlInCorso(false);
    }
  };

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="pa-card" style={{ backgroundColor: '#F8FAFC', padding: '0.85rem' }}>
        <label htmlFor="istituzione-ricerca-anagrafica" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--pa-text-muted)', display: 'block', marginBottom: '0.35rem' }}>
          Cerca nell'anagrafica MIUR (nome e/o codice meccanografico)
        </label>
        <form onSubmit={handleCerca} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            id="istituzione-ricerca-anagrafica"
            className="form-control"
            value={ricercaQuery}
            onChange={(e) => setRicercaQuery(e.target.value)}
            placeholder="Es. Liceo Scientifico, PEIS00100X..."
            minLength={2}
          />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={ricercaInCorso || ricercaQuery.trim().length < 2}>
            <Search size={14} />
            <span>{ricercaInCorso ? 'Cerco…' : 'Cerca'}</span>
          </button>
        </form>

        {erroreRicerca && (
          <div style={{ marginTop: '0.5rem', color: 'var(--pa-danger)', fontSize: '0.8rem' }}>{erroreRicerca}</div>
        )}

        {anagraficaNonConfigurata && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <div style={{ color: 'var(--pa-danger)' }}>URL dell'anagrafica MIUR non ancora configurato.</div>
            {utente?.ruolo === 'admin' ? (
              <form onSubmit={handleSalvaUrlAnagrafica} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                <input
                  aria-label="URL anagrafica MIUR"
                  className="form-control"
                  type="url"
                  value={urlAnagrafica}
                  onChange={(e) => setUrlAnagrafica(e.target.value)}
                  placeholder="https://dati.istruzione.it/.../anagrafica.json"
                  required
                />
                <button type="submit" className="btn btn-secondary btn-sm" disabled={salvataggioUrlInCorso}>
                  {salvataggioUrlInCorso ? 'Salvo…' : 'Salva URL'}
                </button>
              </form>
            ) : (
              <div style={{ color: 'var(--pa-text-muted)' }}>Chiedi a un amministratore di configurarlo dalle Impostazioni.</div>
            )}
          </div>
        )}

        {risultatiRicerca && (
          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '180px', overflowY: 'auto' }}>
            {risultatiRicerca.length === 0 && (
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>Nessun risultato.</div>
            )}
            {risultatiRicerca.map((s) => (
              <button
                key={s.codice}
                type="button"
                onClick={() => handleSelezionaRisultato(s)}
                className="pa-card"
                style={{ textAlign: 'left', cursor: 'pointer', padding: '0.5rem 0.75rem', fontSize: '0.8rem', border: '1px solid var(--pa-border)' }}
              >
                <strong>{s.denominazione}</strong> ({s.codice}) — {s.comune}
              </button>
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
