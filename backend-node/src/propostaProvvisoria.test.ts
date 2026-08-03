import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pubblicaProposta, trovaPropostaProvvisoria } from './propostaProvvisoria.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaStagione(pool: Pool, stato: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', $2) RETURNING id`,
    [`stagione-proposta-test-${randomUUID()}`, stato],
  );
  return r.rows[0]!.id;
}

test('pubblicaProposta rifiuta se non esiste elaborazione prima_assegnazione completata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  await assert.rejects(() => pubblicaProposta(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('pubblicaProposta rifiuta se stagione non è in prima_assegnazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'concertazione');
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata')`,
    [stagioneId, versione.rows[0]!.id],
  );
  await assert.rejects(() => pubblicaProposta(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('pubblicaProposta transiziona lo stato e trovaPropostaProvvisoria funziona dopo', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata')`,
    [stagioneId, versione.rows[0]!.id],
  );
  await pubblicaProposta(pool, stagioneId);
  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'concertazione');

  const voci = await trovaPropostaProvvisoria(pool, stagioneId);
  assert.deepEqual(voci, []); // nessuna assegnazione creata in questo test, solo verifica che non lanci più ErroreStatoNonValidoPerTransizione
});

test('trovaPropostaProvvisoria rifiuta se la proposta non è ancora pubblicata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  await assert.rejects(() => trovaPropostaProvvisoria(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('pubblicaProposta lancia ErroreNonTrovato su stagione inesistente', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  await assert.rejects(() => pubblicaProposta(pool, randomUUID()), ErroreNonTrovato);
});
