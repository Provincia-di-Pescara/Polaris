import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './client.ts';
import { listaSlot } from './slot.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-api-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

descrivi('slot.ts', () => {
  let backend: BackendReale;
  let pool: Pool;
  const personeCreate: PersonaTest[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.end();
  });

  it('listaSlot restituisce un array (anche vuoto) con token valido', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);

    const slot = await listaSlot(stagioneId);
    expect(Array.isArray(slot)).toBe(true);
  });

  it('listaSlot con disciplinaCodice filter restituisce un array', async () => {
    const persona = await creaPersonaTest(dsn!);
    personeCreate.push(persona);
    impostaTokens(persona.accessToken, persona.refreshToken);

    const stagioneId = await creaStagioneTest(pool);

    const slot = await listaSlot(stagioneId, 'CALCIO');
    expect(Array.isArray(slot)).toBe(true);
  });
});
