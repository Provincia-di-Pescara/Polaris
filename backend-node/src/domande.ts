import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import {
  ErroreValoreDuplicato,
  ErroreNonTrovato,
  ErroreStatoNonValidoPerTransizione,
  ErroreRiferimentoNonValido,
} from './erroriDominio.ts';

export type StatoDomanda = 'presentata' | 'ammessa' | 'esclusa';

// Asse SEPARATO dallo stato istruttoria (C1, review finale whole-branch): il motore Go
// legge domande.stato con uguaglianza esatta (WHERE stato = 'ammessa') — sovraccaricarlo
// con gli stati del riesame (art. B.11) faceva sparire silenziosamente le domande
// contestate da istruttoria/round-robin. riesame_stato vive sulla stessa riga ma non è
// mai letto/scritto dal motore Go.
export type RiesameStato = 'nessuno' | 'richiesto' | 'deciso';

export interface Preferenza {
  slotId: string;
  ordinePreferenza: number;
}

export interface BloccoAllenamento {
  id: string;
  slotIds: string[];
}

export interface RichiestaGiornataGara {
  id: string;
  federazione: string;
  campionato: string;
  categoria: string;
  requisitiTecnici: string | null;
  necessitaImpiantoOmologato: boolean;
  stato: 'in_esame' | 'assegnata' | 'non_assegnata';
}

export interface Domanda {
  id: string;
  numeroProtocollo: string;
  associazioneId: string;
  stagioneId: string;
  presentataDaPersonaFisicaId: string;
  presentataIl: string;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  numeroSquadreFederaliStagionePrecedente: number;
  attivitaGiovanile: boolean;
  attivitaAgonistica: boolean;
  attivitaParalimpicaInclusiva: boolean;
  classeAttivitaCodice: string | null;
  livelloCampionato: string | null;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
  richiedeGiornataGara: boolean;
  stato: StatoDomanda;
  riesameStato: RiesameStato;
  motivazioneEsclusione: string | null;
  discipline: string[];
  preferenze: Preferenza[];
  blocchiAllenamento: BloccoAllenamento[];
  richiesteGiornataGara: RichiestaGiornataGara[];
}

interface RigaDomanda {
  id: string;
  numero_protocollo: string;
  associazione_id: string;
  stagione_id: string;
  presentata_da_persona_fisica_id: string;
  presentata_il: Date;
  numero_tesserati: number;
  numero_atleti_partecipanti: number;
  numero_squadre: number;
  numero_squadre_federali_stagione_precedente: number;
  attivita_giovanile: boolean;
  attivita_agonistica: boolean;
  attivita_paralimpica_inclusiva: boolean;
  classe_attivita_codice: string | null;
  livello_campionato: string | null;
  fabbisogno_minimo_minuti: string;
  fabbisogno_ottimale_minuti: string;
  richiede_giornata_gara: boolean;
  stato: StatoDomanda;
  riesame_stato: RiesameStato;
  motivazione_esclusione: string | null;
}

// presentata_il è TIMESTAMPTZ: il driver pg lo restituisce come Date, mai come stringa —
// conversione esplicita a .toISOString(), stesso motivo già documentato in
// repository/parametrico.ts per validaDal/creataIl.
const COLONNE_SELECT_DOMANDA = `id, numero_protocollo, associazione_id, stagione_id,
  presentata_da_persona_fisica_id, presentata_il, numero_tesserati, numero_atleti_partecipanti,
  numero_squadre, numero_squadre_federali_stagione_precedente, attivita_giovanile,
  attivita_agonistica, attivita_paralimpica_inclusiva, classe_attivita_codice, livello_campionato,
  fabbisogno_minimo_minuti::text, fabbisogno_ottimale_minuti::text, richiede_giornata_gara,
  stato, riesame_stato, motivazione_esclusione`;

interface Correlati {
  discipline: string[];
  preferenze: Preferenza[];
  blocchiAllenamento: BloccoAllenamento[];
  richiesteGiornataGara: RichiestaGiornataGara[];
}

async function caricaCorrelati(db: Db, domandaId: string): Promise<Correlati> {
  const discipline = await db.query<{ disciplina_codice: string }>(
    `SELECT disciplina_codice FROM domanda_discipline WHERE domanda_id = $1 ORDER BY disciplina_codice`,
    [domandaId],
  );
  const preferenzeRes = await db.query<{ slot_id: string; ordine_preferenza: number }>(
    `SELECT slot_id, ordine_preferenza FROM preferenze WHERE domanda_id = $1 ORDER BY ordine_preferenza`,
    [domandaId],
  );
  const blocchiRes = await db.query<{ id: string }>(
    `SELECT id FROM blocchi_allenamento_richiesti WHERE domanda_id = $1 ORDER BY id`,
    [domandaId],
  );
  const blocchiAllenamento: BloccoAllenamento[] = [];
  for (const blocco of blocchiRes.rows) {
    const slotRes = await db.query<{ slot_id: string }>(
      `SELECT slot_id FROM blocco_allenamento_slot WHERE blocco_id = $1 ORDER BY slot_id`,
      [blocco.id],
    );
    blocchiAllenamento.push({ id: blocco.id, slotIds: slotRes.rows.map((r) => r.slot_id) });
  }
  const rggRes = await db.query<{
    id: string;
    federazione: string;
    campionato: string;
    categoria: string;
    requisiti_tecnici: string | null;
    necessita_impianto_omologato: boolean;
    stato: 'in_esame' | 'assegnata' | 'non_assegnata';
  }>(
    `SELECT id, federazione, campionato, categoria, requisiti_tecnici, necessita_impianto_omologato, stato
     FROM richieste_giornata_gara WHERE domanda_id = $1 ORDER BY id`,
    [domandaId],
  );
  return {
    discipline: discipline.rows.map((r) => r.disciplina_codice),
    preferenze: preferenzeRes.rows.map((r) => ({ slotId: r.slot_id, ordinePreferenza: r.ordine_preferenza })),
    blocchiAllenamento,
    richiesteGiornataGara: rggRes.rows.map((r) => ({
      id: r.id,
      federazione: r.federazione,
      campionato: r.campionato,
      categoria: r.categoria,
      requisitiTecnici: r.requisiti_tecnici,
      necessitaImpiantoOmologato: r.necessita_impianto_omologato,
      stato: r.stato,
    })),
  };
}

function assembla(r: RigaDomanda, correlati: Correlati): Domanda {
  return {
    id: r.id,
    numeroProtocollo: r.numero_protocollo,
    associazioneId: r.associazione_id,
    stagioneId: r.stagione_id,
    presentataDaPersonaFisicaId: r.presentata_da_persona_fisica_id,
    presentataIl: r.presentata_il.toISOString(),
    numeroTesserati: r.numero_tesserati,
    numeroAtletiPartecipanti: r.numero_atleti_partecipanti,
    numeroSquadre: r.numero_squadre,
    numeroSquadreFederaliStagionePrecedente: r.numero_squadre_federali_stagione_precedente,
    attivitaGiovanile: r.attivita_giovanile,
    attivitaAgonistica: r.attivita_agonistica,
    attivitaParalimpicaInclusiva: r.attivita_paralimpica_inclusiva,
    classeAttivitaCodice: r.classe_attivita_codice,
    livelloCampionato: r.livello_campionato,
    fabbisognoMinimoMinuti: r.fabbisogno_minimo_minuti,
    fabbisognoOttimaleMinuti: r.fabbisogno_ottimale_minuti,
    richiedeGiornataGara: r.richiede_giornata_gara,
    stato: r.stato,
    riesameStato: r.riesame_stato,
    motivazioneEsclusione: r.motivazione_esclusione,
    discipline: correlati.discipline,
    preferenze: correlati.preferenze,
    blocchiAllenamento: correlati.blocchiAllenamento,
    richiesteGiornataGara: correlati.richiesteGiornataGara,
  };
}

export interface DatiRichiestaGiornataGara {
  federazione: string;
  campionato: string;
  categoria: string;
  requisitiTecnici?: string | undefined;
  necessitaImpiantoOmologato: boolean;
}

export interface DatiCreaDomanda {
  associazioneId: string;
  stagioneId: string;
  disciplineCodici: string[];
  classeAttivitaCodice?: string | undefined;
  livelloCampionato?: 'provinciale' | 'regionale' | 'interregionale' | 'nazionale' | undefined;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  numeroSquadreFederaliStagionePrecedente: number;
  attivitaGiovanile: boolean;
  attivitaAgonistica: boolean;
  attivitaParalimpicaInclusiva: boolean;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
  preferenze: string[];
  blocchiAllenamento: string[][];
  richiedeGiornataGara: boolean;
  richiesteGiornataGara: DatiRichiestaGiornataGara[];
}

// I5: gli id slot referenziati in preferenze/blocchiAllenamento sono validati come UUID
// esistenti solo a livello di FK — non che appartengano alla stagione della domanda. Uno
// slot di un'altra stagione passerebbe l'INSERT (FK verso slot_settimana_tipo soddisfatta)
// ma verrebbe silenziosamente ignorato dal motore Go a valle (che lavora per stagione),
// quindi va rifiutato qui con 400 prima di scrivere qualunque cosa.
async function validaSlotAppartengonoAStagione(db: Db, stagioneId: string, slotIds: string[]): Promise<void> {
  const idUnici = [...new Set(slotIds)];
  if (idUnici.length === 0) {
    return;
  }
  const r = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM slot_settimana_tipo WHERE id = ANY($1) AND stagione_id = $2`,
    [idUnici, stagioneId],
  );
  if (Number(r.rows[0]?.count ?? '0') !== idUnici.length) {
    throw new ErroreRiferimentoNonValido('uno o più slot referenziati non appartengono alla stagione della domanda');
  }
}

export async function creaDomanda(
  db: Db,
  dati: DatiCreaDomanda,
  presentataDaPersonaFisicaId: string,
): Promise<Domanda> {
  await validaSlotAppartengonoAStagione(db, dati.stagioneId, [
    ...dati.preferenze,
    ...dati.blocchiAllenamento.flat(),
  ]);
  let riga: RigaDomanda;
  try {
    const r = await db.query<RigaDomanda>(
      `INSERT INTO domande
         (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
          numero_tesserati, numero_atleti_partecipanti, numero_squadre,
          numero_squadre_federali_stagione_precedente, attivita_giovanile, attivita_agonistica,
          attivita_paralimpica_inclusiva, classe_attivita_codice, livello_campionato,
          fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, richiede_giornata_gara)
       VALUES
         ('DOM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('domande_protocollo_seq')::text, 6, '0'),
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING ${COLONNE_SELECT_DOMANDA}`,
      [
        dati.associazioneId,
        dati.stagioneId,
        presentataDaPersonaFisicaId,
        dati.numeroTesserati,
        dati.numeroAtletiPartecipanti,
        dati.numeroSquadre,
        dati.numeroSquadreFederaliStagionePrecedente,
        dati.attivitaGiovanile,
        dati.attivitaAgonistica,
        dati.attivitaParalimpicaInclusiva,
        dati.classeAttivitaCodice ?? null,
        dati.livelloCampionato ?? null,
        dati.fabbisognoMinimoMinuti,
        dati.fabbisognoOttimaleMinuti,
        dati.richiedeGiornataGara,
      ],
    );
    riga = r.rows[0]!;
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('esiste già una domanda di questa associazione per questa stagione');
    }
    throw err;
  }

  for (const codice of dati.disciplineCodici) {
    await db.query(`INSERT INTO domanda_discipline (domanda_id, disciplina_codice) VALUES ($1, $2)`, [riga.id, codice]);
  }
  for (let i = 0; i < dati.preferenze.length; i++) {
    await db.query(
      `INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, $3)`,
      [riga.id, dati.preferenze[i], i + 1],
    );
  }
  for (const blocco of dati.blocchiAllenamento) {
    const b = await db.query<{ id: string }>(
      `INSERT INTO blocchi_allenamento_richiesti (domanda_id) VALUES ($1) RETURNING id`,
      [riga.id],
    );
    const bloccoId = b.rows[0]!.id;
    for (const slotId of blocco) {
      await db.query(`INSERT INTO blocco_allenamento_slot (blocco_id, slot_id) VALUES ($1, $2)`, [bloccoId, slotId]);
    }
  }
  for (const rgg of dati.richiesteGiornataGara) {
    await db.query(
      `INSERT INTO richieste_giornata_gara
         (domanda_id, federazione, campionato, categoria, requisiti_tecnici, necessita_impianto_omologato)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [riga.id, rgg.federazione, rgg.campionato, rgg.categoria, rgg.requisitiTecnici ?? null, rgg.necessitaImpiantoOmologato],
    );
  }

  const correlati = await caricaCorrelati(db, riga.id);
  return assembla(riga, correlati);
}

export async function trovaDomandaPerId(db: Db, id: string): Promise<Domanda | null> {
  const r = await db.query<RigaDomanda>(`SELECT ${COLONNE_SELECT_DOMANDA} FROM domande WHERE id = $1`, [id]);
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  const correlati = await caricaCorrelati(db, riga.id);
  return assembla(riga, correlati);
}

export async function listaDomandePerAssociazione(
  db: Db,
  associazioneId: string,
  stagioneId?: string,
): Promise<Domanda[]> {
  const r = stagioneId
    ? await db.query<RigaDomanda>(
        `SELECT ${COLONNE_SELECT_DOMANDA} FROM domande WHERE associazione_id = $1 AND stagione_id = $2 ORDER BY presentata_il DESC`,
        [associazioneId, stagioneId],
      )
    : await db.query<RigaDomanda>(
        `SELECT ${COLONNE_SELECT_DOMANDA} FROM domande WHERE associazione_id = $1 ORDER BY presentata_il DESC`,
        [associazioneId],
      );
  const risultato: Domanda[] = [];
  for (const riga of r.rows) {
    const correlati = await caricaCorrelati(db, riga.id);
    risultato.push(assembla(riga, correlati));
  }
  return risultato;
}

// Guardia di stato dentro la WHERE dell'UPDATE (stesso pattern di
// abilitazioni.ts::approvaAbilitazione): niente TOCTOU tra un SELECT di controllo e
// l'UPDATE. Se rowCount è 0, un SELECT separato (fuori dal percorso "successo") distingue
// 404 (id inesistente) da 409 (stato non applicabile).
export async function ammettiDomanda(db: Db, id: string): Promise<Domanda> {
  const r = await db.query<{ id: string }>(
    `UPDATE domande SET stato = 'ammessa' WHERE id = $1 AND stato = 'presentata' RETURNING id`,
    [id],
  );
  if (r.rowCount === 0) {
    const check = await db.query(`SELECT 1 FROM domande WHERE id = $1`, [id]);
    if (check.rowCount === 0) {
      throw new ErroreNonTrovato('domanda non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la domanda non è in stato presentata');
  }
  return (await trovaDomandaPerId(db, id))!;
}

export async function escludiDomanda(db: Db, id: string, motivazione: string): Promise<Domanda> {
  const r = await db.query<{ id: string }>(
    `UPDATE domande SET stato = 'esclusa', motivazione_esclusione = $2 WHERE id = $1 AND stato = 'presentata' RETURNING id`,
    [id, motivazione],
  );
  if (r.rowCount === 0) {
    const check = await db.query(`SELECT 1 FROM domande WHERE id = $1`, [id]);
    if (check.rowCount === 0) {
      throw new ErroreNonTrovato('domanda non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la domanda non è in stato presentata');
  }
  return (await trovaDomandaPerId(db, id))!;
}

export async function listaDomandeBackoffice(db: Db, stagioneId?: string): Promise<Domanda[]> {
  const r = stagioneId
    ? await db.query<RigaDomanda>(`SELECT ${COLONNE_SELECT_DOMANDA} FROM domande WHERE stagione_id = $1 ORDER BY presentata_il DESC`, [stagioneId])
    : await db.query<RigaDomanda>(`SELECT ${COLONNE_SELECT_DOMANDA} FROM domande ORDER BY presentata_il DESC`);
  const risultato: Domanda[] = [];
  for (const riga of r.rows) {
    const correlati = await caricaCorrelati(db, riga.id);
    risultato.push(assembla(riga, correlati));
  }
  return risultato;
}

export interface EsitoIstruttoria {
  frCalcolatoMinuti: string;
  fdMinuti: string;
  frFinaleMinuti: string;
}

export interface EsitoCoefficienti {
  crs: string;
  caa: string;
  csd: string;
  cp: string;
}

export interface DomandaConEsito extends Domanda {
  fabbisognoRiconosciuto: EsitoIstruttoria | null;
  coefficienti: EsitoCoefficienti | null;
}

export async function trovaDomandaConEsitoPerId(db: Db, id: string): Promise<DomandaConEsito | null> {
  const base = await trovaDomandaPerId(db, id);
  if (!base) {
    return null;
  }
  const r = await db.query<{
    fr_calcolato_minuti: string | null;
    fd_minuti: string | null;
    fr_finale_minuti: string | null;
    crs: string | null;
    caa: string | null;
    csd: string | null;
    cp: string | null;
  }>(
    `SELECT fr.fr_calcolato_minuti::text, fr.fd_minuti::text, fr.fr_finale_minuti::text,
            c.crs::text, c.caa::text, c.csd::text, c.cp::text
     FROM domande d
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = d.id
     LEFT JOIN coefficienti_associazione c ON c.domanda_id = d.id
     WHERE d.id = $1`,
    [id],
  );
  const riga = r.rows[0];
  const fabbisognoRiconosciuto =
    riga?.fr_calcolato_minuti != null
      ? { frCalcolatoMinuti: riga.fr_calcolato_minuti, fdMinuti: riga.fd_minuti!, frFinaleMinuti: riga.fr_finale_minuti! }
      : null;
  const coefficienti =
    riga?.crs != null ? { crs: riga.crs, caa: riga.caa!, csd: riga.csd!, cp: riga.cp! } : null;
  return { ...base, fabbisognoRiconosciuto, coefficienti };
}

export interface EsitoPubblicato {
  domandaId: string;
  associazioneId: string;
  stato: StatoDomanda;
  motivazioneEsclusione: string | null;
  fabbisognoRiconosciuto: EsitoIstruttoria | null;
  coefficienti: EsitoCoefficienti | null;
}

export async function elencoEsitiPubblicati(db: Db, stagioneId: string): Promise<EsitoPubblicato[]> {
  const r = await db.query<{
    id: string;
    associazione_id: string;
    stato: StatoDomanda;
    motivazione_esclusione: string | null;
    fr_calcolato_minuti: string | null;
    fd_minuti: string | null;
    fr_finale_minuti: string | null;
    crs: string | null;
    caa: string | null;
    csd: string | null;
    cp: string | null;
  }>(
    `SELECT d.id, d.associazione_id, d.stato, d.motivazione_esclusione,
            fr.fr_calcolato_minuti::text, fr.fd_minuti::text, fr.fr_finale_minuti::text,
            c.crs::text, c.caa::text, c.csd::text, c.cp::text
     FROM domande d
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = d.id
     LEFT JOIN coefficienti_associazione c ON c.domanda_id = d.id
     WHERE d.stagione_id = $1 AND d.stato <> 'presentata'
     ORDER BY d.presentata_il`,
    [stagioneId],
  );
  return r.rows.map((riga) => ({
    domandaId: riga.id,
    associazioneId: riga.associazione_id,
    stato: riga.stato,
    motivazioneEsclusione: riga.motivazione_esclusione,
    fabbisognoRiconosciuto:
      riga.fr_calcolato_minuti != null
        ? { frCalcolatoMinuti: riga.fr_calcolato_minuti, fdMinuti: riga.fd_minuti!, frFinaleMinuti: riga.fr_finale_minuti! }
        : null,
    coefficienti: riga.crs != null ? { crs: riga.crs, caa: riga.caa!, csd: riga.csd!, cp: riga.cp! } : null,
  }));
}
