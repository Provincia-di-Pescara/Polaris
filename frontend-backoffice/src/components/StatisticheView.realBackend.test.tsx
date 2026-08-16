import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '../auth/AuthContext.tsx';
import { routes } from '../routes.tsx';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens } from '../api/client.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

// Smoke test end-to-end (routing, outlet context stagione, fetch reale,
// render) contro backend + Postgres reali. Le regole di calcolo delle
// statistiche sono già coperte a fondo da statistiche.test.ts (Task 1) —
// qui verifichiamo solo che il cablaggio dell'intera catena funzioni,
// selezionando la stagione dall'Header come farebbe un utente reale.
descrivi('StatisticheView (backend reale)', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  function renderApp(initialEntry: string) {
    const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
    return render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
  }

  it("carica le statistiche reali della stagione selezionata nell'Header (round-trip Postgres->JSON->DOM)", async () => {
    const u = await creaUtenteTest(dsn!, 'admin');
    utentiCreati.push(u);
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);

    const suffisso = randomUUID().slice(0, 8);
    const stagioneRes = await apiFetch('/backoffice/stagioni', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: `Stagione statistiche smoke ${suffisso}`, dataInizio: '2036-09-01', dataFine: '2037-06-30' }),
    });
    const stagione = await stagioneRes.json();

    renderApp('/statistiche');

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument(), { timeout: 15000 });
    const selectStagione = screen.getByRole('combobox');
    await waitFor(
      () => expect(within(selectStagione).getByText(new RegExp(`Stagione statistiche smoke ${suffisso}`))).toBeInTheDocument(),
      { timeout: 15000 },
    );

    await userEvent.selectOptions(selectStagione, stagione.id);

    // Stagione appena creata, nessuna domanda -> sociAtletiCoinvolti reale = 0,
    // valore che deve attraversare Postgres->backend->frontend intatto.
    await waitFor(() => expect(screen.getByText('Soci & Atleti Coinvolti')).toBeInTheDocument(), { timeout: 15000 });
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument(), { timeout: 15000 });
  }, 30000);
});
