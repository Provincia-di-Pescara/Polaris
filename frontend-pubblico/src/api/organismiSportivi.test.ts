import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { listaOrganismiSportivi } from './organismiSportivi.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('organismiSportivi.ts', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
  });

  it('restituisce l\'elenco seedato senza richiedere autenticazione', async () => {
    const organismi = await listaOrganismiSportivi();
    expect(organismi.length).toBeGreaterThan(70);
    expect(organismi.some((o) => o.codice === 'UISP')).toBe(true);
  });
});
