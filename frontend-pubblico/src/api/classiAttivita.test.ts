import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { listaClassiAttivita } from './classiAttivita.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('classiAttivita.ts', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
  });

  it('restituisce un array senza richiedere autenticazione', async () => {
    const classi = await listaClassiAttivita();
    expect(Array.isArray(classi)).toBe(true);
  });
});
