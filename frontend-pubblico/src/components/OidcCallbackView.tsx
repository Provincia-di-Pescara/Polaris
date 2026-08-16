import React, { useEffect, useState } from 'react';
import { scambiaCallbackOidc } from '../api/auth.ts';

interface OidcCallbackViewProps {
  onCompletato: () => void;
}

export const OidcCallbackView: React.FC<OidcCallbackViewProps> = ({ onCompletato }) => {
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
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

    // In React.StrictMode (vedi main.tsx) l'effect viene invocato due volte in
    // sviluppo: la guardia "annullato" evita di agire due volte sull'esito, dato
    // che code+state sono monouso e la seconda POST riceve un 401 innocuo dal
    // backend (stato/code_verifier già consumati dalla prima chiamata) — stesso
    // pattern usato in AuthContext.tsx.
    scambiaCallbackOidc(code, state)
      .then(() => {
        if (annullato) return;
        window.history.replaceState({}, '', '/');
        onCompletato();
      })
      .catch((err: unknown) => {
        if (annullato) return;
        setErrore(err instanceof Error ? err.message : 'Autenticazione OIDC fallita, riprovare.');
      });

    return () => {
      annullato = true;
    };
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
