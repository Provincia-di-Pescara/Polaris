import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { rimuoviTokens, ErroreRichiestaApi } from './client.ts';
import { statoBootstrap, richiediPrimoAdmin, verificaBootstrap } from './bootstrap.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('api/bootstrap.ts', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
  });

  it('statoBootstrap ritorna un booleano, senza richiedere autenticazione', async () => {
    rimuoviTokens();
    const s = await statoBootstrap();
    expect(typeof s.disponibile).toBe('boolean');
  });

  // avviaBackendReale() non imposta SMTP_HOST/BACKOFFICE_BASE_URL: l'endpoint
  // risponde 503 PRIMA di verificare se il bootstrap è ancora disponibile (vedi
  // server.ts) — deterministico indipendentemente dallo stato di
  // utenti_backoffice sul DB condiviso di test (mai azzerabile qui in sicurezza).
  it('richiediPrimoAdmin: 503 se l\'SMTP di bootstrap non è configurato', async () => {
    await expect(
      richiediPrimoAdmin({ email: 'nuovo-admin@example.com', password: 'password-lunga-12+', nome: 'Mario', cognome: 'Rossi' }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('richiediPrimoAdmin: 400 su dati non validi (password troppo corta)', async () => {
    await expect(
      richiediPrimoAdmin({ email: 'nuovo-admin@example.com', password: 'corta', nome: 'Mario', cognome: 'Rossi' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('verificaBootstrap: 401 su token nel formato corretto ma inesistente', async () => {
    const err = await verificaBootstrap('a'.repeat(64)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(401);
  });
});
