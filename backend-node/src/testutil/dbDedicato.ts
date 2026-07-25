import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';

// Database usa-e-getta per i test che operano su tabelle intere (es. bootstrap primo
// admin, che richiede "nessun utente esiste"): i file di test girano in parallelo sullo
// stesso Postgres, quindi quei test non possono condividere il DB con gli altri.
// Crea un database nuovo, applica le migration reali, e lo droppa alla fine.

const DIR_MIGRATIONS = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'db', 'migrations');

export async function creaDatabaseDedicato(dsnBase: string): Promise<{ pool: Pool; distruggi: () => Promise<void> }> {
  const nomeDb = `test_dedicato_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: dsnBase });
  await admin.query(`CREATE DATABASE ${nomeDb}`);

  const urlDedicato = new URL(dsnBase);
  urlDedicato.pathname = `/${nomeDb}`;
  const pool = new Pool({ connectionString: urlDedicato.toString() });

  const file = (await readdir(DIR_MIGRATIONS)).filter((f) => f.endsWith('.up.sql')).sort();
  for (const f of file) {
    await pool.query(await readFile(path.join(DIR_MIGRATIONS, f), 'utf8'));
  }

  return {
    pool,
    distruggi: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE ${nomeDb}`);
      await admin.end();
    },
  };
}
