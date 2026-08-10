import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest } from '../testUtil/creaUtenteTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens, ErroreSessioneScaduta } from './client.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('apiFetch', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override in test, api/client.ts legge da import.meta.env in produzione
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
  });

  beforeEach(() => {
    rimuoviTokens();
    localStorage.clear();
  });

  it('allega Authorization: Bearer quando un access token è presente', async () => {
    const utente = await creaUtenteTest(dsn!, 'admin');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utente.email, password: utente.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);

    const r = await apiFetch('/auth/me');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.email).toBe(utente.email);
  });

  it('senza token, la richiesta parte comunque senza header Authorization (risposta 401 dal backend)', async () => {
    const r = await apiFetch('/auth/me');
    expect(r.status).toBe(401);
  });

  it('su 401 con refresh token valido, rinnova e ripete la richiesta con successo', async () => {
    const utente = await creaUtenteTest(dsn!, 'admin');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utente.email, password: utente.password }),
    });
    const { refreshToken } = await loginRes.json();
    // Access token deliberatamente invalido/scaduto: forza il ramo di refresh.
    impostaTokens('token-invalido', refreshToken);

    const r = await apiFetch('/auth/me');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.email).toBe(utente.email);
  });

  it('su 401 con refresh token invalido, lancia ErroreSessioneScaduta e ripulisce i token', async () => {
    impostaTokens('token-invalido', 'refresh-invalido');

    await expect(apiFetch('/auth/me')).rejects.toThrow(ErroreSessioneScaduta);
    expect(localStorage.getItem('polaris_access_token')).toBeNull();
    expect(localStorage.getItem('polaris_refresh_token')).toBeNull();
  });
});
