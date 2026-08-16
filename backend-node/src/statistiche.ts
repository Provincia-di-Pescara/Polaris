import type { Db } from './db.ts';

export interface VoceDisciplina {
  disciplinaCodice: string;
  disciplinaDenominazione: string;
  minuti: string;
}

export interface VoceImpianto {
  impiantoId: string;
  impiantoDenominazione: string;
  tassoUtilizzoPct: string | null;
}

export interface StatisticheStagione {
  tassoUtilizzoImpiantiPct: string | null;
  fascePregiateAssegnatePct: string | null;
  isfMedioAssociazioni: string | null;
  sociAtletiCoinvolti: number;
  distribuzioneMinutiPerDisciplina: VoceDisciplina[];
  saturazionePerImpianto: VoceImpianto[];
}

interface RigaUtilizzoGlobale {
  tasso_utilizzo_impianti_pct: string | null;
  fasce_pregiate_assegnate_pct: string | null;
}

interface RigaIsfMedio {
  isf_medio_associazioni: string | null;
}

interface RigaSociAtleti {
  soci_atleti_coinvolti: number;
}

interface RigaDisciplina {
  disciplina_codice: string;
  disciplina_denominazione: string;
  minuti: string;
}

interface RigaImpianto {
  impianto_id: string;
  impianto_denominazione: string;
  tasso_utilizzo_pct: string | null;
}

// KPI 1+2: minuti GREZZI (durata_minuti), mai valore_minuti (ponderato per le
// fasce pregiate, vedi Global Constraints) — numeratore e denominatore devono
// stare sulla stessa base o il rapporto è falsato silenziosamente. Una CTE
// unica calcola i 4 totali in una scansione sola, poi il SELECT esterno
// applica il rapporto con guardia divisione-per-zero (stagione senza slot, o
// senza fasce pregiate: entrambi casi reali per una stagione appena creata).
async function leggiUtilizzoGlobale(db: Db, stagioneId: string): Promise<RigaUtilizzoGlobale> {
  const r = await db.query<RigaUtilizzoGlobale>(
    `WITH agg AS (
       SELECT
         SUM(st.durata_minuti) AS totale,
         SUM(st.durata_minuti) FILTER (WHERE a.id IS NOT NULL) AS utilizzati,
         SUM(st.durata_minuti) FILTER (WHERE st.pregiata) AS totale_pregiate,
         SUM(st.durata_minuti) FILTER (WHERE st.pregiata AND a.id IS NOT NULL) AS utilizzate_pregiate
       FROM slot_settimana_tipo st
       LEFT JOIN assegnazioni a ON a.slot_id = st.id AND a.stato IN ('provvisoria', 'validata')
       WHERE st.stagione_id = $1 AND st.indisponibile_permanente = false
     )
     SELECT
       (CASE WHEN totale IS NULL OR totale = 0 THEN NULL
             ELSE ROUND(COALESCE(utilizzati, 0)::numeric / totale, 3) END)::text AS tasso_utilizzo_impianti_pct,
       (CASE WHEN totale_pregiate IS NULL OR totale_pregiate = 0 THEN NULL
             ELSE ROUND(COALESCE(utilizzate_pregiate, 0)::numeric / totale_pregiate, 3) END)::text AS fasce_pregiate_assegnate_pct
     FROM agg`,
    [stagioneId],
  );
  return r.rows[0]!;
}

// ISF = VA cumulativa / FR finale (art. A.13), VA = valore_minuti PONDERATO
// (a differenza del KPI sopra — qui è la definizione corretta, art. A.9).
// Si parte da `domande`/`fabbisogni_riconosciuti` (non da `assegnazioni`):
// un'associazione ammessa con FR>0 ma zero assegnazioni attive ha ISF=0, un
// dato valido che deve contribuire alla media — partire da `assegnazioni`
// la farebbe sparire dalla query, gonfiando artificialmente la media verso
// l'alto. FR=0 resta N/A (mai nel denominatore), regola di dominio consolidata.
async function leggiIsfMedio(db: Db, stagioneId: string): Promise<RigaIsfMedio> {
  const r = await db.query<RigaIsfMedio>(
    `SELECT ROUND(AVG(
       CASE WHEN fr.fr_finale_minuti > 0 THEN COALESCE(va.totale, 0) / fr.fr_finale_minuti END
     ), 3)::text AS isf_medio_associazioni
     FROM domande d
     JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = d.id
     LEFT JOIN (
       SELECT a.associazione_id, SUM(a.valore_minuti) AS totale
       FROM assegnazioni a
       JOIN slot_settimana_tipo st ON st.id = a.slot_id
       WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
       GROUP BY a.associazione_id
     ) va ON va.associazione_id = d.associazione_id
     WHERE d.stagione_id = $1 AND d.stato = 'ammessa'`,
    [stagioneId],
  );
  return r.rows[0]!;
}

async function leggiSociAtleti(db: Db, stagioneId: string): Promise<RigaSociAtleti> {
  const r = await db.query<RigaSociAtleti>(
    `SELECT COALESCE(SUM(numero_atleti_partecipanti), 0)::int AS soci_atleti_coinvolti
     FROM domande WHERE stagione_id = $1 AND stato = 'ammessa'`,
    [stagioneId],
  );
  return r.rows[0]!;
}

// Disciplina di un'assegnazione = intersezione tra le discipline dichiarate
// nella domanda (domanda_discipline) e le discipline compatibili dello
// spazio del suo slot (spazio_disciplina_compatibile) — decisione presa in
// brainstorming: "dipende dagli slot selezionati nel calendario, non dalla
// domanda". Se l'intersezione ha più di una disciplina, i minuti grezzi
// dello slot sono divisi equamente tra le discipline dell'intersezione
// (euristica di visualizzazione, non una regola normativa — vedi design
// doc). Se l'intersezione è vuota, l'assegnazione è esclusa dal grafico
// (nessun JOIN la produce, silenziosamente corretto: non c'è FK che
// garantisca un'intersezione non vuota).
async function leggiDistribuzionePerDisciplina(db: Db, stagioneId: string): Promise<RigaDisciplina[]> {
  const r = await db.query<RigaDisciplina>(
    `WITH assegnazioni_attive AS (
       SELECT a.id, a.domanda_id, st.spazio_id, st.durata_minuti
       FROM assegnazioni a
       JOIN slot_settimana_tipo st ON st.id = a.slot_id
       WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
     ),
     discipline_match AS (
       SELECT aa.id AS assegnazione_id, dd.disciplina_codice, aa.durata_minuti,
              COUNT(*) OVER (PARTITION BY aa.id) AS numero_discipline
       FROM assegnazioni_attive aa
       JOIN domanda_discipline dd ON dd.domanda_id = aa.domanda_id
       JOIN spazio_disciplina_compatibile sdc
         ON sdc.spazio_id = aa.spazio_id AND sdc.disciplina_codice = dd.disciplina_codice
     )
     SELECT ds.codice AS disciplina_codice, ds.denominazione AS disciplina_denominazione,
            ROUND(SUM(dm.durata_minuti / dm.numero_discipline::numeric), 3)::text AS minuti
     FROM discipline_match dm
     JOIN discipline_sportive ds ON ds.codice = dm.disciplina_codice
     GROUP BY ds.codice, ds.denominazione
     ORDER BY minuti DESC, ds.codice`,
    [stagioneId],
  );
  return r.rows;
}

async function leggiSaturazionePerImpianto(db: Db, stagioneId: string): Promise<RigaImpianto[]> {
  const r = await db.query<RigaImpianto>(
    `SELECT i.id AS impianto_id, i.denominazione AS impianto_denominazione,
            (CASE WHEN SUM(st.durata_minuti) = 0 THEN NULL
                  ELSE ROUND(COALESCE(SUM(st.durata_minuti) FILTER (WHERE a.id IS NOT NULL), 0)::numeric / SUM(st.durata_minuti), 3) END)::text AS tasso_utilizzo_pct
     FROM slot_settimana_tipo st
     JOIN spazi_sportivi sp ON sp.id = st.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     LEFT JOIN assegnazioni a ON a.slot_id = st.id AND a.stato IN ('provvisoria', 'validata')
     WHERE st.stagione_id = $1 AND st.indisponibile_permanente = false
     GROUP BY i.id, i.denominazione
     ORDER BY i.denominazione`,
    [stagioneId],
  );
  return r.rows;
}

export async function calcolaStatisticheStagione(db: Db, stagioneId: string): Promise<StatisticheStagione> {
  const [globale, isf, sociAtleti, disciplina, impianto] = await Promise.all([
    leggiUtilizzoGlobale(db, stagioneId),
    leggiIsfMedio(db, stagioneId),
    leggiSociAtleti(db, stagioneId),
    leggiDistribuzionePerDisciplina(db, stagioneId),
    leggiSaturazionePerImpianto(db, stagioneId),
  ]);
  return {
    tassoUtilizzoImpiantiPct: globale.tasso_utilizzo_impianti_pct,
    fascePregiateAssegnatePct: globale.fasce_pregiate_assegnate_pct,
    isfMedioAssociazioni: isf.isf_medio_associazioni,
    sociAtletiCoinvolti: sociAtleti.soci_atleti_coinvolti,
    distribuzioneMinutiPerDisciplina: disciplina.map((v) => ({
      disciplinaCodice: v.disciplina_codice,
      disciplinaDenominazione: v.disciplina_denominazione,
      minuti: v.minuti,
    })),
    saturazionePerImpianto: impianto.map((v) => ({
      impiantoId: v.impianto_id,
      impiantoDenominazione: v.impianto_denominazione,
      tassoUtilizzoPct: v.tasso_utilizzo_pct,
    })),
  };
}
