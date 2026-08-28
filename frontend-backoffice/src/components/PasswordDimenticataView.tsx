import React, { useState } from 'react';
import { Link } from 'react-router';
import { richiediPasswordDimenticata } from '../api/utenti.ts';
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

// Self-service: nessuna sessione richiesta. Il backend risponde sempre 200 con
// messaggio generico (no user enumeration) — questa view mostra sempre lo stesso
// esito di successo indipendentemente dal fatto che l'email esista o sia attiva.
export function PasswordDimenticataView(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [inviata, setInviata] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      await richiediPasswordDimenticata(email);
      setInviata(true);
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
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Recupero password backoffice</div>
        </div>

        {inviata && (
          <>
            <div>
              Se l'indirizzo <strong>{email}</strong> corrisponde a un account attivo, riceverà a breve
              un'email con le istruzioni per impostare una nuova password.
            </div>
            <Link to="/login" className="btn btn-primary" style={{ textAlign: 'center' }}>
              Torna al login
            </Link>
          </>
        )}

        {!inviata && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={STILE_CAMPO}>
              <label htmlFor="password-dimenticata-email" style={STILE_LABEL}>Email</label>
              <input
                id="password-dimenticata-email"
                type="email"
                className="form-control"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            {errore && <div style={STILE_ERRORE}>{errore}</div>}

            <button type="submit" className="btn btn-primary" disabled={inCorso}>
              {inCorso ? 'Invio in corso…' : 'Invia email di recupero'}
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
