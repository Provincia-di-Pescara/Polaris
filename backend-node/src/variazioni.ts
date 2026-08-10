import type { Db } from './db.ts';
import {
  ErroreNonTrovato,
  ErroreRiferimentoNonValido,
  ErroreStatoNonValidoPerTransizione,
  ErroreValoreDuplicato,
} from './erroriDominio.ts';
import { controlloDisciplinaCompatibile } from './concertazione.ts';
import { validaSlotAppartengonoAStagione } from './domande.ts';
import { STATI_STAGIONE_CON_DEFINITIVA } from './settimanaTipoDefinitiva.ts';

export type TipoVariazione = 'liberazione' | 'recupero' | 'scambio_temporaneo' | 'utilizzo_occasionale';
export type StatoVariazione = 'in_attesa_accettazione' | 'accettata' | 'rifiutata' | 'annullata';

export interface Variazione {
  id: string;
  tipo: TipoVariazione;
  slotId: string;
  data: string;
  slotDestinazioneId: string | null;
  dataDestinazione: string | null;
  richiestaDaAssociazioneId: string;
  richiestaDaPersonaFisicaId: string;
  controparteAssociazioneId: string | null;
  indisponibilitaId: string | null;
  stato: StatoVariazione;
  motivazioneRifiuto: string | null;
  creataIl: string;
}

interface RigaVariazione {
  id: string;
  tipo: TipoVariazione;
  slot_id: string;
  data: string;
  slot_destinazione_id: string | null;
  data_destinazione: string | null;
  richiesta_da_associazione_id: string;
  richiesta_da_persona_fisica_id: string;
  controparte_associazione_id: string | null;
  indisponibilita_id: string | null;
  stato: StatoVariazione;
  motivazione_rifiuto: string | null;
  creata_il: Date;
}

const COLONNE_SELECT = `id, tipo, slot_id, data::text, slot_destinazione_id, data_destinazione::text,
  richiesta_da_associazione_id, richiesta_da_persona_fisica_id, controparte_associazione_id,
  indisponibilita_id, stato, motivazione_rifiuto, creata_il`;

function daRiga(r: RigaVariazione): Variazione {
  return {
    id: r.id,
    tipo: r.tipo,
    slotId: r.slot_id,
    data: r.data,
    slotDestinazioneId: r.slot_destinazione_id,
    dataDestinazione: r.data_destinazione,
    richiestaDaAssociazioneId: r.richiesta_da_associazione_id,
    richiestaDaPersonaFisicaId: r.richiesta_da_persona_fisica_id,
    controparteAssociazioneId: r.controparte_associazione_id,
    indisponibilitaId: r.indisponibilita_id,
    stato: r.stato,
    motivazioneRifiuto: r.motivazione_rifiuto,
    creataIl: r.creata_il.toISOString(),
  };
}

// Chi "possiede" una fascia in una data specifica: prima le variazioni_ordinarie già
// accettate che toccano quell'occorrenza (come origine o come destinazione), poi
// l'assegnazione permanente del template. Nessuna concatenazione di variazioni sulla
// stessa occorrenza in questo blocco (vincolo UNIQUE su slot_id+data lato origine).
export async function trovaProprietarioOccorrenza(db: Db, slotId: string, data: string): Promise<string | null> {
  const r = await db.query<{
    tipo: TipoVariazione;
    slot_id: string;
    richiesta_da_associazione_id: string;
    controparte_associazione_id: string | null;
  }>(
    // ORDER BY esplicito (M5 final review): l'OR può matchare due righe distinte per la
    // stessa occorrenza (una che la usa come origine, una che la usa come destinazione) —
    // vince sempre la variazione accettata più recente, che è l'ultima a essersi espressa
    // su chi possiede quell'occorrenza. Senza ORDER BY il LIMIT 1 era non deterministico.
    `SELECT tipo, slot_id, richiesta_da_associazione_id, controparte_associazione_id
     FROM variazioni_ordinarie
     WHERE stato = 'accettata' AND (
       (slot_id = $1 AND data = $2) OR (slot_destinazione_id = $1 AND data_destinazione = $2)
     )
     ORDER BY creata_il DESC, id DESC
     LIMIT 1`,
    [slotId, data],
  );
  const v = r.rows[0];
  if (v) {
    if (v.slot_id === slotId) {
      if (v.tipo === 'scambio_temporaneo') {
        // origine dello scambio: liberata dal richiedente, assegnata alla controparte
        return v.controparte_associazione_id;
      }
      if (v.tipo === 'utilizzo_occasionale') {
        // nessun campo destinazione separato: slot_id/data STESSI sono l'occorrenza acquisita
        return v.richiesta_da_associazione_id;
      }
      // liberazione, recupero: origine liberata (nessun proprietario) — per recupero
      // l'occorrenza persa è già indisponibile (art. B.33), non riassegnata qui
      return null;
    }
    // destinazione (recupero/scambio_temporaneo): il richiedente ne diventa proprietario per quella data
    return v.richiesta_da_associazione_id;
  }
  const assegnazione = await db.query<{ associazione_id: string }>(
    `SELECT associazione_id FROM assegnazioni WHERE slot_id = $1 AND stato IN ('provvisoria', 'validata')`,
    [slotId],
  );
  return assegnazione.rows[0]?.associazione_id ?? null;
}

export interface DatiCreaVariazione {
  stagioneId: string;
  tipo: TipoVariazione;
  slotId: string;
  data: string;
  slotDestinazioneId?: string | undefined;
  dataDestinazione?: string | undefined;
  associazioneId: string;
  controparteAssociazioneId?: string | undefined;
  indisponibilitaId?: string | undefined;
}

interface Occorrenza {
  slotId: string;
  data: string;
}

// Ogni occorrenza toccata da una variazione va bloccata prima di leggerne lo stato di
// libertà/titolarità: il controllo è un semplice SELECT, e sotto READ COMMITTED due
// transazioni concorrenti vedrebbero entrambe la stessa occorrenza libera e committerebbero
// entrambe (C2 final review, riprodotto con due transazioni reali). Ordine canonico ASC
// sulla chiave testuale — stesso pattern di concertazione.ts::validaProposta, evita deadlock
// tra due variazioni che toccano le stesse due occorrenze in ordine opposto.
async function bloccaOccorrenze(db: Db, occorrenze: Occorrenza[]): Promise<void> {
  const chiavi = [...new Set(occorrenze.map((o) => `${o.slotId}|${o.data}`))].sort();
  for (const chiave of chiavi) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [chiave]);
  }
}

// art. B.32 presuppone un quadro assegnativo già consolidato: una variazione su una
// stagione ancora in censimento/istruttoria/concertazione non ha nulla da variare
// (I4 final review).
async function verificaStagioneAmmetteVariazioni(db: Db, stagioneId: string): Promise<void> {
  const r = await db.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('stagione non trovata');
  }
  if (!STATI_STAGIONE_CON_DEFINITIVA.includes(riga.stato)) {
    throw new ErroreStatoNonValidoPerTransizione(
      'le variazioni ordinarie sono ammesse solo dopo l\'approvazione della settimana tipo definitiva',
    );
  }
}

// Una data sintatticamente valida può comunque non esistere come occorrenza di quella
// fascia: fuori dal calendario della stagione, o in un giorno della settimana diverso da
// quello del template (I7 final review — prima l'unico filtro era il regex del body, e una
// data impossibile arrivava fino a Postgres come 22008 → 500 grezzo).
// Esportata (I2 final review, blocco B.34-35): la stessa verifica serve a
// utilizziEffettivi.ts::registraUtilizzo — una rilevazione di mancato utilizzo su una data
// che non è nemmeno un'occorrenza reale di quella fascia non deve poter concorrere alle
// soglie di decadenza. Nessun cambiamento di comportamento per i chiamanti interni.
export async function verificaCoerenzaOccorrenza(db: Db, stagioneId: string, occ: Occorrenza): Promise<void> {
  const r = await db.query<{ nel_calendario: boolean; giorno_coerente: boolean }>(
    `SELECT ($2::date BETWEEN s.data_inizio AND s.data_fine) AS nel_calendario,
            (EXTRACT(ISODOW FROM $2::date) = st.giorno_settimana) AS giorno_coerente
     FROM slot_settimana_tipo st
     JOIN stagioni_sportive s ON s.id = st.stagione_id
     WHERE st.id = $1 AND st.stagione_id = $3`,
    [occ.slotId, occ.data, stagioneId],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreRiferimentoNonValido(`lo slot ${occ.slotId} non appartiene alla stagione indicata`);
  }
  if (!riga.nel_calendario) {
    throw new ErroreRiferimentoNonValido(`la data ${occ.data} è fuori dal calendario della stagione`);
  }
  if (!riga.giorno_coerente) {
    throw new ErroreRiferimentoNonValido(`la data ${occ.data} non cade nel giorno della settimana della fascia`);
  }
}

// "Libera" per un'occorrenza NON è solo "nessuno la possiede": una fascia permanentemente
// indisponibile o coperta da un'indisponibilità sopravvenuta (art. B.33) non è utilizzabile
// nemmeno se nessuna assegnazione la occupa (I3 final review — stesso invariante che il
// motore Go applica filtrando indisponibile_permanente in ogni query).
async function verificaDestinazioneLibera(db: Db, occ: Occorrenza): Promise<string | null> {
  const slot = await db.query<{ indisponibile_permanente: boolean }>(
    `SELECT indisponibile_permanente FROM slot_settimana_tipo WHERE id = $1`,
    [occ.slotId],
  );
  if (!slot.rows[0]) {
    throw new ErroreRiferimentoNonValido(`slot ${occ.slotId} inesistente`);
  }
  if (slot.rows[0].indisponibile_permanente) {
    return `la fascia di destinazione è permanentemente indisponibile`;
  }
  const indisponibilita = await db.query(
    `SELECT 1 FROM indisponibilita_sopravvenute WHERE slot_id = $1 AND $2::date BETWEEN dal AND al LIMIT 1`,
    [occ.slotId, occ.data],
  );
  if ((indisponibilita.rowCount ?? 0) > 0) {
    return `la fascia di destinazione è indisponibile in data ${occ.data} (art. B.33)`;
  }
  const proprietario = await trovaProprietarioOccorrenza(db, occ.slotId, occ.data);
  if (proprietario !== null) {
    return `lo slot di destinazione non è libero in data ${occ.data}`;
  }
  return null;
}

// L'occorrenza che il richiedente cede/libera/recupera deve essere sua: senza questo
// controllo un'associazione qualsiasi poteva dichiarare libera l'occorrenza di un'altra
// (C1) o occupare l'indice di unicità sull'occorrenza altrui con uno scambio pendente,
// bloccandone il titolare legittimo (I6).
async function verificaTitolaritaOrigine(db: Db, occ: Occorrenza, associazioneId: string): Promise<string | null> {
  const proprietario = await trovaProprietarioOccorrenza(db, occ.slotId, occ.data);
  return proprietario === associazioneId ? null : 'la tua associazione non è titolare di questa occorrenza';
}

// art. B.33: un recupero è ammesso SOLO a fronte di un'indisponibilità sopravvenuta reale,
// che riguardi proprio la fascia+data che il richiedente ha perso — e solo il titolare di
// quell'occorrenza può recuperarla (C1 final review: senza questi due controlli, `recupero`
// era una primitiva per dichiarare libera l'occorrenza di chiunque, in qualunque data).
async function verificaRecuperoLegittimo(db: Db, dati: DatiCreaVariazione): Promise<string | null> {
  if (!dati.indisponibilitaId) {
    return 'per un recupero è obbligatorio indicare l\'indisponibilità sopravvenuta di origine';
  }
  const r = await db.query(
    `SELECT 1 FROM indisponibilita_sopravvenute
     WHERE id = $1 AND slot_id = $2 AND $3::date BETWEEN dal AND al`,
    [dati.indisponibilitaId, dati.slotId, dati.data],
  );
  if ((r.rowCount ?? 0) === 0) {
    return 'l\'indisponibilità indicata non riguarda questa fascia in questa data';
  }
  return verificaTitolaritaOrigine(db, { slotId: dati.slotId, data: dati.data }, dati.associazioneId);
}

// Controlli sostanziali, per tipo. Ritorna null se la variazione è ammissibile, altrimenti
// la motivazione del rifiuto (esito di dominio, non errore HTTP). Presuppone che le
// occorrenze coinvolte siano già state bloccate da bloccaOccorrenze.
async function verificaControlliStrutturali(db: Db, dati: DatiCreaVariazione): Promise<string | null> {
  const origine: Occorrenza = { slotId: dati.slotId, data: dati.data };
  if (dati.tipo === 'liberazione') {
    return verificaTitolaritaOrigine(db, origine, dati.associazioneId);
  }
  if (dati.tipo === 'utilizzo_occasionale') {
    // nessun campo destinazione separato: slotId/data STESSI sono l'occorrenza acquisita
    const libera = await verificaDestinazioneLibera(db, origine);
    if (libera) {
      return libera;
    }
    const disciplina = await controlloDisciplinaCompatibile(db, dati.slotId, dati.associazioneId, dati.stagioneId);
    return disciplina.ok ? null : disciplina.motivo!;
  }
  // recupero e scambio_temporaneo: origine posseduta dal richiedente + destinazione libera
  // e compatibile per chi la riceve.
  const motivoOrigine =
    dati.tipo === 'recupero'
      ? await verificaRecuperoLegittimo(db, dati)
      : await verificaTitolaritaOrigine(db, origine, dati.associazioneId);
  if (motivoOrigine) {
    return motivoOrigine;
  }
  const destinazione: Occorrenza = { slotId: dati.slotDestinazioneId!, data: dati.dataDestinazione! };
  const libera = await verificaDestinazioneLibera(db, destinazione);
  if (libera) {
    return libera;
  }
  const disciplina = await controlloDisciplinaCompatibile(db, destinazione.slotId, dati.associazioneId, dati.stagioneId);
  return disciplina.ok ? null : disciplina.motivo!;
}

function occorrenzeDi(dati: DatiCreaVariazione): Occorrenza[] {
  const occorrenze: Occorrenza[] = [{ slotId: dati.slotId, data: dati.data }];
  if (dati.slotDestinazioneId && dati.dataDestinazione) {
    occorrenze.push({ slotId: dati.slotDestinazioneId, data: dati.dataDestinazione });
  }
  return occorrenze;
}

export async function creaVariazione(
  db: Db,
  dati: DatiCreaVariazione,
  richiedentePersonaFisicaId: string,
): Promise<Variazione> {
  const slotIds = [dati.slotId, ...(dati.slotDestinazioneId ? [dati.slotDestinazioneId] : [])];
  await validaSlotAppartengonoAStagione(db, dati.stagioneId, slotIds);
  await verificaStagioneAmmetteVariazioni(db, dati.stagioneId);
  const occorrenze = occorrenzeDi(dati);
  for (const occ of occorrenze) {
    await verificaCoerenzaOccorrenza(db, dati.stagioneId, occ);
  }
  await bloccaOccorrenze(db, occorrenze);

  // Per lo scambio_temporaneo i controlli sostanziali restano differiti all'accettazione
  // della controparte (la configurazione finale è nota solo lì, art. B.32) — ma la sola
  // titolarità dell'origine va verificata SUBITO (I6 final review): senza, chiunque poteva
  // creare uno scambio pendente sull'occorrenza altrui, occupando
  // variazioni_occorrenza_attiva_uq e bloccandone il titolare legittimo.
  const motivazioneRifiuto =
    dati.tipo === 'scambio_temporaneo'
      ? await verificaTitolaritaOrigine(db, { slotId: dati.slotId, data: dati.data }, dati.associazioneId)
      : await verificaControlliStrutturali(db, dati);
  let stato: StatoVariazione;
  if (motivazioneRifiuto) {
    stato = 'rifiutata';
  } else {
    stato = dati.tipo === 'scambio_temporaneo' ? 'in_attesa_accettazione' : 'accettata';
  }

  try {
    const r = await db.query<RigaVariazione>(
      `INSERT INTO variazioni_ordinarie
         (tipo, slot_id, data, slot_destinazione_id, data_destinazione, richiesta_da_associazione_id,
          richiesta_da_persona_fisica_id, controparte_associazione_id, indisponibilita_id, stato, motivazione_rifiuto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${COLONNE_SELECT}`,
      [
        dati.tipo, dati.slotId, dati.data, dati.slotDestinazioneId ?? null, dati.dataDestinazione ?? null,
        dati.associazioneId, richiedentePersonaFisicaId, dati.controparteAssociazioneId ?? null,
        dati.indisponibilitaId ?? null, stato, motivazioneRifiuto,
      ],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    // 23505 = unique violation su variazioni_occorrenza_attiva_uq (origine) o
    // variazioni_destinazione_attiva_uq (destinazione, migration 000014). Nel resto del
    // progetto una unique violation è sempre ErroreValoreDuplicato → 409, non 400
    // (M1 final review).
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
      throw new ErroreValoreDuplicato('esiste già una variazione attiva su questa occorrenza');
    }
    throw err;
  }
}

export async function trovaVariazionePerId(db: Db, id: string): Promise<Variazione | null> {
  const r = await db.query<RigaVariazione>(`SELECT ${COLONNE_SELECT} FROM variazioni_ordinarie WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

// art. B.32: lo scambio è tra le associazioni, l'Ente non interviene — i controlli
// strutturali (disciplina compatibile, occorrenza libera) si eseguono qui, alla
// conferma della controparte, sulla configurazione finale (prima, alla creazione,
// nessun controllo era ancora stato fatto sullo scambio nel suo complesso).
export async function accettaVariazione(db: Db, id: string, controparteAssociazioneId: string): Promise<Variazione> {
  const lock = await db.query<{ stato: StatoVariazione; controparte_associazione_id: string | null }>(
    `SELECT stato, controparte_associazione_id FROM variazioni_ordinarie WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const riga = lock.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('variazione non trovata');
  }
  if (riga.stato !== 'in_attesa_accettazione') {
    throw new ErroreStatoNonValidoPerTransizione('la variazione non è in attesa di accettazione');
  }
  if (riga.controparte_associazione_id !== controparteAssociazioneId) {
    throw new ErroreNonTrovato('questa associazione non è la controparte della variazione');
  }

  const variazione = (await trovaVariazionePerId(db, id))!;
  const stagioneRiga = await db.query<{ stagione_id: string }>(
    `SELECT stagione_id FROM slot_settimana_tipo WHERE id = $1`,
    [variazione.slotId],
  );
  // stagione reale, non più il sentinel `''` del primo giro (M2 final review): con la
  // stringa vuota il controllo disciplina non poteva mai trovare la domanda del ricevente.
  const stagioneId = stagioneRiga.rows[0]!.stagione_id;
  await verificaStagioneAmmetteVariazioni(db, stagioneId);

  const dati: DatiCreaVariazione = {
    stagioneId,
    tipo: variazione.tipo,
    slotId: variazione.slotId,
    data: variazione.data,
    slotDestinazioneId: variazione.slotDestinazioneId ?? undefined,
    dataDestinazione: variazione.dataDestinazione ?? undefined,
    associazioneId: variazione.richiestaDaAssociazioneId,
  };
  await bloccaOccorrenze(db, occorrenzeDi(dati));

  // Controlli sostanziali completi sulla configurazione finale (alla creazione era stata
  // verificata la sola titolarità dell'origine): origine ancora del richiedente,
  // destinazione libera e compatibile per lui.
  let motivo = await verificaControlliStrutturali(db, dati);
  // In uno scambio la CONTROPARTE diventa titolare dell'occorrenza di origine: anche per lei
  // va verificata la compatibilità di disciplina, che nessuno controllava (I1 final review).
  if (!motivo) {
    const disciplinaControparte = await controlloDisciplinaCompatibile(
      db,
      variazione.slotId,
      controparteAssociazioneId,
      stagioneId,
    );
    if (!disciplinaControparte.ok) {
      motivo = disciplinaControparte.motivo!;
    }
  }

  const nuovoStato: StatoVariazione = motivo ? 'rifiutata' : 'accettata';
  await db.query(
    `UPDATE variazioni_ordinarie SET stato = $2, motivazione_rifiuto = $3 WHERE id = $1`,
    [id, nuovoStato, motivo],
  );
  return (await trovaVariazionePerId(db, id))!;
}

export async function annullaVariazione(db: Db, id: string): Promise<Variazione> {
  const r = await db.query<{ id: string }>(
    `UPDATE variazioni_ordinarie SET stato = 'annullata' WHERE id = $1 AND stato = 'in_attesa_accettazione' RETURNING id`,
    [id],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM variazioni_ordinarie WHERE id = $1`, [id]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('variazione non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la variazione non è più annullabile');
  }
  return (await trovaVariazionePerId(db, id))!;
}

export async function listaVariazioniPerStagione(
  db: Db,
  stagioneId: string,
  filtri?: { tipo?: TipoVariazione; stato?: StatoVariazione },
): Promise<Variazione[]> {
  const condizioni: string[] = ['st.stagione_id = $1'];
  const valori: unknown[] = [stagioneId];
  if (filtri?.tipo) {
    valori.push(filtri.tipo);
    condizioni.push(`v.tipo = $${valori.length}`);
  }
  if (filtri?.stato) {
    valori.push(filtri.stato);
    condizioni.push(`v.stato = $${valori.length}`);
  }
  const r = await db.query<RigaVariazione>(
    `SELECT v.id, v.tipo, v.slot_id, v.data::text, v.slot_destinazione_id, v.data_destinazione::text,
            v.richiesta_da_associazione_id, v.richiesta_da_persona_fisica_id, v.controparte_associazione_id,
            v.indisponibilita_id, v.stato, v.motivazione_rifiuto, v.creata_il
     FROM variazioni_ordinarie v
     JOIN slot_settimana_tipo st ON st.id = v.slot_id
     WHERE ${condizioni.join(' AND ')}
     ORDER BY v.creata_il DESC`,
    valori,
  );
  return r.rows.map(daRiga);
}
