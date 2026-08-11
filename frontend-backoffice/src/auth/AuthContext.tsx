import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, baseUrl, impostaTokens, rimuoviTokens, ErroreSessioneScaduta } from '../api/client.ts';

export interface Utente {
  sub: string;
  email: string;
  ruolo: 'admin' | 'operatore';
}

interface AuthContextValue {
  utente: Utente | null;
  caricamento: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Lanciato da login() quando il backend risponde ma rifiuta le credenziali (401).
export class ErroreCredenzialiNonValide extends Error {}

// Lanciato da login() quando il backend non risponde affatto (rete, DNS, servizio
// giù) o risponde con un errore diverso da 401 — distinto da ErroreCredenzialiNonValide
// perché il messaggio utente corretto è diverso ("riprova" vs "controlla le credenziali").
export class ErroreServizioNonRaggiungibile extends Error {}

async function chiediUtenteCorrente(): Promise<Utente | null> {
  try {
    const r = await apiFetch('/auth/me');
    if (!r.ok) {
      return null;
    }
    return (await r.json()) as Utente;
  } catch (err) {
    if (err instanceof ErroreSessioneScaduta) {
      return null;
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [utente, setUtente] = useState<Utente | null>(null);
  const [caricamento, setCaricamento] = useState(true);

  useEffect(() => {
    let annullato = false;
    chiediUtenteCorrente()
      .then((u) => {
        if (!annullato) {
          setUtente(u);
        }
      })
      .catch(() => {
        // Bootstrap non deve mai propagare un unhandled rejection: un errore di
        // rete (backend irraggiungibile) equivale a "nessuna sessione", non a un
        // crash dell'app — l'utente vedrà semplicemente la schermata di login.
        if (!annullato) {
          setUtente(null);
        }
      })
      .finally(() => {
        if (!annullato) {
          setCaricamento(false);
        }
      });
    return () => {
      annullato = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    let r: Response;
    try {
      r = await fetch(`${baseUrl()}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new ErroreServizioNonRaggiungibile('backend irraggiungibile');
    }
    if (r.status === 401) {
      throw new ErroreCredenzialiNonValide('credenziali non valide');
    }
    if (!r.ok) {
      throw new ErroreServizioNonRaggiungibile('risposta inattesa dal servizio di autenticazione');
    }
    const { accessToken, refreshToken } = await r.json();
    impostaTokens(accessToken, refreshToken);
    const u = await chiediUtenteCorrente();
    setUtente(u);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = localStorage.getItem('polaris_refresh_token');
    if (refreshToken) {
      try {
        await fetch(`${baseUrl()}/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // il logout locale deve riuscire comunque, anche se la revoca server-side fallisce
      }
    }
    rimuoviTokens();
    setUtente(null);
  }, []);

  return (
    <AuthContext.Provider value={{ utente, caricamento, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth deve essere usato dentro <AuthProvider>');
  }
  return ctx;
}
