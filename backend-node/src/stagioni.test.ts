import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { listaStagioni } from './stagioni.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'listaStagioni legge le stagioni da Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const inserimento = await pool.query<{ id: string }>(
        `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, $2, $3) RETURNING id`,
        ['test-node-2029/2030', '2029-09-01', '2030-06-30'],
      );
      const stagioneId = inserimento.rows[0]?.id;
      assert.ok(stagioneId, 'insert fixture non ha restituito id');

      const stagioni = await listaStagioni(pool);

      const trovata = stagioni.find((s) => s.id === stagioneId);
      assert.ok(trovata, 'stagione inserita non trovata nel risultato');
      assert.equal(trovata?.nome, 'test-node-2029/2030');
      assert.equal(trovata?.stato, 'censimento');
      assert.equal(trovata?.dataInizio, '2029-09-01');
    } finally {
      await pool.end();
    }
  },
);
