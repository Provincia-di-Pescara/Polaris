import React, { useEffect, useState } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { leggiConfigOidc, salvaConfigOidc, type ConfigOidc, type DatiSalvaConfigOidc, ErroreRichiestaApi } from '../api/impostazioniOidc.ts';

export const ImpostazioniOidcView: React.FC = () => {
  const [config, setConfig] = useState<ConfigOidc | null | undefined>(undefined);
  const [dati, setDati] = useState<DatiSalvaConfigOidc>({ issuer: '', clientId: '', redirectUri: '', clientSecret: undefined });
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggioSalvato, setMessaggioSalvato] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    leggiConfigOidc()
      .then((c) => {
        setConfig(c);
        if (c) {
          setDati({ issuer: c.issuer, clientId: c.clientId, redirectUri: c.redirectUri, clientSecret: undefined });
        }
      })
      .catch((err) => setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare la configurazione OIDC.'));
  }, []);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setMessaggioSalvato(null);
    setInCorso(true);
    try {
      const salvato = await salvaConfigOidc(dati);
      setConfig(salvato);
      setDati({ issuer: salvato.issuer, clientId: salvato.clientId, redirectUri: salvato.redirectUri, clientSecret: undefined });
      setMessaggioSalvato('Configurazione salvata.');
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  if (config === undefined) {
    return <div>Caricamento…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Impostazioni OIDC (SPID/CIE)</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Configurazione del proxy OIDC (pa-sso-proxy) usato dal frontend pubblico per l'autenticazione SPID/CIE/eIDAS.
        </p>
      </div>

      <div className="pa-card" style={{ backgroundColor: '#FEF9E7', borderLeft: '4px solid #F39C12' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Lock size={22} color="#D68910" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, color: '#B7950B' }}>Client Secret cifrato at-rest</div>
            <div style={{ fontSize: '0.825rem', color: '#7D6608', marginTop: '2px' }}>
              Il client secret non viene mai restituito in chiaro. Lascia il campo vuoto per mantenere il valore già salvato.
            </div>
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

      <form onSubmit={handleSubmit} className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '520px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-issuer" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Issuer</label>
          <input id="oidc-issuer" className="form-control" value={dati.issuer}
            onChange={(e) => setDati((p) => ({ ...p, issuer: e.target.value }))} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-client-id" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Client ID</label>
          <input id="oidc-client-id" className="form-control" value={dati.clientId}
            onChange={(e) => setDati((p) => ({ ...p, clientId: e.target.value }))} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-redirect-uri" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Redirect URI</label>
          <input id="oidc-redirect-uri" className="form-control" value={dati.redirectUri}
            onChange={(e) => setDati((p) => ({ ...p, redirectUri: e.target.value }))} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-client-secret" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            <KeyRound size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            Client Secret
          </label>
          <input id="oidc-client-secret" type="password" className="form-control" value={dati.clientSecret ?? ''}
            placeholder={config?.clientSecretConfigurato ? 'Invariato (lascia vuoto per non modificarlo)' : 'Obbligatorio al primo salvataggio'}
            onChange={(e) => setDati((p) => ({ ...p, clientSecret: e.target.value || undefined }))} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={inCorso}>
          {inCorso ? 'Salvataggio…' : 'Salva configurazione'}
        </button>
      </form>
    </div>
  );
};
