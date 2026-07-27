import type { Db } from './db.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

export interface Impianto {
  id: string;
  denominazione: string;
  istituzioneScolasticaId: string | null;
  indirizzo: string | null;
}

interface RigaImpianto {
  id: string;
  denominazione: string;
  istituzione_scolastica_id: string | null;
  indirizzo: string | null;
}

function daRiga(r: RigaImpianto): Impianto {
  return {
    id: r.id,
    denominazione: r.denominazione,
    istituzioneScolasticaId: r.istituzione_scolastica_id,
    indirizzo: r.indirizzo,
  };
}

export interface DatiImpianto {
  denominazione: string;
  istituzioneScolasticaId?: string;
  indirizzo?: string;
}

export async function creaImpianto(db: Db, dati: DatiImpianto): Promise<Impianto> {
  const r = await db.query<RigaImpianto>(
    `INSERT INTO impianti (denominazione, istituzione_scolastica_id, indirizzo)
     VALUES ($1, $2, $3)
     RETURNING id, denominazione, istituzione_scolastica_id, indirizzo`,
    [dati.denominazione, dati.istituzioneScolasticaId ?? null, dati.indirizzo ?? null],
  );
  return daRiga(r.rows[0]!);
}

export async function listaImpianti(db: Db, filtroIstituzioneId?: string): Promise<Impianto[]> {
  if (filtroIstituzioneId) {
    const r = await db.query<RigaImpianto>(
      `SELECT id, denominazione, istituzione_scolastica_id, indirizzo FROM impianti
       WHERE istituzione_scolastica_id = $1 ORDER BY denominazione`,
      [filtroIstituzioneId],
    );
    return r.rows.map(daRiga);
  }
  const r = await db.query<RigaImpianto>(
    `SELECT id, denominazione, istituzione_scolastica_id, indirizzo FROM impianti ORDER BY denominazione`,
  );
  return r.rows.map(daRiga);
}

export async function trovaImpiantoPerId(db: Db, id: string): Promise<Impianto | null> {
  const r = await db.query<RigaImpianto>(
    `SELECT id, denominazione, istituzione_scolastica_id, indirizzo FROM impianti WHERE id = $1`,
    [id],
  );
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function aggiornaImpianto(db: Db, id: string, dati: DatiImpianto): Promise<Impianto> {
  const r = await db.query<RigaImpianto>(
    `UPDATE impianti SET denominazione = $2, istituzione_scolastica_id = $3, indirizzo = $4
     WHERE id = $1
     RETURNING id, denominazione, istituzione_scolastica_id, indirizzo`,
    [id, dati.denominazione, dati.istituzioneScolasticaId ?? null, dati.indirizzo ?? null],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('impianto non trovato');
  }
  return daRiga(riga);
}
