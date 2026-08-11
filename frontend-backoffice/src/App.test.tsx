import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from './auth/AuthContext.tsx';
import { routes } from './routes.tsx';
import { avviaBackendReale, type BackendReale } from './testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from './testUtil/creaUtenteTest.ts';
import { rimuoviTokens } from './api/client.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

// Stesso albero di route usato in produzione (App.tsx), montato su un router in
// memoria per poter controllare l'URL iniziale nei test senza un vero browser.
function renderApp(initialEntry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

descrivi('routing e2e (albero condiviso con App.tsx)', () => {
  let backend: BackendReale;
  // Vedi api/client.test.ts per il motivo della pulizia per-utente invece di un
  // DELETE per-pattern condiviso tra file di test in esecuzione parallela.
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

  it('un utente anonimo su /impianti-spazi viene reindirizzato a /login', async () => {
    renderApp('/impianti-spazi');

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });
  });

  it('dopo un login riuscito compare il layout autenticato (Sidebar con "Esci")', async () => {
    const utenteTest = await nuovoUtenteTest('operatore');
    renderApp('/login');

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/email/i), utenteTest.email);
    await userEvent.type(screen.getByLabelText(/password/i), utenteTest.password);
    await userEvent.click(screen.getByRole('button', { name: /accedi/i }));

    await waitFor(() => expect(screen.getByText('Esci')).toBeInTheDocument());
  });

  it('un utente già autenticato (token pre-impostati) che visita /login viene reindirizzato via, non vede il form', async () => {
    const utenteTest = await nuovoUtenteTest('admin');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utenteTest.email, password: utenteTest.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    localStorage.setItem('polaris_access_token', accessToken);
    localStorage.setItem('polaris_refresh_token', refreshToken);

    renderApp('/login');

    await waitFor(() => expect(screen.getByText('Esci')).toBeInTheDocument());
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it('un operatore viene reindirizzato via da /parametri-sistema (guardia di ruolo)', async () => {
    const utenteTest = await nuovoUtenteTest('operatore');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utenteTest.email, password: utenteTest.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    localStorage.setItem('polaris_access_token', accessToken);
    localStorage.setItem('polaris_refresh_token', refreshToken);

    renderApp('/parametri-sistema');

    // Reindirizzato a "/" (Control Room), non vede la voce "Parametri di Sistema"
    // nel contenuto principale — verificato tramite l'assenza del testo del titolo
    // di quella vista e la presenza del layout autenticato (Sidebar) su "/".
    await waitFor(() => expect(screen.getByText('Esci')).toBeInTheDocument());
    expect(screen.queryByText(/parametri di sistema/i)).not.toBeInTheDocument();
  });

  // Lo stato "caricamento" (placeholder mostrato prima che GET /auth/me risponda)
  // non è coperto qui: con un backend reale locale la risposta arriva quasi
  // istantaneamente, rendendo la finestra in cui asserire il placeholder una
  // race condition sul timing — instabile piuttosto che informativo. Il branch
  // "caricamento" resta comunque coperto indirettamente (ProtectedRoute.tsx lo
  // attraversa in ogni test sopra prima di stabilizzarsi).
});
