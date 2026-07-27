import { DatabaseError, type Pool } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

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

export interface DatiCreaStagione {
  nome: string;
  dataInizio: string;
  dataFine: string;
}

// db: Db (non Pool) — deve poter girare dentro la transazione entità+audit-log aperta dal
// chiamante in server.ts (stesso pattern di discipline.ts/istituzioni.ts/impianti.ts/slot.ts).
export async function creaStagione(db: Db, dati: DatiCreaStagione): Promise<Stagione> {
  try {
    const r = await db.query<RigaStagione>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, $2, $3)
       RETURNING id, nome, data_inizio::text, data_fine::text, stato`,
      [dati.nome, dati.dataInizio, dati.dataFine],
    );
    const riga = r.rows[0]!;
    return {
      id: riga.id,
      nome: riga.nome,
      dataInizio: riga.data_inizio,
      dataFine: riga.data_fine,
      stato: riga.stato,
    };
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('nome stagione già utilizzato');
    }
    throw err;
  }
}
