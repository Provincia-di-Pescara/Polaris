import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens, ErroreSessioneScaduta } from './client.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('apiFetch', () => {
  let backend: BackendReale;
  // Persone create dai singoli test di questo file, ripulite in afterAll. Un
  // DELETE per-pattern condiviso tra file di test (che girano in worker
  // paralleli) creerebbe un race reale: l'afterAll di un altro file potrebbe
  // cancellare la persona di test usata da un'autenticazione ancora in corso qui.
  const personeCreate: PersonaTest[] = [];

  async function nuovaPersonaTest(): Promise<PersonaTest> {
    const p = await creaPersonaTest(dsn!);
    personeCreate.push(p);
    return p;
  }

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override in test, api/client.ts legge da import.meta.env in produzione
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
    await Promise.all(personeCreate.map((p) => p.elimina()));
  });

  beforeEach(() => {
    rimuoviTokens();
    localStorage.clear();
  });

  it('allega Authorization: Bearer quando un access token è presente', async () => {
    const persona = await nuovaPersonaTest();
    impostaTokens(persona.accessToken, persona.refreshToken);

    const r = await apiFetch('/auth/pubblico/me');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.codiceFiscale).toBe(persona.persona.codiceFiscale);
  });

  it('senza token, la richiesta parte comunque senza header Authorization (risposta 401 dal backend)', async () => {
    const r = await apiFetch('/auth/pubblico/me');
    expect(r.status).toBe(401);
  });

  it('su 401 con refresh token valido, rinnova e ripete la richiesta con successo', async () => {
    const persona = await nuovaPersonaTest();
    // Access token deliberatamente invalido/scaduto: forza il ramo di refresh.
    impostaTokens('token-invalido', persona.refreshToken);

    const r = await apiFetch('/auth/pubblico/me');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.codiceFiscale).toBe(persona.persona.codiceFiscale);
  });

  it('due apiFetch concorrenti con lo stesso access token scaduto condividono un solo refresh (nessuna va in ErroreSessioneScaduta)', async () => {
    const persona = await nuovaPersonaTest();
    // Access token invalido: entrambe le chiamate concorrenti prendono un 401 e
    // tentano il refresh. Senza single-flight, la seconda userebbe il refresh
    // token già ruotato dalla prima e fallirebbe con ErroreSessioneScaduta.
    impostaTokens('token-invalido', persona.refreshToken);

    const [r1, r2] = await Promise.all([apiFetch('/auth/pubblico/me'), apiFetch('/auth/pubblico/me')]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('su 401 con refresh token invalido, lancia ErroreSessioneScaduta e ripulisce i token', async () => {
    impostaTokens('token-invalido', 'refresh-invalido');

    await expect(apiFetch('/auth/pubblico/me')).rejects.toThrow(ErroreSessioneScaduta);
    expect(localStorage.getItem('polaris_pubblico_access_token')).toBeNull();
    expect(localStorage.getItem('polaris_pubblico_refresh_token')).toBeNull();
  });
});
