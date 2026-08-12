import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: import('pg').Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteTest(pool: import('pg').Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `sorteggi-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Sorteggi', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/stagioni/:id/sorteggi e /backoffice/sorteggi/:id',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const operatore = await creaUtenteTest(pool, 'operatore');

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione sorteggi HTTP ${randomUUID()}`],
    );
    const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
    const elaborazione = await pool.query<{ id: string }>(
      `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata') RETURNING id`,
      [stagione.rows[0]!.id, versione.rows[0]!.id],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Sorteggio HTTP', $1) RETURNING id`,
      [randomUUID()],
    );
    const sorteggio = await pool.query<{ id: string }>(
      `INSERT INTO sorteggi (elaborazione_id, articolo_riferimento, contesto, seme_hex, vincitore_associazione_id, hash_verbale)
       VALUES ($1, 'B.21', 'contesto HTTP', 'cd34', $2, 'hashverbalehttp') RETURNING id`,
      [elaborazione.rows[0]!.id, associazione.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO sorteggio_candidati (sorteggio_id, associazione_id, ordine_canonico, hmac_hex, rank) VALUES ($1, $2, 1, 'hmac-http', 1)`,
      [sorteggio.rows[0]!.id, associazione.rows[0]!.id],
    );

    const rLista = await fetch(`${base}/backoffice/stagioni/${stagione.rows[0]!.id}/sorteggi`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rLista.status, 200);
    const lista = (await rLista.json()) as Array<{ id: string }>;
    assert.equal(lista.length, 1);

    const rDettaglio = await fetch(`${base}/backoffice/sorteggi/${sorteggio.rows[0]!.id}`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rDettaglio.status, 200);
    const dettaglio = (await rDettaglio.json()) as { candidati: unknown[]; hashVerbale: string };
    assert.equal(dettaglio.candidati.length, 1);
    assert.equal(dettaglio.hashVerbale, 'hashverbalehttp');

    const rDettaglioInesistente = await fetch(`${base}/backoffice/sorteggi/${randomUUID()}`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rDettaglioInesistente.status, 404);

    const rStagioneInesistente = await fetch(`${base}/backoffice/stagioni/${randomUUID()}/sorteggi`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rStagioneInesistente.status, 404);
  },
);
