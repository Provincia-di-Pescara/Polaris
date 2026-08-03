import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

// art. B.23: la proposta provvisoria "esiste" solo dopo che il round-robin (Fase 8-9) ha
// prodotto un'elaborazione completata — nessuna scrittura su assegnazioni qui (sono già
// 'provvisoria' dal motore Go), solo la transizione di stato che la rende pubblica.
export async function pubblicaProposta(db: Db, stagioneId: string): Promise<void> {
  const stagione = await db.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  const riga = stagione.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('stagione non trovata');
  }

  const elab = await db.query(
    `SELECT 1 FROM elaborazioni WHERE stagione_id = $1 AND tipo = 'prima_assegnazione' AND stato = 'completata' LIMIT 1`,
    [stagioneId],
  );
  if ((elab.rowCount ?? 0) === 0) {
    throw new ErroreStatoNonValidoPerTransizione('nessuna elaborazione di prima assegnazione completata per questa stagione');
  }
  const r = await db.query(
    `UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1 AND stato = 'prima_assegnazione' RETURNING id`,
    [stagioneId],
  );
  if ((r.rowCount ?? 0) === 0) {
    throw new ErroreStatoNonValidoPerTransizione('la stagione non è in stato prima_assegnazione');
  }
}

export interface VocePropostaProvvisoria {
  slotId: string;
  associazioneId: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
}

interface RigaVoceProposta {
  slot_id: string;
  associazione_id: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valore_minuti: string;
  fr_finale_minuti: string | null;
  isf: string | null;
  sorteggio_id: string | null;
  articolo_riferimento: string | null;
}

// Disponibile solo dopo la pubblicazione (B.23): 'concertazione' o 'definitiva' (quando il
// blocco 4/4 chiuderà la settimana tipo definitiva, questa vista resta comunque valida
// come consultazione storica).
const STATI_STAGIONE_CON_PROPOSTA = ['concertazione', 'definitiva'];

export async function trovaPropostaProvvisoria(db: Db, stagioneId: string): Promise<VocePropostaProvvisoria[]> {
  const stagione = await db.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  const riga = stagione.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('stagione non trovata');
  }
  if (!STATI_STAGIONE_CON_PROPOSTA.includes(riga.stato)) {
    throw new ErroreStatoNonValidoPerTransizione('la proposta provvisoria non è ancora stata pubblicata per questa stagione');
  }
  const r = await db.query<RigaVoceProposta>(
    `SELECT a.slot_id, a.associazione_id, a.tipo, a.valore_minuti::text AS valore_minuti,
            fr.fr_finale_minuti::text AS fr_finale_minuti, a.isf_al_momento::text AS isf,
            so.id AS sorteggio_id, so.articolo_riferimento
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = a.domanda_id
     LEFT JOIN sorteggi so ON so.elaborazione_id = a.elaborazione_id AND so.vincitore_associazione_id = a.associazione_id
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
     ORDER BY st.giorno_settimana, st.orario_inizio`,
    [stagioneId],
  );
  return r.rows.map((v) => ({
    slotId: v.slot_id,
    associazioneId: v.associazione_id,
    tipo: v.tipo,
    valoreMinutiAssegnato: v.valore_minuti,
    fabbisognoRiconosciutoMinuti: v.fr_finale_minuti,
    isf: v.isf,
    sorteggioRiferimento: v.sorteggio_id ? { sorteggioId: v.sorteggio_id, articoloRiferimento: v.articolo_riferimento! } : null,
  }));
}
