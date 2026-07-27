import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

// Specifica di questo file, non condivisa: è l'unico vincolo EXCLUDE del progetto
// (art. B.3 — niente sovrapposizioni fisiche sullo stesso spazio/giorno/stagione,
// garantito a livello Postgres, non solo applicativo).
export class ErroreSovrapposizioneSlot extends Error {}

export interface SlotSettimanaTipo {
  id: string;
  stagioneId: string;
  spazioId: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
  indisponibilePermanente: boolean;
  note: string | null;
}

interface RigaSlot {
  id: string;
  stagione_id: string;
  spazio_id: string;
  giorno_settimana: number;
  orario_inizio: string;
  orario_fine: string;
  durata_minuti: number;
  pregiata: boolean;
  indisponibile_permanente: boolean;
  note: string | null;
}

function daRiga(r: RigaSlot): SlotSettimanaTipo {
  return {
    id: r.id,
    stagioneId: r.stagione_id,
    spazioId: r.spazio_id,
    giornoSettimana: r.giorno_settimana,
    orarioInizio: r.orario_inizio,
    orarioFine: r.orario_fine,
    durataMinuti: r.durata_minuti,
    pregiata: r.pregiata,
    indisponibilePermanente: r.indisponibile_permanente,
    note: r.note,
  };
}

const COLONNE_SELECT = `id, stagione_id, spazio_id, giorno_settimana,
  to_char(orario_inizio, 'HH24:MI') AS orario_inizio,
  to_char(orario_fine, 'HH24:MI') AS orario_fine,
  durata_minuti, pregiata, indisponibile_permanente, note`;

export interface DatiCreaSlot {
  stagioneId: string;
  spazioId: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  // `| undefined` esplicito: vedi commento analogo in istituzioni.ts (stesso motivo,
  // exactOptionalPropertyTypes vs output opzionale di zod).
  pregiata?: boolean | undefined;
  indisponibilePermanente?: boolean | undefined;
  note?: string | undefined;
}

export async function creaSlot(db: Db, dati: DatiCreaSlot): Promise<SlotSettimanaTipo> {
  try {
    const r = await db.query<RigaSlot>(
      `INSERT INTO slot_settimana_tipo
         (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine, pregiata, indisponibile_permanente, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLONNE_SELECT}`,
      [
        dati.stagioneId,
        dati.spazioId,
        dati.giornoSettimana,
        dati.orarioInizio,
        dati.orarioFine,
        dati.pregiata ?? false,
        dati.indisponibilePermanente ?? false,
        dati.note ?? null,
      ],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23P01') {
      throw new ErroreSovrapposizioneSlot('la fascia si sovrappone a un\'altra già esistente sullo stesso spazio/giorno/stagione');
    }
    throw err;
  }
}

export async function listaSlotPerStagione(db: Db, stagioneId: string, filtroSpazioId?: string): Promise<SlotSettimanaTipo[]> {
  if (filtroSpazioId) {
    const r = await db.query<RigaSlot>(
      `SELECT ${COLONNE_SELECT} FROM slot_settimana_tipo
       WHERE stagione_id = $1 AND spazio_id = $2
       ORDER BY giorno_settimana, orario_inizio`,
      [stagioneId, filtroSpazioId],
    );
    return r.rows.map(daRiga);
  }
  const r = await db.query<RigaSlot>(
    `SELECT ${COLONNE_SELECT} FROM slot_settimana_tipo WHERE stagione_id = $1 ORDER BY giorno_settimana, orario_inizio`,
    [stagioneId],
  );
  return r.rows.map(daRiga);
}

export async function trovaSlotPerId(db: Db, id: string): Promise<SlotSettimanaTipo | null> {
  const r = await db.query<RigaSlot>(`SELECT ${COLONNE_SELECT} FROM slot_settimana_tipo WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export interface DatiAggiornaSlot {
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  pregiata: boolean;
  indisponibilePermanente: boolean;
  note?: string | undefined;
}

export async function aggiornaSlot(db: Db, id: string, dati: DatiAggiornaSlot): Promise<SlotSettimanaTipo> {
  try {
    const r = await db.query<RigaSlot>(
      `UPDATE slot_settimana_tipo
       SET giorno_settimana = $2, orario_inizio = $3, orario_fine = $4, pregiata = $5,
           indisponibile_permanente = $6, note = $7
       WHERE id = $1
       RETURNING ${COLONNE_SELECT}`,
      [id, dati.giornoSettimana, dati.orarioInizio, dati.orarioFine, dati.pregiata, dati.indisponibilePermanente, dati.note ?? null],
    );
    const riga = r.rows[0];
    if (!riga) {
      throw new ErroreNonTrovato('slot non trovato');
    }
    return daRiga(riga);
  } catch (err) {
    if (err instanceof ErroreNonTrovato) {
      throw err;
    }
    if (err instanceof DatabaseError && err.code === '23P01') {
      throw new ErroreSovrapposizioneSlot('la fascia si sovrappone a un\'altra già esistente sullo stesso spazio/giorno/stagione');
    }
    throw err;
  }
}
