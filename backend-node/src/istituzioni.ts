import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

export interface Istituzione {
  id: string;
  denominazione: string;
  codiceMeccanografico: string | null;
  indirizzo: string | null;
}

interface RigaIstituzione {
  id: string;
  denominazione: string;
  codice_meccanografico: string | null;
  indirizzo: string | null;
}

function daRiga(r: RigaIstituzione): Istituzione {
  return {
    id: r.id,
    denominazione: r.denominazione,
    codiceMeccanografico: r.codice_meccanografico,
    indirizzo: r.indirizzo,
  };
}

export interface DatiIstituzione {
  denominazione: string;
  // `| undefined` esplicito (non solo `?:`): con exactOptionalPropertyTypes, l'output di
  // zod per un campo `.optional()` è `T | undefined`, non compatibile con `campo?: T` in
  // fase di assegnazione — evita il cast `as {...}` lato server.ts.
  codiceMeccanografico?: string | undefined;
  indirizzo?: string | undefined;
}

export async function creaIstituzione(db: Db, dati: DatiIstituzione): Promise<Istituzione> {
  try {
    const r = await db.query<RigaIstituzione>(
      `INSERT INTO istituzioni_scolastiche (denominazione, codice_meccanografico, indirizzo)
       VALUES ($1, $2, $3)
       RETURNING id, denominazione, codice_meccanografico, indirizzo`,
      [dati.denominazione, dati.codiceMeccanografico ?? null, dati.indirizzo ?? null],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('codice meccanografico già utilizzato');
    }
    throw err;
  }
}

export async function listaIstituzioni(db: Db): Promise<Istituzione[]> {
  const r = await db.query<RigaIstituzione>(
    `SELECT id, denominazione, codice_meccanografico, indirizzo FROM istituzioni_scolastiche ORDER BY denominazione`,
  );
  return r.rows.map(daRiga);
}

export async function trovaIstituzionePerId(db: Db, id: string): Promise<Istituzione | null> {
  const r = await db.query<RigaIstituzione>(
    `SELECT id, denominazione, codice_meccanografico, indirizzo FROM istituzioni_scolastiche WHERE id = $1`,
    [id],
  );
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function aggiornaIstituzione(db: Db, id: string, dati: DatiIstituzione): Promise<Istituzione> {
  try {
    const r = await db.query<RigaIstituzione>(
      `UPDATE istituzioni_scolastiche SET denominazione = $2, codice_meccanografico = $3, indirizzo = $4
       WHERE id = $1
       RETURNING id, denominazione, codice_meccanografico, indirizzo`,
      [id, dati.denominazione, dati.codiceMeccanografico ?? null, dati.indirizzo ?? null],
    );
    const riga = r.rows[0];
    if (!riga) {
      throw new ErroreNonTrovato('istituzione non trovata');
    }
    return daRiga(riga);
  } catch (err) {
    if (err instanceof ErroreNonTrovato) {
      throw err;
    }
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('codice meccanografico già utilizzato');
    }
    throw err;
  }
}
