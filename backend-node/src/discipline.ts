import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

export interface Disciplina {
  codice: string;
  denominazione: string;
}

interface RigaDisciplina {
  codice: string;
  denominazione: string;
}

function daRiga(r: RigaDisciplina): Disciplina {
  return { codice: r.codice, denominazione: r.denominazione };
}

export interface DatiCreaDisciplina {
  codice: string;
  denominazione: string;
}

export async function creaDisciplina(db: Db, dati: DatiCreaDisciplina): Promise<Disciplina> {
  try {
    const r = await db.query<RigaDisciplina>(
      `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, $2)
       RETURNING codice, denominazione`,
      [dati.codice, dati.denominazione],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('codice disciplina già esistente');
    }
    throw err;
  }
}

export async function listaDiscipline(db: Db): Promise<Disciplina[]> {
  const r = await db.query<RigaDisciplina>(
    `SELECT codice, denominazione FROM discipline_sportive ORDER BY denominazione`,
  );
  return r.rows.map(daRiga);
}

export async function aggiornaDisciplina(db: Db, codice: string, denominazione: string): Promise<Disciplina> {
  const r = await db.query<RigaDisciplina>(
    `UPDATE discipline_sportive SET denominazione = $2 WHERE codice = $1
     RETURNING codice, denominazione`,
    [codice, denominazione],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('disciplina non trovata');
  }
  return daRiga(riga);
}
