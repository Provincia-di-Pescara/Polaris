import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { leggiImpostazione, scriviImpostazione } from './impostazioniSistema.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'scriviImpostazione valorizza aggiornata_da',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const chiave = `test-impostazione-${randomUUID()}`;
      const operatoreId = randomUUID();
      await pool.query(
        `INSERT INTO utenti_backoffice (id, email, password_hash, nome, cognome, ruolo, stato)
         VALUES ($1, $2, 'hash-finto', 'Test', 'Impostazioni', 'admin', 'attivo')`,
        [operatoreId, `impostazioni-test-${randomUUID()}@test.local`],
      );

      await scriviImpostazione(pool, chiave, { valore: 'iniziale' }, operatoreId);

      const riga = await pool.query<{ aggiornata_da: string }>(
        'SELECT aggiornata_da FROM impostazioni_sistema WHERE chiave = $1',
        [chiave],
      );
      assert.equal(riga.rows[0]?.aggiornata_da, operatoreId);

      const letta = await leggiImpostazione<{ valore: string }>(pool, chiave);
      assert.equal(letta?.valore, 'iniziale');
    } finally {
      await pool.end();
    }
  },
);
