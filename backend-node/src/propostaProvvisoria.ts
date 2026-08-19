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
  associazioneDenominazione: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

interface RigaVoceProposta {
  slot_id: string;
  associazione_id: string;
  associazione_denominazione: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valore_minuti: string;
  fr_finale_minuti: string | null;
  isf: string | null;
  sorteggio_id: string | null;
  articolo_riferimento: string | null;
  impianto_denominazione: string;
  spazio_denominazione: string;
  giorno_settimana: number;
  orario_inizio: string;
  orario_fine: string;
  durata_minuti: number;
  pregiata: boolean;
}

// I2 (final review): frammento SQL condiviso con settimanaTipoDefinitiva.ts::
// trovaSettimanaTipoDefinitiva, che ha la stessa identica esigenza (ISF cumulativo +
// riferimento al sorteggio) estesa con le proprie colonne (concertazione_proposta_id,
// efficacia). Prima di questa estrazione le ~25 righe sotto erano duplicate verbatim nei
// due file — un fix futuro su questa logica avrebbe dovuto essere trovato e applicato in
// entrambi i posti separatamente. Le colonne selezionate qui (fr_finale_minuti, isf,
// sorteggio_id, articolo_riferimento) e i JOIN richiesti vanno sempre usati insieme.
//
// ISF = VA/FR (art. A.13). VA è il valore CUMULATIVO assegnato all'associazione su tutte
// le sue assegnazioni attive nella stagione (stessa definizione del motore Go,
// engine-go/internal/postgres/assegnazione.go::caricaStatoIniziale), non il valore_minuti
// della singola riga — un'associazione con più slot deve mostrare lo stesso ISF cumulativo
// su ciascuna delle proprie righe, non un ISF sotto-stimato per riga. La window function
// somma solo sulle righe già filtrate da WHERE/JOIN della query che include questo
// frammento (stato IN ('provvisoria','validata') per la stagione), non sulla tabella
// intera: opera sul result-set dopo il filtro, non prima.
// Calcolato qui e non letto da assegnazioni.isf_al_momento (colonna mai scritta dal motore
// Go, sempre NULL in pratica — vedi CLAUDE.md). FR=0 => ISF non definito (regola di
// dominio consolidata, mai divisione per zero). FR è stabile per associazione in questa
// query (un'unica domanda per associazione per stagione, vedi
// domande_associazione_stagione_uq), quindi dividere la VA cumulativa per il FR di una
// qualunque riga dell'associazione è sicuro.
export const COLONNE_ISF_SORTEGGIO = `fr.fr_finale_minuti::text AS fr_finale_minuti,
            (CASE WHEN fr.fr_finale_minuti IS NULL OR fr.fr_finale_minuti = 0 THEN NULL
                  ELSE ROUND(SUM(a.valore_minuti) OVER (PARTITION BY a.associazione_id) / fr.fr_finale_minuti, 3) END)::text AS isf,
            so.id AS sorteggio_id, so.articolo_riferimento`;

// LATERAL con LIMIT 1: la tabella sorteggi non ha un discriminatore per-slot/fascia, solo
// (elaborazione_id, vincitore_associazione_id). Se un'associazione vince più sorteggi
// nella stessa elaborazione, questo riferimento ne mostra uno arbitrario (il più vecchio
// per seme generato) — limite noto, non un cambio di schema in questa fix wave. Senza
// LATERAL, il JOIN diretto duplicava ogni riga di assegnazione una volta per sorteggio
// vinto dalla stessa associazione nella stessa elaborazione.
export const JOIN_ISF_SORTEGGIO = `LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = a.domanda_id
     LEFT JOIN LATERAL (
       SELECT id, articolo_riferimento FROM sorteggi
       WHERE elaborazione_id = a.elaborazione_id AND vincitore_associazione_id = a.associazione_id
       ORDER BY seme_generato_il ASC LIMIT 1
     ) so ON true`;

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
    `SELECT a.slot_id, a.associazione_id, ass.denominazione AS associazione_denominazione,
            a.tipo, a.valore_minuti::text AS valore_minuti,
            ${COLONNE_ISF_SORTEGGIO},
            i.denominazione AS impianto_denominazione, sp.denominazione AS spazio_denominazione,
            st.giorno_settimana, to_char(st.orario_inizio, 'HH24:MI') AS orario_inizio,
            to_char(st.orario_fine, 'HH24:MI') AS orario_fine, st.durata_minuti, st.pregiata
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = st.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     JOIN associazioni ass ON ass.id = a.associazione_id
     ${JOIN_ISF_SORTEGGIO}
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
     ORDER BY st.giorno_settimana, st.orario_inizio`,
    [stagioneId],
  );
  return r.rows.map((v) => ({
    slotId: v.slot_id,
    associazioneId: v.associazione_id,
    associazioneDenominazione: v.associazione_denominazione,
    tipo: v.tipo,
    valoreMinutiAssegnato: v.valore_minuti,
    fabbisognoRiconosciutoMinuti: v.fr_finale_minuti,
    isf: v.isf,
    sorteggioRiferimento: v.sorteggio_id ? { sorteggioId: v.sorteggio_id, articoloRiferimento: v.articolo_riferimento! } : null,
    impiantoDenominazione: v.impianto_denominazione,
    spazioDenominazione: v.spazio_denominazione,
    giornoSettimana: v.giorno_settimana,
    orarioInizio: v.orario_inizio,
    orarioFine: v.orario_fine,
    durataMinuti: v.durata_minuti,
    pregiata: v.pregiata,
  }));
}
