import type { Db } from '../db.ts';

export async function leggiImpostazione<T>(db: Db, chiave: string): Promise<T | null> {
  const risultato = await db.query<{ valore: T }>('SELECT valore FROM impostazioni_sistema WHERE chiave = $1', [
    chiave,
  ]);
  return risultato.rows[0]?.valore ?? null;
}

export async function scriviImpostazione<T>(
  db: Db,
  chiave: string,
  valore: T,
  aggiornataDa?: string | undefined,
): Promise<void> {
  await db.query(
    `INSERT INTO impostazioni_sistema (chiave, valore, aggiornata_da)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore, aggiornata_il = now(), aggiornata_da = EXCLUDED.aggiornata_da`,
    [chiave, JSON.stringify(valore), aggiornataDa ?? null],
  );
}
