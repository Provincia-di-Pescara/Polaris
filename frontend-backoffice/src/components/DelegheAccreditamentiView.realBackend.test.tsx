import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { render, screen, waitFor } from '@testing-library/react';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { impostaTokens, rimuoviTokens } from '../api/client.ts';
import { DelegheAccreditamentiView } from './DelegheAccreditamentiView.tsx';

// Finding 1 della final review: i 4 nuovi file di test di questo blocco (Control
// Room, Parametri Sistema, Deleghe, Audit/Sorteggio) mockano tutti il modulo api
// via vi.spyOn — nessuno di loro esercita davvero il backend reale, a differenza
// di ImpiantiSpaziView.test.tsx (blocco precedente). Un typo nel nome di un campo
// (backend snake_case->camelCase o mismatch di tipo) non verrebbe mai rilevato da
// questa suite. Questo file è uno SMOKE test, non copertura completa: un'unica
// asserzione che un campo reale (qui `personaFisicaCognome`, arricchito dal JOIN
// SQL di listaAbilitazioni) attraversa Postgres -> JSON del backend -> tipo
// TypeScript del frontend -> DOM renderizzato.
const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('DelegheAccreditamentiView (backend reale)', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];
  let pool: Pool;
  let personaFisicaId: string | null = null;
  let associazioneId: string | null = null;
  let stagioneId: string | null = null;
  let abilitazioneId: string | null = null;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
    pool = new Pool({ connectionString: dsn });
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    if (abilitazioneId) await pool.query('DELETE FROM abilitazioni WHERE id = $1', [abilitazioneId]);
    if (associazioneId) await pool.query('DELETE FROM associazioni WHERE id = $1', [associazioneId]);
    if (personaFisicaId) await pool.query('DELETE FROM persone_fisiche WHERE id = $1', [personaFisicaId]);
    if (stagioneId) await pool.query('DELETE FROM stagioni_sportive WHERE id = $1', [stagioneId]);
    await pool.end();
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  it('carica una delega reale da Postgres e ne mostra il cognome della persona fisica (round-trip campo reale)', async () => {
    const u = await creaUtenteTest(dsn!, 'admin');
    utentiCreati.push(u);
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);

    const suffisso = randomUUID().slice(0, 8);
    const cognomeUnico = `RealBackendSmoke${suffisso}`;

    const rStagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2031-09-01', '2032-06-30') RETURNING id`,
      [`Stagione Smoke Deleghe ${suffisso}`],
    );
    stagioneId = rStagione.rows[0]!.id;

    const rPersona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Mario', $2, $3, 'spid') RETURNING id`,
      [`SMK${suffisso.toUpperCase()}A01H501U`, cognomeUnico, `sub-${suffisso}`],
    );
    personaFisicaId = rPersona.rows[0]!.id;

    const rAssociazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
      [`ASD Smoke ${suffisso}`, `PIVA${suffisso}`],
    );
    associazioneId = rAssociazione.rows[0]!.id;

    const rAbilitazione = await pool.query<{ id: string }>(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'in_attesa') RETURNING id`,
      [personaFisicaId, associazioneId, stagioneId],
    );
    abilitazioneId = rAbilitazione.rows[0]!.id;

    render(<DelegheAccreditamentiView />);

    // Il Postgres di sviluppo condiviso può avere accumulato molte righe
    // `abilitazioni` da fixture di test precedenti (nessuna paginazione in
    // listaAbilitazioni/GET /backoffice/deleghe) — timeout elevato come per
    // ImpiantiSpaziView.test.tsx, stesso motivo.
    await waitFor(() => expect(screen.getByText(new RegExp(cognomeUnico))).toBeInTheDocument(), { timeout: 60000 });
  }, 90000);
});
