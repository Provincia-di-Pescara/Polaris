import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { impostaTokens, rimuoviTokens, ErroreRichiestaApi } from './client.ts';
import { listaUtenti, creaUtente, aggiornaUtente, cambiaStatoUtente, richiediResetPassword } from './utenti.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('api/utenti.ts', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];

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

  it('listaUtenti: rifiuta senza autenticazione (401)', async () => {
    rimuoviTokens();
    const err = await listaUtenti().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(401);
  });

  it('listaUtenti: admin vede almeno se stesso', async () => {
    await loginComeAdmin();
    const lista = await listaUtenti();
    expect(Array.isArray(lista)).toBe(true);
    expect(lista.length).toBeGreaterThan(0);
    const u = lista[0]!;
    expect(typeof u.id).toBe('string');
    expect(typeof u.email).toBe('string');
    expect(['admin', 'operatore']).toContain(u.ruolo);
    expect(['attivo', 'disattivato', 'in_attesa_verifica']).toContain(u.stato);
  });

  // avviaBackendReale() non imposta SMTP_HOST/BACKOFFICE_BASE_URL: la route
  // risponde 503 PRIMA di validare i dati — deterministico, stesso motivo per
  // cui api/bootstrap.test.ts usa lo stesso schema di verifica.
  it('creaUtente: 503 se l\'SMTP non è configurato', async () => {
    await loginComeAdmin();
    const err = await creaUtente({
      email: `nuovo-${randomUUID()}@example.com`,
      nome: 'Mario',
      cognome: 'Rossi',
      ruolo: 'operatore',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(503);
  });

  it('aggiornaUtente: modifica nome/cognome/ruolo di un utente esistente', async () => {
    await loginComeAdmin();
    const lista = await listaUtenti();
    const target = lista[0]!;
    const aggiornato = await aggiornaUtente(target.id, { nome: 'NomeAggiornato', cognome: target.cognome, ruolo: target.ruolo });
    expect(aggiornato.nome).toBe('NomeAggiornato');
    // Ripristina per non inquinare altri test che leggono lo stesso utente condiviso.
    await aggiornaUtente(target.id, { nome: target.nome, cognome: target.cognome, ruolo: target.ruolo });
  });

  it('aggiornaUtente: 404 su id inesistente', async () => {
    await loginComeAdmin();
    const err = await aggiornaUtente(randomUUID(), { nome: 'X', cognome: 'Y', ruolo: 'operatore' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(404);
  });

  // La regola "non disattivare l'ultimo admin attivo" (ErroreUltimoAdmin, 409)
  // non è verificabile in modo deterministico qui: il DB di test è condiviso da
  // tutta la suite, altri file possono lasciare admin attivi residui, quindi
  // disattivarne uno specifico non garantisce di colpire "l'ultimo". Quella
  // regola è già coperta a fondo lato backend (repository/utentiBackoffice.test.ts,
  // DB dedicato) — qui verifichiamo solo il caso deterministico: id inesistente.
  it('cambiaStatoUtente: 404 su id inesistente', async () => {
    await loginComeAdmin();
    const err = await cambiaStatoUtente(randomUUID(), 'disattivato').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(404);
  });

  it('richiediResetPassword: 503 se l\'SMTP non è configurato', async () => {
    await loginComeAdmin();
    const lista = await listaUtenti();
    const err = await richiediResetPassword(lista[0]!.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(503);
  });
});
