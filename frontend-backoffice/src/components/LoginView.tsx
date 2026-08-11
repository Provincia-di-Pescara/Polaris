import React, { useState } from 'react';
import { Navigate } from 'react-router';
import { Landmark } from 'lucide-react';
import { useAuth, ErroreServizioNonRaggiungibile } from '../auth/AuthContext.tsx';

export function LoginView(): React.ReactElement {
  const { login, utente } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  if (utente) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      await login(email, password);
    } catch (err) {
      if (err instanceof ErroreServizioNonRaggiungibile) {
        setErrore('Servizio non raggiungibile, riprovare.');
      } else {
        setErrore('Credenziali non valide.');
      }
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
      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: 'var(--pa-card-bg)',
          borderRadius: '10px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          padding: '2.5rem',
          width: '360px',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
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
            <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Backoffice — Provincia di Pescara</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="login-email" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
            Email
          </label>
          <input
            id="login-email"
            type="email"
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="login-password" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
            Password
          </label>
          <input
            id="login-password"
            type="password"
            className="form-control"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {errore && (
          <div style={{
            backgroundColor: 'var(--pa-danger-bg)',
            color: 'var(--pa-danger)',
            padding: '0.6rem 0.85rem',
            borderRadius: '6px',
            fontSize: '0.85rem',
          }}>
            {errore}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={inCorso}>
          {inCorso ? 'Accesso in corso...' : 'Accedi'}
        </button>
      </form>
    </div>
  );
}
