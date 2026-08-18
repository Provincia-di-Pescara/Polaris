import type { Db } from './db.ts';

export interface ClasseAttivita {
  codice: string;
  descrizione: string;
  pesoBase: number;
}

export async function listaClassiAttivita(db: Db): Promise<ClasseAttivita[]> {
  const r = await db.query<{ codice: string; descrizione: string; peso_base: number }>(
    `SELECT codice, descrizione, peso_base FROM classi_attivita ORDER BY codice`,
  );
  return r.rows.map((row) => ({ codice: row.codice, descrizione: row.descrizione, pesoBase: row.peso_base }));
}
