import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens } from '../api/client.ts';
import { AuthProvider } from '../auth/AuthContext.tsx';
import { ControlRoomView } from './ControlRoomView.tsx';

// Smoke test contro il backend reale (Finding 1 della final review — vedi
// commento in DelegheAccreditamentiView.realBackend.test.tsx per il razionale
// completo). Non invoca la coda motore Go reale (richiederebbe il servizio
// engine-go in esecuzione, fuori scope per uno smoke test): inserisce invece
// direttamente in Postgres una riga `elaborazioni` con `numero_round_eseguiti`
// noto, e verifica che GET /backoffice/stagioni/:id/elaborazioni la restituisca
// intatta fino al DOM — lo stesso percorso di lettura usato da ControlRoomView.
const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

function renderConStagione(stagioneId: string) {
  const router = createMemoryRouter([
    { path: '/', element: <Outlet context={stagioneId} />, children: [{ index: true, element: <ControlRoomView /> }] },
  ]);
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

descrivi('ControlRoomView (backend reale)', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];
  let pool: Pool;
  let stagioneId: string | null = null;
  let elaborazioneId: string | null = null;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    if (elaborazioneId) await pool.query('DELETE FROM elaborazioni WHERE id = $1', [elaborazioneId]);
    if (stagioneId) await pool.query('DELETE FROM stagioni_sportive WHERE id = $1', [stagioneId]);
    await pool.end();
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  it('carica lo storico elaborazioni reale e mostra il numero di round eseguiti (round-trip campo reale)', async () => {
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
    const rStagione = await apiFetch('/backoffice/stagioni', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: `Stagione Smoke ControlRoom ${suffisso}`, dataInizio: '2031-09-01', dataFine: '2032-06-30' }),
    });
    const stagione = (await rStagione.json()) as { id: string };
    stagioneId = stagione.id;

    const rVersione = await pool.query<{ id: string }>('SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1');
    const parametricoVersioneId = rVersione.rows[0]!.id;

    const numeroRoundAtteso = 7;
    const rElaborazione = await pool.query<{ id: string }>(
      `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato, numero_round_eseguiti, conclusa_il)
       VALUES ($1, 'prima_assegnazione', $2, 'completata', $3, now()) RETURNING id`,
      [stagioneId, parametricoVersioneId, numeroRoundAtteso],
    );
    elaborazioneId = rElaborazione.rows[0]!.id;

    renderConStagione(stagioneId);

    await waitFor(() => expect(screen.getByText(String(numeroRoundAtteso))).toBeInTheDocument(), { timeout: 15000 });
  }, 30000);
});
