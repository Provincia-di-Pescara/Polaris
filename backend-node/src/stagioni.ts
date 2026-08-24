import { DatabaseError, type Pool } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato, ErroreStagioneNonModificabile } from './erroriDominio.ts';

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

// Solo le 4 tabelle davvero legate a calendario/avanzamento procedurale bloccano
// modifica/eliminazione -- deliberatamente ESCLUSE abilitazioni e
// associazioni_documenti: sono contorno amministrativo per-stagione che
// un'associazione già iscritta riattiva/ricarica di routine ad ogni stagione,
// non un vincolo reale sulle date. slot_settimana_tipo/domande/elaborazioni/
// concertazione_proposte referenziano invece calendario e risultati reali del
// motore -- toccarli a posteriori invaliderebbe dati concreti.
async function haStagioneDatiLoadBearing(db: Db, id: string): Promise<boolean> {
  const r = await db.query<{ ha_dati: boolean }>(
    `SELECT
       EXISTS(SELECT 1 FROM slot_settimana_tipo WHERE stagione_id = $1)
       OR EXISTS(SELECT 1 FROM domande WHERE stagione_id = $1)
       OR EXISTS(SELECT 1 FROM elaborazioni WHERE stagione_id = $1)
       OR EXISTS(SELECT 1 FROM concertazione_proposte WHERE stagione_id = $1)
       AS ha_dati`,
    [id],
  );
  return r.rows[0]!.ha_dati;
}

async function verificaStagioneModificabile(db: Db, id: string): Promise<void> {
  const r = await db.query<{ stato: string }>('SELECT stato FROM stagioni_sportive WHERE id = $1', [id]);
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreStagioneNonModificabile('stagione non trovata');
  }
  if (riga.stato !== 'censimento') {
    throw new ErroreStagioneNonModificabile(
      `la stagione non è più in stato "censimento" (attuale: "${riga.stato}") -- date/nome non sono più modificabili`,
    );
  }
  if (await haStagioneDatiLoadBearing(db, id)) {
    throw new ErroreStagioneNonModificabile(
      'la stagione ha già slot/domande/elaborazioni/proposte collegate -- non più modificabile',
    );
  }
}

export type DatiAggiornaStagione = DatiCreaStagione;

export async function aggiornaStagione(db: Db, id: string, dati: DatiAggiornaStagione): Promise<Stagione> {
  await verificaStagioneModificabile(db, id);
  try {
    const r = await db.query<RigaStagione>(
      `UPDATE stagioni_sportive SET nome = $2, data_inizio = $3, data_fine = $4
       WHERE id = $1
       RETURNING id, nome, data_inizio::text, data_fine::text, stato`,
      [id, dati.nome, dati.dataInizio, dati.dataFine],
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

export async function eliminaStagione(db: Db, id: string): Promise<void> {
  await verificaStagioneModificabile(db, id);
  await db.query('DELETE FROM stagioni_sportive WHERE id = $1', [id]);
}
