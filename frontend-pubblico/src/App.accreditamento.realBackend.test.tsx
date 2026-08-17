import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { avviaBackendReale, type BackendReale } from './testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from './testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './api/client.ts';
import { App } from './App.tsx';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

// Nessun helper condiviso lato frontend per creare una "stagione" di test
// (lo stesso gap notato in api/associazioni.test.ts e api/deleghe.test.ts):
// inserimento diretto via pg, stesso pattern di
// backend-node/src/server.pubblico.test.ts:creaStagioneTest. Necessario qui
// perché in un DB di test pulito App.tsx (Task 2) non trova nessuna stagione
// da preselezionare e il form di accreditamento resterebbe bloccato
// sull'errore "seleziona una stagione".
async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-app-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

descrivi('App — accreditamento (backend reale)', () => {
  let backend: BackendReale;
  let pool: Pool;
  const personeCreate: PersonaTest[] = [];
  let stagioneId: string;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
    stagioneId = await creaStagioneTest(pool);
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    // Il flusso creaAssociazione lascia dietro un'abilitazione (FK non-cascading
    // verso persone_fisiche e stagioni_sportive) e un'associazione collegata:
    // vanno ripulite prima di eliminare persona e stagione, stesso ordine di
    // api/associazioni.test.ts.
    const personeIds = personeCreate.map((p) => p.persona.id);
    if (personeIds.length > 0) {
      const associazioniIds = (
        await pool.query<{ associazione_id: string }>(
          'SELECT DISTINCT associazione_id FROM abilitazioni WHERE persona_fisica_id = ANY($1::uuid[]) AND associazione_id IS NOT NULL',
          [personeIds],
        )
      ).rows.map((r) => r.associazione_id);
      if (associazioniIds.length > 0) {
        await pool.query('DELETE FROM associazioni_documenti WHERE associazione_id = ANY($1::uuid[])', [associazioniIds]);
      }
      await pool.query('DELETE FROM log_operazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
      await pool.query('DELETE FROM abilitazioni WHERE persona_fisica_id = ANY($1::uuid[])', [personeIds]);
      if (associazioniIds.length > 0) {
        await pool.query('DELETE FROM associazioni WHERE id = ANY($1::uuid[])', [associazioniIds]);
      }
    }
    await Promise.all(personeCreate.map((p) => p.elimina()));
    await pool.query('DELETE FROM stagioni_sportive WHERE id = $1', [stagioneId]);
    await pool.end();
  });

  it('crea una nuova associazione dal form e la vede comparire nella lista dopo il salvataggio', async () => {
    const p = await creaPersonaTest(dsn!);
    personeCreate.push(p);
    impostaTokens(p.accessToken, p.refreshToken);

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /richiedi nuova delega/i }));

    const suffisso = randomUUID().slice(0, 8);
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), `ASD Smoke ${suffisso}`);
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), `PIVA-${suffisso}`);

    // Il form richiede una stagione selezionata: attende che il caricamento
    // automatico di App.tsx ne abbia già impostata una di default (vedi Task 2).
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(await screen.findByText(new RegExp(`ASD Smoke ${suffisso}`), {}, { timeout: 10000 })).toBeInTheDocument();
  }, 20000);
});
