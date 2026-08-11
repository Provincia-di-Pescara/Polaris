import React from 'react';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { rimuoviTokens } from '../api/client.ts';
import { AuthProvider, useAuth, ErroreServizioNonRaggiungibile } from './AuthContext.tsx';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

function ComponenteDiTest() {
  const { utente, caricamento, login, logout } = useAuth();
  if (caricamento) return <div>caricamento...</div>;
  if (!utente) {
    return (
      <button
        onClick={() => {
          login('placeholder@test.local', 'placeholder').catch(() => {});
        }}
      >
        login-fallisce
      </button>
    );
  }
  return (
    <div>
      <span data-testid="email">{utente.email}</span>
      <span data-testid="ruolo">{utente.ruolo}</span>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

descrivi('AuthContext', () => {
  let backend: BackendReale;
  // Vedi client.test.ts per il motivo per cui la pulizia è per-utente (elimina())
  // invece di un DELETE per-pattern condiviso tra file di test in parallelo.
  const utentiCreati: UtenteTest[] = [];

  async function nuovoUtenteTest(ruolo: 'admin' | 'operatore'): Promise<UtenteTest> {
    const u = await creaUtenteTest(dsn!, ruolo);
    utentiCreati.push(u);
    return u;
  }

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  beforeEach(() => {
    rimuoviTokens();
    localStorage.clear();
  });

  it('login riuscito popola utente con email e ruolo reali', async () => {
    const utenteTest = await nuovoUtenteTest('operatore');

    function ComponenteLogin() {
      const { utente, caricamento, login } = useAuth();
      if (caricamento) return <div>caricamento...</div>;
      if (!utente) {
        return (
          <button onClick={() => login(utenteTest.email, utenteTest.password)}>entra</button>
        );
      }
      return (
        <div>
          <span data-testid="email">{utente.email}</span>
          <span data-testid="ruolo">{utente.ruolo}</span>
        </div>
      );
    }

    render(
      <AuthProvider>
        <ComponenteLogin />
      </AuthProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'entra' }));

    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent(utenteTest.email));
    expect(screen.getByTestId('ruolo')).toHaveTextContent('operatore');
  });

  it('login con credenziali sbagliate non popola utente (rimane null)', async () => {
    render(
      <AuthProvider>
        <ComponenteDiTest />
      </AuthProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'login-fallisce' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'login-fallisce' })).toBeInTheDocument();
    });
  });

  it('logout ripulisce utente e i token', async () => {
    const utenteTest = await nuovoUtenteTest('admin');

    function ComponenteConLogout() {
      const { utente, caricamento, login, logout } = useAuth();
      if (caricamento) return <div>caricamento...</div>;
      if (!utente) {
        return <button onClick={() => login(utenteTest.email, utenteTest.password)}>entra</button>;
      }
      return <button onClick={() => logout()}>esci</button>;
    }

    render(
      <AuthProvider>
        <ComponenteConLogout />
      </AuthProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'entra' }));
    await screen.findByRole('button', { name: 'esci' });

    await userEvent.click(screen.getByRole('button', { name: 'esci' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'entra' })).toBeInTheDocument());
    expect(localStorage.getItem('polaris_access_token')).toBeNull();
  });

  it('bootstrap: con un access token già valido in storage, popola utente senza un login esplicito', async () => {
    const utenteTest = await nuovoUtenteTest('admin');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utenteTest.email, password: utenteTest.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    localStorage.setItem('polaris_access_token', accessToken);
    localStorage.setItem('polaris_refresh_token', refreshToken);

    render(
      <AuthProvider>
        <ComponenteDiTest />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent(utenteTest.email));
  });

  it('login: backend irraggiungibile lancia ErroreServizioNonRaggiungibile (non un generico "credenziali non valide")', async () => {
    // Porta a cui nessun servizio è in ascolto in questo ambiente di test: la
    // fetch fallisce a livello di rete (non un 401), è il ramo che deve produrre
    // ErroreServizioNonRaggiungibile invece di ErroreCredenzialiNonValide.
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = 'http://127.0.0.1:1';
    try {
      function ComponenteLoginIrraggiungibile() {
        const { login } = useAuth();
        const [errore, setErrore] = React.useState<string | null>(null);
        return (
          <div>
            <button
              onClick={() => {
                login('x@test.local', 'x').catch((e) => setErrore(e.constructor.name));
              }}
            >
              entra
            </button>
            {errore && <span data-testid="errore">{errore}</span>}
          </div>
        );
      }

      render(
        <AuthProvider>
          <ComponenteLoginIrraggiungibile />
        </AuthProvider>,
      );

      await userEvent.click(await screen.findByRole('button', { name: 'entra' }));

      await waitFor(() =>
        expect(screen.getByTestId('errore')).toHaveTextContent(ErroreServizioNonRaggiungibile.name),
      );
    } finally {
      // @ts-expect-error -- ripristina l'URL reale per i test successivi
      globalThis.__API_BASE_URL__ = backend.baseUrl;
    }
  });

  it('bootstrap: backend irraggiungibile non genera unhandled rejection, utente resta null', async () => {
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = 'http://127.0.0.1:1';
    try {
      render(
        <AuthProvider>
          <ComponenteDiTest />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'login-fallisce' })).toBeInTheDocument();
      });
    } finally {
      // @ts-expect-error -- ripristina l'URL reale per i test successivi
      globalThis.__API_BASE_URL__ = backend.baseUrl;
    }
  });
});
