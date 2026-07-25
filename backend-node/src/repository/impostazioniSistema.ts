import type { Pool } from 'pg';

export async function leggiImpostazione<T>(pool: Pool, chiave: string): Promise<T | null> {
  const risultato = await pool.query<{ valore: T }>('SELECT valore FROM impostazioni_sistema WHERE chiave = $1', [
    chiave,
  ]);
  return risultato.rows[0]?.valore ?? null;
}

export async function scriviImpostazione<T>(pool: Pool, chiave: string, valore: T): Promise<void> {
  await pool.query(
    `INSERT INTO impostazioni_sistema (chiave, valore)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore, aggiornata_il = now()`,
    [chiave, JSON.stringify(valore)],
  );
}
