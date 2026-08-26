import React, { useEffect, useState } from 'react';
import { Database, Info } from 'lucide-react';
import { leggiUrlAnagraficaScuole, salvaUrlAnagraficaScuole, ErroreRichiestaApi } from '../api/impiantiSpazi.ts';

// "Once only": punto unico per configurare le fonti di dati pubbliche usate
// dal backoffice per evitare di ritrascrivere a mano dati già pubblici
// altrove. Oggi solo l'anagrafica scuole del MIUR; a regime qui andranno
// anche integrazioni PDND e simili -- una card per fonte.
export const FonteDatiView: React.FC = () => {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [campoUrl, setCampoUrl] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggioSalvato, setMessaggioSalvato] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    leggiUrlAnagraficaScuole()
      .then((r) => {
        setUrl(r.url);
        setCampoUrl(r.url ?? '');
      })
      .catch((err) => setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare la configurazione.'));
  }, []);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setMessaggioSalvato(null);
    setInCorso(true);
    try {
      const salvato = await salvaUrlAnagraficaScuole(campoUrl);
      setUrl(salvato.url);
      setMessaggioSalvato('URL salvato.');
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Fonte Dati</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Sorgenti di dati pubblici usate dal backoffice per il principio "once only" (recupero dati già pubblici
          invece di ritrascriverli a mano).
        </p>
      </div>

      <div className="pa-card" style={{ backgroundColor: '#F0F7FF', borderLeft: '4px solid var(--pa-blue-primary)' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Info size={22} color="var(--pa-blue-primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '0.825rem', color: 'var(--pa-text-muted)' }}>
            In futuro qui verranno aggiunte altre integrazioni (es. PDND) — questa pagina raccoglie via via tutte
            le fonti dati esterne configurabili.
          </div>
        </div>
      </div>

      {errore && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {errore}
        </div>
      )}
      {messaggioSalvato && (
        <div style={{ backgroundColor: 'var(--pa-success-bg, #E8F8F0)', color: 'var(--pa-success, #1E8449)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {messaggioSalvato}
        </div>
      )}

      <div className="pa-card" style={{ maxWidth: '620px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'var(--pa-blue-dark)', marginBottom: '0.35rem' }}>
          <Database size={18} color="var(--pa-blue-primary)" />
          <span>Anagrafica Scuole (MIUR)</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', marginTop: 0, marginBottom: '0.85rem' }}>
          Dataset open data usato dalla ricerca "once only" nel form Istituzioni Scolastiche (nome e/o codice
          meccanografico). Il nome del file cambia ogni anno lato MIUR: aggiornare qui l'URL quando necessario.
        </p>

        {url === undefined ? (
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.85rem' }}>Caricamento…</p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label htmlFor="fonte-dati-anagrafica-scuole-url" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                URL anagrafica MIUR
              </label>
              <input
                id="fonte-dati-anagrafica-scuole-url"
                className="form-control"
                type="url"
                value={campoUrl}
                onChange={(e) => setCampoUrl(e.target.value)}
                placeholder="https://dati.istruzione.it/.../anagrafica.json"
                required
              />
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={inCorso}>
                {inCorso ? 'Salvataggio…' : 'Salva URL'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
