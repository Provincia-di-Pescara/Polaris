import React, { useEffect, useState } from 'react';
import { AlertTriangle, Copy, Check, KeyRound, Lock } from 'lucide-react';
import { leggiConfigOidc, salvaConfigOidc, type ConfigOidc, type DatiSalvaConfigOidc, ErroreRichiestaApi } from '../api/impostazioniOidc.ts';

export const ImpostazioniOidcView: React.FC = () => {
  const [config, setConfig] = useState<ConfigOidc | null | undefined>(undefined);
  const [dati, setDati] = useState<DatiSalvaConfigOidc>({ issuer: '', clientId: '', clientSecret: undefined });
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggioSalvato, setMessaggioSalvato] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [copiato, setCopiato] = useState(false);

  useEffect(() => {
    leggiConfigOidc()
      .then((c) => {
        setConfig(c);
        if (c) {
          setDati({ issuer: c.issuer, clientId: c.clientId, clientSecret: undefined });
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
      setDati({ issuer: salvato.issuer, clientId: salvato.clientId, clientSecret: undefined });
      setMessaggioSalvato('Configurazione salvata.');
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  const handleCopiaRedirectUri = async (): Promise<void> => {
    if (!config?.redirectUri) return;
    await navigator.clipboard.writeText(config.redirectUri);
    setCopiato(true);
    setTimeout(() => setCopiato(false), 2000);
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

      <div className="pa-card">
        <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>Redirect URI</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', marginTop: 0, marginBottom: '0.5rem' }}>
          Calcolato dal server (frontend pubblico + <code>/oidc/callback</code>), non editabile — incollalo nella
          registrazione del client lato IdP.
        </p>
        {config?.redirectUri ? (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input className="form-control" value={config.redirectUri} readOnly style={{ fontFamily: 'monospace' }} />
            <button type="button" className="btn btn-secondary" onClick={handleCopiaRedirectUri}>
              {copiato ? <Check size={16} /> : <Copy size={16} />}
              <span>{copiato ? 'Copiato' : 'Copia'}</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', color: 'var(--pa-danger)', fontSize: '0.85rem' }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <span>
              <code>FRONTEND_PUBBLICO_BASE_URL</code> non è impostata in questo ambiente: nessun redirect URI
              calcolabile, il login SPID/CIE pubblico non funzionerà finché non viene configurata a livello di deploy.
            </span>
          </div>
        )}
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

      {/*
        autoComplete="off" sul <form> non basta da solo contro i password manager
        (Chrome/Firefox lo ignorano per euristica su un form con un campo
        type="password" — vedono "issuer"/"redirectUri" come URL e ci compilano
        sopra credenziali salvate a caso). Fix per-campo: autoComplete="off" sui
        campi testo, "new-password" sul secret (unico valore che i browser
        rispettano davvero per sopprimere l'autofill su un campo password,
        trucco standard — "off" da solo su un password field è spesso ignorato).
      */}
      <form onSubmit={handleSubmit} className="pa-card" autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '520px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-issuer" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Issuer</label>
          <input id="oidc-issuer" className="form-control" autoComplete="off" value={dati.issuer}
            onChange={(e) => setDati((p) => ({ ...p, issuer: e.target.value }))} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-client-id" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Client ID</label>
          <input id="oidc-client-id" className="form-control" autoComplete="off" value={dati.clientId}
            onChange={(e) => setDati((p) => ({ ...p, clientId: e.target.value }))} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-client-secret" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            <KeyRound size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            Client Secret
          </label>
          <input id="oidc-client-secret" type="password" className="form-control" autoComplete="new-password" value={dati.clientSecret ?? ''}
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
