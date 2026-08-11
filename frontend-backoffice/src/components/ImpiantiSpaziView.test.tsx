import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { impostaTokens, rimuoviTokens } from '../api/client.ts';
import { ImpiantiSpaziView } from './ImpiantiSpaziView.tsx';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

// Il Postgres di sviluppo condiviso ha accumulato migliaia di righe disposable
// in `impianti` (nessuna riga in quella tabella viene mai seminata dalle
// migration — sono tutte fixture di test precedenti mai ripulite) e questa
// vista le renderizza tutte senza paginazione: ogni interazione userEvent su
// un DOM con 6000+ nodi in jsdom è sensibilmente più lenta del default
// @testing-library (`asyncUtilTimeout` 1000ms). Timeout elevato solo qui,
// non a livello globale, per non mascherare regressioni di velocità altrove.
const WAIT_FOR_TIMEOUT = { timeout: 30000 };

descrivi('ImpiantiSpaziView', () => {
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

  async function loginComeAdmin(): Promise<void> {
    const u = await creaUtenteTest(dsn!, 'admin');
    utentiCreati.push(u);
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);
  }

  it('crea un impianto da zero e lo vede comparire in lista', async () => {
    await loginComeAdmin();

    render(<ImpiantiSpaziView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /nuovo impianto/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);

    await userEvent.click(screen.getByRole('button', { name: /nuovo impianto/i }));

    const nome = `Palestra E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nome);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    await waitFor(() => expect(screen.getByText(nome)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
  }, 120000);

  it('crea uno spazio dentro un impianto e lo vede comparire', async () => {
    await loginComeAdmin();

    render(<ImpiantiSpaziView />);

    await waitFor(() => expect(screen.getByRole('button', { name: /nuovo impianto/i })).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
    await userEvent.click(screen.getByRole('button', { name: /nuovo impianto/i }));
    const nomeImpianto = `Palestra Spazi E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nomeImpianto);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));
    await waitFor(() => expect(screen.getByText(nomeImpianto)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);

    await userEvent.click(screen.getByText(nomeImpianto));
    await userEvent.click(screen.getByRole('button', { name: /nuovo spazio/i }));

    const nomeSpazio = `Campo E2E ${randomUUID().slice(0, 8)}`;
    await userEvent.type(screen.getByLabelText(/denominazione/i), nomeSpazio);
    await userEvent.click(screen.getByRole('button', { name: /salva/i }));

    await waitFor(() => expect(screen.getByText(nomeSpazio)).toBeInTheDocument(), WAIT_FOR_TIMEOUT);
  }, 120000);
});
