import type { Pool } from 'pg';
import type { Db } from './db.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

export interface SpazioSportivo {
  id: string;
  impiantoId: string;
  denominazione: string;
  omologazioni: string[];
  note: string | null;
  disciplineCompatibili: string[];
}

interface RigaSpazio {
  id: string;
  impianto_id: string;
  denominazione: string;
  omologazioni: string[] | null;
  note: string | null;
}

async function disciplineCompatibiliDi(db: Db, spazioId: string): Promise<string[]> {
  const r = await db.query<{ disciplina_codice: string }>(
    `SELECT disciplina_codice FROM spazio_disciplina_compatibile WHERE spazio_id = $1 ORDER BY disciplina_codice`,
    [spazioId],
  );
  return r.rows.map((riga) => riga.disciplina_codice);
}

async function sostituisciDisciplineCompatibili(db: Db, spazioId: string, codici: string[]): Promise<void> {
  await db.query(`DELETE FROM spazio_disciplina_compatibile WHERE spazio_id = $1`, [spazioId]);
  for (const codice of codici) {
    await db.query(
      `INSERT INTO spazio_disciplina_compatibile (spazio_id, disciplina_codice) VALUES ($1, $2)`,
      [spazioId, codice],
    );
  }
}

export interface DatiCreaSpazio {
  impiantoId: string;
  denominazione: string;
  // `| undefined` esplicito: vedi commento analogo in istituzioni.ts (stesso motivo,
  // exactOptionalPropertyTypes vs output opzionale di zod).
  omologazioni?: string[] | undefined;
  note?: string | undefined;
  disciplineCompatibili?: string[] | undefined;
}

export interface DatiAggiornaSpazio {
  denominazione: string;
  omologazioni?: string[] | undefined;
  note?: string | undefined;
  disciplineCompatibili?: string[] | undefined;
}

// creaSpazio/aggiornaSpazio accettano Pool (non il generico Db degli altri repository di
// questo blocco) perché devono aprire una PROPRIA transazione: la riga in spazi_sportivi e
// le righe in spazio_disciplina_compatibile (join table) sono scritte con DELETE+N INSERT
// separati, e senza atomicità un INSERT fallito a metà (es. codice disciplina inesistente,
// FK violation) lascerebbe lo spazio con un set di discipline parziale o — nel caso
// dell'update — le associazioni preesistenti già cancellate dalla DELETE ma mai
// ripristinate. `pool.connect()` dà un client dedicato su cui girano BEGIN/COMMIT/ROLLBACK;
// le funzioni di supporto sopra restano genericamente su `Db` così il client soddisfa
// comunque la loro firma.
export async function creaSpazio(pool: Pool, dati: DatiCreaSpazio): Promise<SpazioSportivo> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<RigaSpazio>(
      `INSERT INTO spazi_sportivi (impianto_id, denominazione, omologazioni, note)
       VALUES ($1, $2, $3, $4)
       RETURNING id, impianto_id, denominazione, omologazioni, note`,
      [dati.impiantoId, dati.denominazione, dati.omologazioni ?? [], dati.note ?? null],
    );
    const riga = r.rows[0]!;
    const disciplineCompatibili = dati.disciplineCompatibili ?? [];
    if (disciplineCompatibili.length > 0) {
      await sostituisciDisciplineCompatibili(client, riga.id, disciplineCompatibili);
    }
    await client.query('COMMIT');
    return {
      id: riga.id,
      impiantoId: riga.impianto_id,
      denominazione: riga.denominazione,
      omologazioni: riga.omologazioni ?? [],
      note: riga.note,
      disciplineCompatibili,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listaSpaziPerImpianto(db: Db, impiantoId: string): Promise<SpazioSportivo[]> {
  const r = await db.query<RigaSpazio>(
    `SELECT id, impianto_id, denominazione, omologazioni, note FROM spazi_sportivi
     WHERE impianto_id = $1 ORDER BY denominazione`,
    [impiantoId],
  );
  const out: SpazioSportivo[] = [];
  for (const riga of r.rows) {
    out.push({
      id: riga.id,
      impiantoId: riga.impianto_id,
      denominazione: riga.denominazione,
      omologazioni: riga.omologazioni ?? [],
      note: riga.note,
      disciplineCompatibili: await disciplineCompatibiliDi(db, riga.id),
    });
  }
  return out;
}

export async function trovaSpazioPerId(db: Db, id: string): Promise<SpazioSportivo | null> {
  const r = await db.query<RigaSpazio>(
    `SELECT id, impianto_id, denominazione, omologazioni, note FROM spazi_sportivi WHERE id = $1`,
    [id],
  );
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return {
    id: riga.id,
    impiantoId: riga.impianto_id,
    denominazione: riga.denominazione,
    omologazioni: riga.omologazioni ?? [],
    note: riga.note,
    disciplineCompatibili: await disciplineCompatibiliDi(db, riga.id),
  };
}

export async function aggiornaSpazio(pool: Pool, id: string, dati: DatiAggiornaSpazio): Promise<SpazioSportivo> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // omologazioni segue LO STESSO principio "ometti per preservare" di
    // disciplineCompatibili sotto (era inconsistente prima: l'omissione svuotava
    // silenziosamente l'array invece di lasciare la colonna invariata) — colonna nella SET
    // solo se il campo è stato esplicitamente inviato dal client.
    const r =
      dati.omologazioni !== undefined
        ? await client.query<RigaSpazio>(
            `UPDATE spazi_sportivi SET denominazione = $2, omologazioni = $3, note = $4
             WHERE id = $1
             RETURNING id, impianto_id, denominazione, omologazioni, note`,
            [id, dati.denominazione, dati.omologazioni, dati.note ?? null],
          )
        : await client.query<RigaSpazio>(
            `UPDATE spazi_sportivi SET denominazione = $2, note = $3
             WHERE id = $1
             RETURNING id, impianto_id, denominazione, omologazioni, note`,
            [id, dati.denominazione, dati.note ?? null],
          );
    const riga = r.rows[0];
    if (!riga) {
      throw new ErroreNonTrovato('spazio sportivo non trovato');
    }
    if (dati.disciplineCompatibili !== undefined) {
      await sostituisciDisciplineCompatibili(client, id, dati.disciplineCompatibili);
    }
    const risultato: SpazioSportivo = {
      id: riga.id,
      impiantoId: riga.impianto_id,
      denominazione: riga.denominazione,
      omologazioni: riga.omologazioni ?? [],
      note: riga.note,
      disciplineCompatibili: await disciplineCompatibiliDi(client, id),
    };
    await client.query('COMMIT');
    return risultato;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
