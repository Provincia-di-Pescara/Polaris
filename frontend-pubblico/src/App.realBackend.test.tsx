import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { avviaBackendReale, type BackendReale } from './testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from './testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './api/client.ts';
import { App } from './App.tsx';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('App (backend reale)', () => {
  let backend: BackendReale;
  const personeCreate: PersonaTest[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(personeCreate.map((p) => p.elimina()));
  });

  it('senza token, mostra LoginView', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /accedi con spid/i })).toBeInTheDocument();
  });

  it('con token reale, carica persona da /auth/pubblico/me e mostra Header', async () => {
    const p = await creaPersonaTest(dsn!);
    personeCreate.push(p);
    impostaTokens(p.accessToken, p.refreshToken);

    render(<App />);

    // Timeout esplicito: App.tsx ora carica anche le stagioni (GET /stagioni)
    // oltre a persona+entità al mount — tre fetch sequenziali contro un
    // backend reale spawnato superano facilmente il default di 5000ms.
    expect(
      await screen.findByText(new RegExp(`${p.persona.nome} ${p.persona.cognome}`), {}, { timeout: 15000 }),
    ).toBeInTheDocument();
  }, 20000);
});
