import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens } from '../api/client.ts';
import { registraOperazione } from '../../../backend-node/src/repository/logOperazioni.ts';
import { AuditSorteggioView } from './AuditSorteggioView.tsx';

// Smoke test contro il backend reale (Finding 1 della final review — vedi
// commento in DelegheAccreditamentiView.realBackend.test.tsx per il razionale
// completo). Copre entrambi i gruppi di endpoint usati da questa vista
// (log-operazioni E sorteggi), inserendo fixture minime direttamente in
// Postgres e verificando che un campo reale per gruppo arrivi intatto al DOM.
const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

function renderConStagione(stagioneId: string) {
  const router = createMemoryRouter([
    { path: '/', element: <Outlet context={stagioneId} />, children: [{ index: true, element: <AuditSorteggioView /> }] },
  ]);
  return render(<RouterProvider router={router} />);
}

descrivi('AuditSorteggioView (backend reale)', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];
  let pool: Pool;
  let stagioneId: string | null = null;
  let associazioneId: string | null = null;
  let sorteggioId: string | null = null;
  let elaborazioneId: string | null = null;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    if (sorteggioId) await pool.query('DELETE FROM sorteggi WHERE id = $1', [sorteggioId]);
    if (elaborazioneId) await pool.query('DELETE FROM elaborazioni WHERE id = $1', [elaborazioneId]);
    if (associazioneId) await pool.query('DELETE FROM associazioni WHERE id = $1', [associazioneId]);
    if (stagioneId) await pool.query('DELETE FROM stagioni_sportive WHERE id = $1', [stagioneId]);
    await pool.end();
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  it('mostra un log_operazioni reale (azione) e un verbale di sorteggio reale (contesto) letti da Postgres', async () => {
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
    const azioneUnica = `azione_smoke_${suffisso}`;
    await registraOperazione(pool, {
      attore: { tipo: 'backoffice', utenteBackofficeId: (await pool.query<{ id: string }>('SELECT id FROM utenti_backoffice WHERE email = $1', [u.email])).rows[0]!.id, ruolo: 'admin' },
      azione: azioneUnica,
      entitaTipo: 'entita_smoke_test',
    });

    const rStagione = await apiFetch('/backoffice/stagioni', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: `Stagione Smoke Audit ${suffisso}`, dataInizio: '2031-09-01', dataFine: '2032-06-30' }),
    });
    const stagione = (await rStagione.json()) as { id: string };
    stagioneId = stagione.id;

    const rAssociazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
      [`ASD Smoke Audit ${suffisso}`, `PIVAAUD${suffisso}`],
    );
    associazioneId = rAssociazione.rows[0]!.id;

    // `listaSorteggiPerStagione` (GET /backoffice/stagioni/:id/sorteggi) filtra
    // per stagione tramite l'`elaborazione_id` del verbale — serve un'elaborazione
    // reale collegata alla stagione appena creata prima di poter inserire il
    // sorteggio.
    const rVersione = await pool.query<{ id: string }>('SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1');
    const rElaborazione = await pool.query<{ id: string }>(
      `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato)
       VALUES ($1, 'prima_assegnazione', $2, 'completata') RETURNING id`,
      [stagioneId, rVersione.rows[0]!.id],
    );
    elaborazioneId = rElaborazione.rows[0]!.id;

    const contestoUnico = `contesto smoke ${suffisso}`;
    const rSorteggio = await pool.query<{ id: string }>(
      `INSERT INTO sorteggi (elaborazione_id, articolo_riferimento, contesto, seme_hex, vincitore_associazione_id, hash_verbale)
       VALUES ($1, 'B.21', $2, 'ab', $3, 'hash-fittizio') RETURNING id`,
      [rElaborazione.rows[0]!.id, contestoUnico, associazioneId],
    );
    sorteggioId = rSorteggio.rows[0]!.id;

    renderConStagione(stagioneId);

    await waitFor(() => expect(screen.getByText(new RegExp(azioneUnica))).toBeInTheDocument(), { timeout: 15000 });
    await waitFor(() => expect(screen.getByText(new RegExp(contestoUnico))).toBeInTheDocument(), { timeout: 15000 });
  }, 30000);
});
