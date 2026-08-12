import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { impostaTokens, rimuoviTokens } from '../api/client.ts';
import { ParametriSistemaView } from './ParametriSistemaView.tsx';

// Smoke test contro il backend reale (Finding 1 della final review — vedi
// commento in DelegheAccreditamentiView.realBackend.test.tsx per il razionale
// completo). Nessuna fixture da creare: la migration 000002_seed_valori_normativi
// pubblica già una versione parametrica iniziale, quindi la vista deve mostrare
// la versione attiva reale letta da Postgres — verifichiamo che il campo
// `moltiplicatoreMinutiPerPunto` (letto via `::text` in SQL, mai binding
// numerico diretto, vedi CLAUDE.md) attraversi backend->frontend intatto.
const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('ParametriSistemaView (backend reale)', () => {
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

  it('carica la versione parametrica attiva reale e ne mostra il moltiplicatore minuti/punto (round-trip campo reale)', async () => {
    const u = await creaUtenteTest(dsn!, 'admin');
    utentiCreati.push(u);
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);

    // Legge il valore atteso direttamente dal backend reale (non hardcoded qui):
    // il seed è un dato di sviluppo, non un contratto di questo test — vogliamo
    // solo verificare che il VALORE VERO restituito da Postgres/backend sia lo
    // stesso che finisce nel DOM, qualunque esso sia.
    const rAttesa = await fetch(`${backend.baseUrl}/backoffice/parametrico`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const attesa = (await rAttesa.json()) as { moltiplicatoreMinutiPerPunto: string };

    render(<ParametriSistemaView />);

    await waitFor(
      () => expect(screen.getByText(attesa.moltiplicatoreMinutiPerPunto)).toBeInTheDocument(),
      { timeout: 15000 },
    );
  }, 30000);
});
