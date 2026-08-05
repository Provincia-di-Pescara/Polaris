import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

// art. B.30: approva il quadro definitivo. Nessuna precondizione oltre lo stato — la
// riassegnazione residua (art. B.29) è un'azione discrezionale separata, non un
// prerequisito rigido (l'admin può approvare anche senza rieseguirla se non restano
// fasce libere da assegnare).
export async function approvaSettimanaTipoDefinitiva(
  db: Db,
  stagioneId: string,
): Promise<{ convenzioniCreate: number; assegnazioniSenzaIstituzioneSaltate: number }> {
  const r = await db.query(
    `UPDATE stagioni_sportive SET stato = 'definitiva' WHERE id = $1 AND stato = 'concertazione' RETURNING id`,
    [stagioneId],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('stagione non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la stagione non è in fase di concertazione');
  }

  // art. B.31: l'efficacia di ciascuna assegnazione presso una palestra scolastica è
  // subordinata al perfezionamento della convenzione — una riga 'in_attesa' per ogni
  // assegnazione attiva che non ne ha già una (copre singola/blocco_allenamento/
  // blocco_gara, B.31 non distingue per tipo). NOT EXISTS la rende idempotente: una
  // riapprovazione non duplica le convenzioni già create.
  // `impianti.istituzione_scolastica_id` è NULLABLE (un impianto può legittimamente
  // esistere senza istituzione assegnata, il CRUD lo permette) mentre
  // `convenzioni.istituzione_scolastica_id` è NOT NULL — senza il filtro esplicito
  // l'INSERT...SELECT falliva con una violazione NOT NULL grezza (23502) non appena una
  // sola assegnazione attiva ricadeva su un impianto del genere, portando al ROLLBACK
  // dell'intera transazione di approvazione (trovato dalla final review, verificato
  // empiricamente contro Postgres reale). Le assegnazioni filtrate qui semplicemente non
  // ricevono una convenzione (art. B.31 parla di efficacia "presso una palestra
  // scolastica" — un impianto senza istituzione non ne ha una), non bloccano l'approvazione.
  const convenzioni = await db.query(
    `INSERT INTO convenzioni (assegnazione_id, istituzione_scolastica_id)
     SELECT a.id, i.istituzione_scolastica_id
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = st.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
       AND i.istituzione_scolastica_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM convenzioni c WHERE c.assegnazione_id = a.id)
     RETURNING id`,
    [stagioneId],
  );

  const saltate = await db.query<{ count: string }>(
    `SELECT count(*)::text
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = st.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
       AND i.istituzione_scolastica_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM convenzioni c WHERE c.assegnazione_id = a.id)`,
    [stagioneId],
  );

  return {
    convenzioniCreate: convenzioni.rowCount ?? 0,
    assegnazioniSenzaIstituzioneSaltate: Number(saltate.rows[0]!.count),
  };
}

export interface VoceSettimanaTipoDefinitiva {
  slotId: string;
  associazioneId: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
  concertazioneProposaId: string | null;
  efficace: boolean;
}

interface RigaVoceDefinitiva {
  slot_id: string;
  associazione_id: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valore_minuti: string;
  fr_finale_minuti: string | null;
  isf: string | null;
  sorteggio_id: string | null;
  articolo_riferimento: string | null;
  concertazione_proposta_id: string | null;
  efficace: boolean;
}

const STATI_STAGIONE_CON_DEFINITIVA = ['definitiva', 'chiusa'];

// art. B.30-31: stessa query di propostaProvvisoria.ts::trovaPropostaProvvisoria (ISF
// cumulativo via window function, LATERAL su sorteggi per evitare fan-out — vedi i
// commenti lì per il ragionamento completo, non ripetuto qui), estesa con il riferimento
// all'accordo di concertazione (se la fascia deriva da uno scambio validato) e
// l'efficacia (B.31: subordinata al perfezionamento della convenzione).
export async function trovaSettimanaTipoDefinitiva(
  db: Db,
  stagioneId: string,
): Promise<{ fasce: VoceSettimanaTipoDefinitiva[]; slotLiberi: string[] }> {
  const stagione = await db.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  const riga = stagione.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('stagione non trovata');
  }
  if (!STATI_STAGIONE_CON_DEFINITIVA.includes(riga.stato)) {
    throw new ErroreStatoNonValidoPerTransizione('la settimana tipo definitiva non è ancora stata approvata per questa stagione');
  }

  const fasce = await db.query<RigaVoceDefinitiva>(
    `SELECT a.slot_id, a.associazione_id, a.tipo, a.valore_minuti::text AS valore_minuti,
            fr.fr_finale_minuti::text AS fr_finale_minuti,
            (CASE WHEN fr.fr_finale_minuti IS NULL OR fr.fr_finale_minuti = 0 THEN NULL
                  ELSE ROUND(SUM(a.valore_minuti) OVER (PARTITION BY a.associazione_id) / fr.fr_finale_minuti, 3) END)::text AS isf,
            so.id AS sorteggio_id, so.articolo_riferimento,
            a.concertazione_proposta_id,
            COALESCE(c.stato = 'perfezionata', false) AS efficace
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = a.domanda_id
     LEFT JOIN LATERAL (
       SELECT id, articolo_riferimento FROM sorteggi
       WHERE elaborazione_id = a.elaborazione_id AND vincitore_associazione_id = a.associazione_id
       ORDER BY seme_generato_il ASC LIMIT 1
     ) so ON true
     LEFT JOIN convenzioni c ON c.assegnazione_id = a.id
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
     ORDER BY st.giorno_settimana, st.orario_inizio`,
    [stagioneId],
  );

  const slotLiberi = await db.query<{ id: string }>(
    `SELECT st.id FROM slot_settimana_tipo st
     WHERE st.stagione_id = $1 AND st.indisponibile_permanente = false
       AND NOT EXISTS (SELECT 1 FROM assegnazioni a WHERE a.slot_id = st.id AND a.stato IN ('provvisoria', 'validata'))
     ORDER BY st.giorno_settimana, st.orario_inizio`,
    [stagioneId],
  );

  return {
    fasce: fasce.rows.map((v) => ({
      slotId: v.slot_id,
      associazioneId: v.associazione_id,
      tipo: v.tipo,
      valoreMinutiAssegnato: v.valore_minuti,
      fabbisognoRiconosciutoMinuti: v.fr_finale_minuti,
      isf: v.isf,
      sorteggioRiferimento: v.sorteggio_id ? { sorteggioId: v.sorteggio_id, articoloRiferimento: v.articolo_riferimento! } : null,
      concertazioneProposaId: v.concertazione_proposta_id,
      efficace: v.efficace,
    })),
    slotLiberi: slotLiberi.rows.map((r) => r.id),
  };
}
