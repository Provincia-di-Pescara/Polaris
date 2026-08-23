import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Landmark } from 'lucide-react';
import { statoBootstrap, richiediPrimoAdmin } from '../api/bootstrap.ts';
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

export function BootstrapView(): React.ReactElement {
  const [caricamentoStato, setCaricamentoStato] = useState(true);
  const [disponibile, setDisponibile] = useState(false);
  const [erroreStato, setErroreStato] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nome, setNome] = useState('');
  const [cognome, setCognome] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [inviata, setInviata] = useState(false);

  useEffect(() => {
    let annullato = false;
    statoBootstrap()
      .then((s) => {
        if (annullato) return;
        setDisponibile(s.disponibile);
      })
      .catch((err) => {
        if (annullato) return;
        setErroreStato(err instanceof ErroreRichiestaApi ? err.message : 'Servizio non raggiungibile.');
      })
      .finally(() => {
        if (!annullato) setCaricamentoStato(false);
      });
    return () => {
      annullato = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      await richiediPrimoAdmin({ email, password, nome, cognome });
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #00C5CA 0%, #0066CC 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Landmark size={24} color="white" />
          </div>
          <div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.05em', color: 'var(--pa-blue-dark)' }}>POLARIS</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Configurazione primo amministratore</div>
          </div>
        </div>

        {caricamentoStato && <div style={{ color: 'var(--pa-text-muted)' }}>Verifica in corso…</div>}

        {!caricamentoStato && erroreStato && <div style={STILE_ERRORE}>{erroreStato}</div>}

        {!caricamentoStato && !erroreStato && !disponibile && (
          <>
            <div>Esiste già un account amministratore configurato.</div>
            <Link to="/login" className="btn btn-primary" style={{ textAlign: 'center' }}>
              Vai al login
            </Link>
          </>
        )}

        {!caricamentoStato && !erroreStato && disponibile && inviata && (
          <>
            <div>
              Richiesta inviata: controlla la casella <strong>{email}</strong> per il link di attivazione
              dell'account.
            </div>
            <Link to="/login" className="btn btn-secondary" style={{ textAlign: 'center' }}>
              Vai al login
            </Link>
          </>
        )}

        {!caricamentoStato && !erroreStato && disponibile && !inviata && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={STILE_CAMPO}>
              <label htmlFor="bootstrap-nome" style={STILE_LABEL}>Nome</label>
              <input id="bootstrap-nome" className="form-control" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </div>
            <div style={STILE_CAMPO}>
              <label htmlFor="bootstrap-cognome" style={STILE_LABEL}>Cognome</label>
              <input id="bootstrap-cognome" className="form-control" value={cognome} onChange={(e) => setCognome(e.target.value)} required />
            </div>
            <div style={STILE_CAMPO}>
              <label htmlFor="bootstrap-email" style={STILE_LABEL}>Email</label>
              <input
                id="bootstrap-email"
                type="email"
                className="form-control"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div style={STILE_CAMPO}>
              <label htmlFor="bootstrap-password" style={STILE_LABEL}>Password (minimo 12 caratteri)</label>
              <input
                id="bootstrap-password"
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
            </div>

            {errore && <div style={STILE_ERRORE}>{errore}</div>}

            <button type="submit" className="btn btn-primary" disabled={inCorso}>
              {inCorso ? 'Invio in corso…' : 'Crea account e invia email di attivazione'}
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
