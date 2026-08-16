import React, { useEffect, useState } from 'react';
import { scambiaCallbackOidc } from '../api/auth.ts';

interface OidcCallbackViewProps {
  onCompletato: () => void;
}

export const OidcCallbackView: React.FC<OidcCallbackViewProps> = ({ onCompletato }) => {
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const erroreProvider = params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    if (erroreProvider) {
      setErrore(`Accesso negato dal provider: ${erroreProvider}`);
      return;
    }
    if (!code || !state) {
      setErrore('Risposta OIDC incompleta.');
      return;
    }

    scambiaCallbackOidc(code, state)
      .then(() => {
        window.history.replaceState({}, '', '/');
        onCompletato();
      })
      .catch((err: unknown) => {
        setErrore(err instanceof Error ? err.message : 'Autenticazione OIDC fallita, riprovare.');
      });
  }, [onCompletato]);

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--pa-bg-gray)',
      flexDirection: 'column',
      gap: '1rem',
    }}>
      {errore ? (
        <>
          <div style={{ color: 'var(--pa-danger)', fontWeight: 600 }}>{errore}</div>
          <a href="/">Torna alla pagina di accesso</a>
        </>
      ) : (
        <div>Completamento accesso in corso…</div>
      )}
    </div>
  );
};
