import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { leggiVersioneAttiva } from './repository/parametrico.ts';
import {
  ErroreNonTrovato,
  ErroreStatoNonValidoPerTransizione,
  ErroreRiferimentoNonValido,
  ErroreValoreDuplicato,
} from './erroriDominio.ts';
import { trovaProprietarioOccorrenza, verificaCoerenzaOccorrenza } from './variazioni.ts';

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

interface ContestoAssegnazione {
  slot_id: string;
  associazione_id: string;
  stagione_id: string;
}

// art. B.34/B.35: la richiesta di giustificazione (primo passo della scala graduata) è
// implicita nella registrazione stessa di un esito 'non_utilizzato_non_giustificato' — non
// un atto separato. La finestra dura termine_giustificazione_giorni (parametrico attivo,
// 🔺 default 7gg) a partire da ORA, non dalla data dell'occorrenza mancata.
//
// M1 (final review) — scelta di design esplicita, NON un residuo dimenticato: il tipo enum
// 'richiesta_giustificazione' di provvedimenti_mancato_utilizzo.tipo non ha (e non deve
// avere) alcun writer in questo blocco. Il primo gradino della scala graduata B.35 è
// appunto implicito nella registrazione qui sopra — la finestra si apre da sé, l'atto
// separato non esiste. Solo i due gradini successivi (diffida, decadenza) sono atti
// amministrativi veri e passano da creaProvvedimento (provvedimenti.ts). Il valore enum
// resta nello schema per non precludere un'eventuale futura formalizzazione del primo
// gradino richiesta dall'Ente, senza migration.
//
// I1/I2 (final review) — un mancato utilizzo concorre a un atto che estingue un diritto
// (decadenza, art. B.35): prima dell'INSERT va verificato che l'occorrenza (slot, data)
// esista davvero nel calendario della stagione e che sia effettivamente imputabile
// all'associazione titolare dell'assegnazione. La titolarità di una singola occorrenza è
// MOBILE dal blocco B.32/B.33: una liberazione/scambio_temporaneo accettata la sposta,
// un'indisponibilità sopravvenuta la rende inutilizzabile per chiunque.
export async function registraUtilizzo(db: Db, dati: DatiRegistraUtilizzo): Promise<UtilizzoEffettivo> {
  const contesto = await db.query<ContestoAssegnazione>(
    `SELECT a.slot_id, a.associazione_id, st.stagione_id
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     WHERE a.id = $1`,
    [dati.assegnazioneId],
  );
  const ass = contesto.rows[0];
  if (!ass) {
    throw new ErroreNonTrovato('assegnazione non trovata');
  }

  // I2: la data deve essere un'occorrenza reale della fascia (dentro il calendario della
  // stagione e nel giorno della settimana del template) — riusa la stessa verifica di
  // variazioni.ts, un solo punto di verità.
  await verificaCoerenzaOccorrenza(db, ass.stagione_id, { slotId: ass.slot_id, data: dati.data });

  let scadeIl: Date | null = null;
  if (dati.esito === 'non_utilizzato_non_giustificato') {
    // I1(a): l'impianto era indisponibile per atto dell'Ente (art. B.33) — l'esito corretto
    // è 'indisponibilita_impianto', non un mancato imputabile all'associazione. Non lo
    // riscriviamo d'ufficio (sarebbe una decisione silenziosa su un atto sanzionatorio):
    // rifiutiamo la registrazione con un messaggio che dice quale esito usare.
    const indisponibile = await db.query(
      `SELECT 1 FROM indisponibilita_sopravvenute WHERE slot_id = $1 AND $2::date BETWEEN dal AND al LIMIT 1`,
      [ass.slot_id, dati.data],
    );
    if ((indisponibile.rowCount ?? 0) > 0) {
      throw new ErroreRiferimentoNonValido(
        `la fascia è coperta da un'indisponibilità sopravvenuta in data ${dati.data} (art. B.33): registrare l'esito 'indisponibilita_impianto', non un mancato utilizzo imputabile all'associazione`,
      );
    }
    // I1(b): la titolarità dell'occorrenza in QUELLA data può essere stata ceduta a un'altra
    // associazione (o liberata) da una variazione ordinaria accettata (art. B.32) — in quel
    // caso il titolare dell'assegnazione non doveva essere lì, e il mancato non è suo.
    const proprietario = await trovaProprietarioOccorrenza(db, ass.slot_id, dati.data);
    if (proprietario !== ass.associazione_id) {
      throw new ErroreRiferimentoNonValido(
        `in data ${dati.data} l'associazione titolare dell'assegnazione non è titolare dell'occorrenza (variazione ordinaria accettata, art. B.32): un mancato utilizzo non le è imputabile`,
      );
    }
    const parametrico = await leggiVersioneAttiva(db);
    if (!parametrico) {
      throw new Error('nessuna versione parametrica attiva');
    }
    scadeIl = new Date(Date.now() + parametrico.termineGiustificazioneGiorni * 24 * 60 * 60 * 1000);
  }
  try {
    const r = await db.query<RigaUtilizzo>(
      `INSERT INTO utilizzi_effettivi (assegnazione_id, data, esito, rilevato_tramite, note, giustificazione_scade_il)
       VALUES ($1, $2, $3, 'registro_impianto', $4, $5)
       RETURNING ${COLONNE_SELECT}`,
      [dati.assegnazioneId, dati.data, dati.esito, dati.note ?? null, scadeIl],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    // I2: utilizzi_effettivi_occorrenza_uq (migration 000016) — senza, la stessa occorrenza
    // poteva essere registrata N volte come mancato e contata N volte verso le soglie.
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('utilizzo già registrato per questa assegnazione in questa data');
    }
    throw err;
  }
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
