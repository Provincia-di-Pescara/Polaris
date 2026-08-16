import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { leggiPersonaAutenticata, eseguiLogout, type PersonaAutenticata } from '../api/auth.ts';
import { listaEntitaRappresentate, type EntitaRappresentata } from '../api/deleghe.ts';
import { ErroreSessioneScaduta, rimuoviTokens } from '../api/client.ts';

interface AuthContextValue {
  persona: PersonaAutenticata | null;
  entities: EntitaRappresentata[];
  caricamento: boolean;
  ricarica: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function caricaSessione(): Promise<{ persona: PersonaAutenticata; entities: EntitaRappresentata[] } | null> {
  try {
    const persona = await leggiPersonaAutenticata();
    const entities = await listaEntitaRappresentate();
    return { persona, entities };
  } catch (err) {
    if (err instanceof ErroreSessioneScaduta) {
      return null;
    }
    // Nessun token presente: leggiPersonaAutenticata risponde 401, richiedi() lo
    // mappa in ErroreRichiestaApi (non ErroreSessioneScaduta, perché non c'è un
    // refresh token da tentare — vedi apiFetch in client.ts) — anche questo caso
    // equivale a "nessuna sessione".
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [persona, setPersona] = useState<PersonaAutenticata | null>(null);
  const [entities, setEntities] = useState<EntitaRappresentata[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [versione, setVersione] = useState(0);

  const ricarica = useCallback(() => setVersione((v) => v + 1), []);

  useEffect(() => {
    let annullato = false;
    setCaricamento(true);
    caricaSessione()
      .then((esito) => {
        if (annullato) return;
        setPersona(esito?.persona ?? null);
        setEntities(esito?.entities ?? []);
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });
    return () => {
      annullato = true;
    };
  }, [versione]);

  const logout = useCallback(async (): Promise<void> => {
    await eseguiLogout();
    setPersona(null);
    setEntities([]);
  }, []);

  return (
    <AuthContext.Provider value={{ persona, entities, caricamento, ricarica, logout }}>
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
