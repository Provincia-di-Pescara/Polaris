import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { accettaInvito } from '../api/utenti.ts';
import { ErroreRichiestaApi } from '../api/client.ts';

const STILE_CARD: React.CSSProperties = {
  backgroundColor: 'var(--pa-card-bg)',
  borderRadius: '10px',
  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
  padding: '2.5rem',
  width: '380px',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
};

const STILE_CAMPO: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.35rem' };
const STILE_LABEL: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' };
const STILE_ERRORE: React.CSSProperties = {
  backgroundColor: 'var(--pa-danger-bg)',
  color: 'var(--pa-danger)',
  padding: '0.6rem 0.85rem',
  borderRadius: '6px',
  fontSize: '0.85rem',
};

// Target del link di invito/reset-password nell'email (hard-navigation da un
// client email) — rotta pubblica, nessuna sessione richiesta: il token one-shot
// nel link è l'unica autorizzazione.
export function AccettaInvitoView(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [conferma, setConferma] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [completato, setCompletato] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    if (password !== conferma) {
      setErrore('Le due password non coincidono.');
      return;
    }
    if (!token) {
      setErrore('Link non valido: token mancante.');
      return;
    }
    setInCorso(true);
    try {
      await accettaInvito({ token, password });
      setCompletato(true);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto, riprovare.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--pa-bg-gray)',
    }}>
      <div style={STILE_CARD}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.05em', color: 'var(--pa-blue-dark)' }}>POLARIS</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Attivazione account backoffice</div>
        </div>

        {!token && <div style={STILE_ERRORE}>Link non valido: token mancante.</div>}

        {token && completato && (
          <>
            <div>Password impostata con successo.</div>
            <Link to="/login" className="btn btn-primary" style={{ textAlign: 'center' }}>
              Vai al login
            </Link>
          </>
        )}

        {token && !completato && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={STILE_CAMPO}>
              <label htmlFor="invito-password" style={STILE_LABEL}>Password (minimo 12 caratteri)</label>
              <input
                id="invito-password"
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
            </div>
            <div style={STILE_CAMPO}>
              <label htmlFor="invito-conferma" style={STILE_LABEL}>Conferma password</label>
              <input
                id="invito-conferma"
                type="password"
                className="form-control"
                value={conferma}
                onChange={(e) => setConferma(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
            </div>

            {errore && <div style={STILE_ERRORE}>{errore}</div>}

            <button type="submit" className="btn btn-primary" disabled={inCorso}>
              {inCorso ? 'Attivazione in corso…' : 'Imposta password e attiva account'}
            </button>
            <Link to="/login" style={{ textAlign: 'center', fontSize: '0.85rem' }}>
              Torna al login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
