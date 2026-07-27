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
  omologazioni?: string[];
  note?: string;
  disciplineCompatibili?: string[];
}

export interface DatiAggiornaSpazio {
  denominazione: string;
  omologazioni?: string[];
  note?: string;
  disciplineCompatibili?: string[];
}

export async function creaSpazio(db: Db, dati: DatiCreaSpazio): Promise<SpazioSportivo> {
  const r = await db.query<RigaSpazio>(
    `INSERT INTO spazi_sportivi (impianto_id, denominazione, omologazioni, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id, impianto_id, denominazione, omologazioni, note`,
    [dati.impiantoId, dati.denominazione, dati.omologazioni ?? [], dati.note ?? null],
  );
  const riga = r.rows[0]!;
  const disciplineCompatibili = dati.disciplineCompatibili ?? [];
  if (disciplineCompatibili.length > 0) {
    await sostituisciDisciplineCompatibili(db, riga.id, disciplineCompatibili);
  }
  return {
    id: riga.id,
    impiantoId: riga.impianto_id,
    denominazione: riga.denominazione,
    omologazioni: riga.omologazioni ?? [],
    note: riga.note,
    disciplineCompatibili,
  };
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

export async function aggiornaSpazio(db: Db, id: string, dati: DatiAggiornaSpazio): Promise<SpazioSportivo> {
  const r = await db.query<RigaSpazio>(
    `UPDATE spazi_sportivi SET denominazione = $2, omologazioni = $3, note = $4
     WHERE id = $1
     RETURNING id, impianto_id, denominazione, omologazioni, note`,
    [id, dati.denominazione, dati.omologazioni ?? [], dati.note ?? null],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('spazio sportivo non trovato');
  }
  if (dati.disciplineCompatibili !== undefined) {
    await sostituisciDisciplineCompatibili(db, id, dati.disciplineCompatibili);
  }
  return {
    id: riga.id,
    impiantoId: riga.impianto_id,
    denominazione: riga.denominazione,
    omologazioni: riga.omologazioni ?? [],
    note: riga.note,
    disciplineCompatibili: await disciplineCompatibiliDi(db, id),
  };
}
