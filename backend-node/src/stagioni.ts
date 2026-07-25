import type { Pool } from 'pg';

export interface Stagione {
  id: string;
  nome: string;
  dataInizio: string;
  dataFine: string;
  stato: string;
}

interface RigaStagione {
  id: string;
  nome: string;
  data_inizio: string;
  data_fine: string;
  stato: string;
}

export async function listaStagioni(pool: Pool): Promise<Stagione[]> {
  const risultato = await pool.query<RigaStagione>(
    `SELECT id, nome, data_inizio::text, data_fine::text, stato
     FROM stagioni_sportive
     ORDER BY data_inizio DESC`,
  );

  return risultato.rows.map((riga) => ({
    id: riga.id,
    nome: riga.nome,
    dataInizio: riga.data_inizio,
    dataFine: riga.data_fine,
    stato: riga.stato,
  }));
}
