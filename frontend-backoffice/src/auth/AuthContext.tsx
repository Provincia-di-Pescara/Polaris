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
    const r = await fetch(`${baseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      throw new Error('credenziali non valide');
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
