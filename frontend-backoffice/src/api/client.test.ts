import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens, ErroreSessioneScaduta } from './client.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('apiFetch', () => {
  let backend: BackendReale;
  // Utenti creati dai singoli test di questo file, ripuliti in afterAll. Un
  // DELETE per-pattern condiviso tra file di test (che girano in worker
  // paralleli) creerebbe un race reale: l'afterAll di un altro file potrebbe
  // cancellare l'utente di test usato da un login ancora in corso qui — visto
  // accadere davvero durante lo sviluppo di questo fix (login falliva con
  // "credenziali non valide" solo quando la suite intera girava in parallelo).
  const utentiCreati: UtenteTest[] = [];

  async function nuovoUtenteTest(ruolo: 'admin' | 'operatore'): Promise<UtenteTest> {
    const u = await creaUtenteTest(dsn!, ruolo);
    utentiCreati.push(u);
    return u;
  }

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override in test, api/client.ts legge da import.meta.env in produzione
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  beforeEach(() => {
    rimuoviTokens();
    localStorage.clear();
  });

  it('allega Authorization: Bearer quando un access token è presente', async () => {
    const utente = await nuovoUtenteTest('admin');
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
    const utente = await nuovoUtenteTest('admin');
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

  it('due apiFetch concorrenti con lo stesso access token scaduto condividono un solo refresh (nessuna va in ErroreSessioneScaduta)', async () => {
    const utente = await nuovoUtenteTest('admin');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utente.email, password: utente.password }),
    });
    const { refreshToken } = await loginRes.json();
    // Access token invalido: entrambe le chiamate concorrenti prendono un 401 e
    // tentano il refresh. Senza single-flight, la seconda userebbe il refresh
    // token già ruotato dalla prima e fallirebbe con ErroreSessioneScaduta.
    impostaTokens('token-invalido', refreshToken);

    const [r1, r2] = await Promise.all([apiFetch('/auth/me'), apiFetch('/auth/me')]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('su 401 con refresh token invalido, lancia ErroreSessioneScaduta e ripulisce i token', async () => {
    impostaTokens('token-invalido', 'refresh-invalido');

    await expect(apiFetch('/auth/me')).rejects.toThrow(ErroreSessioneScaduta);
    expect(localStorage.getItem('polaris_access_token')).toBeNull();
    expect(localStorage.getItem('polaris_refresh_token')).toBeNull();
  });
});
