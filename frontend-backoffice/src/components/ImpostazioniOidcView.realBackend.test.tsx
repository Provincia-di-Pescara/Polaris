import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Pool } from 'pg';
import { AuthProvider } from '../auth/AuthContext.tsx';
import { routes } from '../routes.tsx';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { impostaTokens, rimuoviTokens } from '../api/client.ts';

// Smoke test end-to-end contro backend + Postgres reali (stesso pattern di
// StatisticheView.realBackend.test.tsx/ParametriSistemaView.realBackend.test.tsx):
// verifica il cablaggio reale (routing, guardia di ruolo, fetch autenticata,
// cifratura at-rest del client secret) — non le regole di validazione dello
// schema Zod, già coperte da backofficeSchema.test.ts lato backend.
const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('ImpostazioniOidcView (backend reale)', () => {
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
    // impostazioni_sistema.aggiornata_da referenzia utenti_backoffice SENZA
    // ON DELETE CASCADE/SET NULL (stesso pattern di log_operazioni/
    // tentativi_login_backoffice, vedi commento in creaUtenteTest.ts) — il test
    // "admin" qui sopra salva una configurazione OIDC attribuita all'utente di
    // test, quindi va scollegata esplicitamente prima di poterlo eliminare.
    const pool = new Pool({ connectionString: dsn });
    try {
      for (const u of utentiCreati) {
        await pool.query(
          `UPDATE impostazioni_sistema SET aggiornata_da = NULL
           WHERE aggiornata_da = (SELECT id FROM utenti_backoffice WHERE email = $1)`,
          [u.email],
        );
      }
    } finally {
      await pool.end();
    }
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  async function loginCome(ruolo: 'admin' | 'operatore'): Promise<void> {
    const u = await creaUtenteTest(dsn!, ruolo);
    utentiCreati.push(u);
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);
  }

  function renderApp(initialEntry: string) {
    const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
    return render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
  }

  it('admin: configura per la prima volta, poi ricaricando la view il client secret risulta invariato', async () => {
    await loginCome('admin');

    renderApp('/impostazioni-oidc');

    // DB di sviluppo condiviso: una configurazione OIDC precedente (di questo
    // stesso task o di altre suite, es. oidc-spid-cie) potrebbe già essere
    // salvata. La view la precompila (comportamento corretto) — i campi vanno
    // quindi svuotati esplicitamente prima di digitare il nuovo valore, invece
    // di assumere che partano vuoti.
    // Timeout più larghi del solito (DB di sviluppo condiviso con molte
    // stagioni accumulate da run precedenti: la select dell'Header nell'
    // outlet BackofficeLayout può rallentare sotto contesa — stesso fenomeno
    // già documentato per ImpiantiSpaziView, "flaky sotto contesa").
    const issuer = await screen.findByLabelText(/issuer/i, {}, { timeout: 20000 });
    await userEvent.clear(issuer);
    await userEvent.type(issuer, 'https://mock-idp.test');
    const clientId = screen.getByLabelText(/client id/i);
    await userEvent.clear(clientId);
    await userEvent.type(clientId, 'client-e2e');
    // redirectUri non è più un campo del form: è calcolato server-side da
    // FRONTEND_PUBBLICO_BASE_URL (non impostata per questo backend di test),
    // mostrato in sola lettura -- niente da compilare qui.
    await userEvent.type(screen.getByLabelText(/client secret/i), 'secret-e2e-test');

    await userEvent.click(screen.getByRole('button', { name: /salva configurazione/i }));

    await waitFor(() => expect(screen.getByText(/configurazione salvata/i)).toBeInTheDocument(), { timeout: 20000 });

    // Ricarica la view (nuovo render, come una navigazione fresca): la GET
    // successiva deve restituire clientSecretConfigurato=true, quindi il
    // placeholder del campo secret deve mostrare "Invariato", mai il valore
    // in chiaro appena salvato (round-trip cifratura at-rest verificato).
    renderApp('/impostazioni-oidc');
    await waitFor(
      () => expect(screen.getAllByPlaceholderText(/invariato/i).length).toBeGreaterThan(0),
      { timeout: 20000 },
    );
    const issuerRicaricato = screen.getAllByLabelText(/issuer/i).at(-1);
    expect(issuerRicaricato).toHaveValue('https://mock-idp.test');
  }, 60000);

  it('operatore: la guardia di ruolo nega l\'accesso e reindirizza a "/"', async () => {
    await loginCome('operatore');

    renderApp('/impostazioni-oidc');

    // ProtectedRoute ruoliAmmessi={['admin']} reindirizza un operatore a "/"
    // (Navigate replace), che renderizza ControlRoomView invece del form OIDC.
    await waitFor(
      () => expect(screen.getByText(/control room procedura/i)).toBeInTheDocument(),
      { timeout: 15000 },
    );
    expect(screen.queryByText(/impostazioni oidc/i)).not.toBeInTheDocument();
  }, 30000);
});
