import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { listaStagioni } from './stagioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('stagioni.ts', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
  });

  it('restituisce un array (anche vuoto) senza richiedere autenticazione', async () => {
    const stagioni = await listaStagioni();
    expect(Array.isArray(stagioni)).toBe(true);
  });
});
