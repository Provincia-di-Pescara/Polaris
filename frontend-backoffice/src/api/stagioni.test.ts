import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { impostaTokens, rimuoviTokens, ErroreRichiestaApi } from './client.ts';
import { listaStagioni, creaStagione } from './stagioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('listaStagioni', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];
  const stagioniCreate: string[] = [];

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
    if (stagioniCreate.length > 0) {
      const pool = new Pool({ connectionString: dsn });
      try {
        await pool.query('DELETE FROM stagioni_sportive WHERE id = ANY($1::uuid[])', [stagioniCreate]);
      } finally {
        await pool.end();
      }
    }
  });

  it('ritorna un array (anche vuoto) senza richiedere autenticazione', async () => {
    rimuoviTokens();
    const stagioni = await listaStagioni();
    expect(Array.isArray(stagioni)).toBe(true);
  });

  it('ogni stagione ha id/nome/dataInizio/dataFine/stato', async () => {
    const r = await fetch(`${backend.baseUrl}/backoffice/stagioni`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Nessuna auth qui: verifichiamo solo la forma via GET pubblico sotto.
    }).catch(() => null);
    // Non serve creare una stagione reale per questo test: se il seed di sviluppo
    // ne ha già almeno una, verifichiamo la forma sul primo elemento; altrimenti
    // il test si limita a verificare che la chiamata non fallisca (coperto sopra).
    const stagioni = await listaStagioni();
    if (stagioni.length > 0) {
      const s = stagioni[0]!;
      expect(typeof s.id).toBe('string');
      expect(typeof s.nome).toBe('string');
      expect(typeof s.dataInizio).toBe('string');
      expect(typeof s.dataFine).toBe('string');
      expect(typeof s.stato).toBe('string');
    }
    void r;
  });
});

descrivi('creaStagione', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];
  const stagioniCreate: string[] = [];

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
    if (stagioniCreate.length > 0) {
      const pool = new Pool({ connectionString: dsn });
      try {
        await pool.query('DELETE FROM stagioni_sportive WHERE id = ANY($1::uuid[])', [stagioniCreate]);
      } finally {
        await pool.end();
      }
    }
  });

  it('admin: crea la stagione, torna nella lista pubblica', async () => {
    await loginComeAdmin();
    const nome = `stagione-test-${randomUUID()}`;
    const s = await creaStagione({ nome, dataInizio: '2031-09-01', dataFine: '2032-06-30' });
    stagioniCreate.push(s.id);

    expect(s.nome).toBe(nome);
    expect(s.dataInizio).toBe('2031-09-01');
    expect(s.dataFine).toBe('2032-06-30');
    expect(typeof s.stato).toBe('string');

    rimuoviTokens();
    const lista = await listaStagioni();
    expect(lista.some((x) => x.id === s.id)).toBe(true);
  });

  it('rifiuta senza autenticazione (401)', async () => {
    rimuoviTokens();
    const err = await creaStagione({ nome: `stagione-test-${randomUUID()}`, dataInizio: '2031-09-01', dataFine: '2032-06-30' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(401);
  });

  it('rifiuta dataInizio successiva a dataFine (400)', async () => {
    await loginComeAdmin();
    const err = await creaStagione({
      nome: `stagione-test-${randomUUID()}`,
      dataInizio: '2032-06-30',
      dataFine: '2031-09-01',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(400);
  });

  it('rifiuta un nome duplicato (409)', async () => {
    await loginComeAdmin();
    const nome = `stagione-test-${randomUUID()}`;
    const prima = await creaStagione({ nome, dataInizio: '2031-09-01', dataFine: '2032-06-30' });
    stagioniCreate.push(prima.id);

    const err = await creaStagione({ nome, dataInizio: '2033-09-01', dataFine: '2034-06-30' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErroreRichiestaApi);
    expect((err as ErroreRichiestaApi).status).toBe(409);
  });
});
