import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { verificaBootstrap } from '../api/bootstrap.ts';
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
  textAlign: 'center',
};

const STILE_ERRORE: React.CSSProperties = {
  backgroundColor: 'var(--pa-danger-bg)',
  color: 'var(--pa-danger)',
  padding: '0.6rem 0.85rem',
  borderRadius: '6px',
  fontSize: '0.85rem',
};

// Target del link di attivazione nell'email (hard-navigation da un client email,
// non solo click all'interno dell'app — ma qui, a differenza di /oidc/callback
// nel frontend pubblico, è comunque una rotta client-side react-router: il
// browser naviga a un URL reale, react-router la gestisce come qualunque altra).
export function BootstrapVerificaView(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [caricamento, setCaricamento] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setErrore('Link di attivazione non valido: token mancante.');
      setCaricamento(false);
      return;
    }
    let annullato = false;
    verificaBootstrap(token)
      .then((esito) => {
        if (annullato) return;
        setEmail(esito.email);
      })
      .catch((err) => {
        if (annullato) return;
        setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante la verifica.');
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });
    return () => {
      annullato = true;
    };
  }, [token]);

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--pa-bg-gray)',
    }}>
      <div style={STILE_CARD}>
        {caricamento && <div style={{ color: 'var(--pa-text-muted)' }}>Verifica in corso…</div>}

        {!caricamento && errore && (
          <>
            <div style={STILE_ERRORE}>{errore}</div>
            <Link to="/bootstrap" className="btn btn-secondary">Richiedi un nuovo link</Link>
          </>
        )}

        {!caricamento && !errore && email && (
          <>
            <div>
              Account <strong>{email}</strong> attivato con successo.
            </div>
            <Link to="/login" className="btn btn-primary">Vai al login</Link>
          </>
        )}
      </div>
    </div>
  );
}
