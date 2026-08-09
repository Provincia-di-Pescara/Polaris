import type { Db } from './db.ts';
import { leggiVersioneAttiva } from './repository/parametrico.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

export type EsitoUtilizzo = 'utilizzato' | 'non_utilizzato_giustificato' | 'non_utilizzato_non_giustificato' | 'indisponibilita_impianto';
export type RilevatoTramite = 'registro_impianto' | 'autodichiarazione' | 'checkin_digitale';

export interface UtilizzoEffettivo {
  id: string;
  assegnazioneId: string;
  data: string;
  esito: EsitoUtilizzo;
  rilevatoTramite: RilevatoTramite;
  note: string | null;
  registratoIl: string;
  giustificazioneScadeIl: string | null;
  giustificazioneTesto: string | null;
  giustificazionePresentataIl: string | null;
  giustificazioneDecisaDa: string | null;
  giustificazioneDecisaIl: string | null;
  giustificazioneMotivazioneRigetto: string | null;
}

interface RigaUtilizzo {
  id: string;
  assegnazione_id: string;
  data: string;
  esito: EsitoUtilizzo;
  rilevato_tramite: RilevatoTramite;
  note: string | null;
  registrato_il: Date;
  giustificazione_scade_il: Date | null;
  giustificazione_testo: string | null;
  giustificazione_presentata_il: Date | null;
  giustificazione_decisa_da: string | null;
  giustificazione_decisa_il: Date | null;
  giustificazione_motivazione_rigetto: string | null;
}

const COLONNE_SELECT = `id, assegnazione_id, data::text, esito, rilevato_tramite, note, registrato_il,
  giustificazione_scade_il, giustificazione_testo, giustificazione_presentata_il,
  giustificazione_decisa_da, giustificazione_decisa_il, giustificazione_motivazione_rigetto`;

function daRiga(r: RigaUtilizzo): UtilizzoEffettivo {
  return {
    id: r.id,
    assegnazioneId: r.assegnazione_id,
    data: r.data,
    esito: r.esito,
    rilevatoTramite: r.rilevato_tramite,
    note: r.note,
    registratoIl: r.registrato_il.toISOString(),
    giustificazioneScadeIl: r.giustificazione_scade_il ? r.giustificazione_scade_il.toISOString() : null,
    giustificazioneTesto: r.giustificazione_testo,
    giustificazionePresentataIl: r.giustificazione_presentata_il ? r.giustificazione_presentata_il.toISOString() : null,
    giustificazioneDecisaDa: r.giustificazione_decisa_da,
    giustificazioneDecisaIl: r.giustificazione_decisa_il ? r.giustificazione_decisa_il.toISOString() : null,
    giustificazioneMotivazioneRigetto: r.giustificazione_motivazione_rigetto,
  };
}

export interface DatiRegistraUtilizzo {
  assegnazioneId: string;
  data: string;
  esito: EsitoUtilizzo;
  note?: string | undefined;
}

// art. B.34/B.35: la richiesta di giustificazione (primo passo della scala graduata) è
// implicita nella registrazione stessa di un esito 'non_utilizzato_non_giustificato' — non
// un atto separato. La finestra dura termine_giustificazione_giorni (parametrico attivo,
// 🔺 default 7gg) a partire da ORA, non dalla data dell'occorrenza mancata.
export async function registraUtilizzo(db: Db, dati: DatiRegistraUtilizzo): Promise<UtilizzoEffettivo> {
  let scadeIl: Date | null = null;
  if (dati.esito === 'non_utilizzato_non_giustificato') {
    const parametrico = await leggiVersioneAttiva(db);
    if (!parametrico) {
      throw new Error('nessuna versione parametrica attiva');
    }
    scadeIl = new Date(Date.now() + parametrico.termineGiustificazioneGiorni * 24 * 60 * 60 * 1000);
  }
  const r = await db.query<RigaUtilizzo>(
    `INSERT INTO utilizzi_effettivi (assegnazione_id, data, esito, rilevato_tramite, note, giustificazione_scade_il)
     VALUES ($1, $2, $3, 'registro_impianto', $4, $5)
     RETURNING ${COLONNE_SELECT}`,
    [dati.assegnazioneId, dati.data, dati.esito, dati.note ?? null, scadeIl],
  );
  return daRiga(r.rows[0]!);
}

export async function trovaUtilizzoPerId(db: Db, id: string): Promise<UtilizzoEffettivo | null> {
  const r = await db.query<RigaUtilizzo>(`SELECT ${COLONNE_SELECT} FROM utilizzi_effettivi WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function listaUtilizziPerAssegnazione(db: Db, assegnazioneId: string): Promise<UtilizzoEffettivo[]> {
  const r = await db.query<RigaUtilizzo>(
    `SELECT ${COLONNE_SELECT} FROM utilizzi_effettivi WHERE assegnazione_id = $1 ORDER BY data DESC`,
    [assegnazioneId],
  );
  return r.rows.map(daRiga);
}

export async function listaUtilizziPerAssociazione(db: Db, associazioneId: string, stagioneId?: string): Promise<UtilizzoEffettivo[]> {
  const colonne = `ue.id, ue.assegnazione_id, ue.data::text, ue.esito, ue.rilevato_tramite, ue.note, ue.registrato_il,
    ue.giustificazione_scade_il, ue.giustificazione_testo, ue.giustificazione_presentata_il,
    ue.giustificazione_decisa_da, ue.giustificazione_decisa_il, ue.giustificazione_motivazione_rigetto`;
  const r = stagioneId
    ? await db.query<RigaUtilizzo>(
        `SELECT ${colonne}
         FROM utilizzi_effettivi ue
         JOIN assegnazioni a ON a.id = ue.assegnazione_id
         JOIN slot_settimana_tipo st ON st.id = a.slot_id
         WHERE a.associazione_id = $1 AND st.stagione_id = $2
         ORDER BY ue.data DESC`,
        [associazioneId, stagioneId],
      )
    : await db.query<RigaUtilizzo>(
        `SELECT ${colonne}
         FROM utilizzi_effettivi ue
         JOIN assegnazioni a ON a.id = ue.assegnazione_id
         WHERE a.associazione_id = $1
         ORDER BY ue.data DESC`,
        [associazioneId],
      );
  return r.rows.map(daRiga);
}

// art. B.35: la finestra si apre alla registrazione (Task 3) e si chiude alla prima tra
// scadenza e presentazione — guardia atomica UPDATE...WHERE...RETURNING (pattern TOCTOU-
// safe consolidato nel progetto), un SELECT di disambiguazione separato solo sul percorso
// di fallimento per distinguere 404 da 409.
export async function presentaGiustificazione(db: Db, id: string, testo: string): Promise<UtilizzoEffettivo> {
  const r = await db.query<{ id: string }>(
    `UPDATE utilizzi_effettivi
     SET giustificazione_testo = $2, giustificazione_presentata_il = now()
     WHERE id = $1 AND esito = 'non_utilizzato_non_giustificato'
       AND giustificazione_presentata_il IS NULL AND giustificazione_scade_il > now()
     RETURNING id`,
    [id, testo],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM utilizzi_effettivi WHERE id = $1`, [id]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('utilizzo non trovato');
    }
    throw new ErroreStatoNonValidoPerTransizione('finestra di giustificazione non aperta, già presentata o scaduta');
  }
  return (await trovaUtilizzoPerId(db, id))!;
}

export async function accogliGiustificazione(db: Db, id: string, decisoreId: string): Promise<UtilizzoEffettivo> {
  const r = await db.query<{ id: string }>(
    `UPDATE utilizzi_effettivi
     SET esito = 'non_utilizzato_giustificato', giustificazione_decisa_da = $2, giustificazione_decisa_il = now()
     WHERE id = $1 AND giustificazione_presentata_il IS NOT NULL AND giustificazione_decisa_il IS NULL
     RETURNING id`,
    [id, decisoreId],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM utilizzi_effettivi WHERE id = $1`, [id]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('utilizzo non trovato');
    }
    throw new ErroreStatoNonValidoPerTransizione('nessuna giustificazione presentata da decidere, o già decisa');
  }
  return (await trovaUtilizzoPerId(db, id))!;
}

export async function rigettaGiustificazione(db: Db, id: string, decisoreId: string, motivazione: string): Promise<UtilizzoEffettivo> {
  const r = await db.query<{ id: string }>(
    `UPDATE utilizzi_effettivi
     SET giustificazione_decisa_da = $2, giustificazione_decisa_il = now(), giustificazione_motivazione_rigetto = $3
     WHERE id = $1 AND giustificazione_presentata_il IS NOT NULL AND giustificazione_decisa_il IS NULL
     RETURNING id`,
    [id, decisoreId, motivazione],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM utilizzi_effettivi WHERE id = $1`, [id]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('utilizzo non trovato');
    }
    throw new ErroreStatoNonValidoPerTransizione('nessuna giustificazione presentata da decidere, o già decisa');
  }
  return (await trovaUtilizzoPerId(db, id))!;
}
