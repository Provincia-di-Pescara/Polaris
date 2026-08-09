import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreRiferimentoNonValido } from './erroriDominio.ts';
import { controlloDisciplinaCompatibile } from './concertazione.ts';
import { validaSlotAppartengonoAStagione } from './domande.ts';

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
    `SELECT tipo, slot_id, richiesta_da_associazione_id, controparte_associazione_id
     FROM variazioni_ordinarie
     WHERE stato = 'accettata' AND (
       (slot_id = $1 AND data = $2) OR (slot_destinazione_id = $1 AND data_destinazione = $2)
     )
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

async function verificaControlliStrutturali(
  db: Db,
  dati: DatiCreaVariazione,
): Promise<string | null> {
  if (dati.tipo === 'liberazione') {
    const proprietario = await trovaProprietarioOccorrenza(db, dati.slotId, dati.data);
    if (proprietario !== dati.associazioneId) {
      return 'la tua associazione non è titolare di questa occorrenza';
    }
    return null;
  }
  // recupero, utilizzo_occasionale, scambio_temporaneo: verificano che la destinazione
  // (slotDestinazioneId per recupero/scambio, slotId stesso per utilizzo_occasionale) sia
  // libera e compatibile per l'associazione che la riceve.
  const slotDaVerificare = dati.tipo === 'utilizzo_occasionale' ? dati.slotId : dati.slotDestinazioneId!;
  const dataDaVerificare = dati.tipo === 'utilizzo_occasionale' ? dati.data : dati.dataDestinazione!;
  const proprietarioDestinazione = await trovaProprietarioOccorrenza(db, slotDaVerificare, dataDaVerificare);
  if (proprietarioDestinazione !== null) {
    return `lo slot di destinazione non è libero in data ${dataDaVerificare}`;
  }
  const disciplina = await controlloDisciplinaCompatibile(db, slotDaVerificare, dati.associazioneId, dati.stagioneId);
  if (!disciplina.ok) {
    return disciplina.motivo!;
  }
  return null;
}

export async function creaVariazione(
  db: Db,
  dati: DatiCreaVariazione,
  richiedentePersonaFisicaId: string,
): Promise<Variazione> {
  const slotIds = [dati.slotId, ...(dati.slotDestinazioneId ? [dati.slotDestinazioneId] : [])];
  await validaSlotAppartengonoAStagione(db, dati.stagioneId, slotIds);

  const statoIniziale = dati.tipo === 'scambio_temporaneo' ? 'in_attesa_accettazione' : null;
  let stato: StatoVariazione;
  let motivazioneRifiuto: string | null = null;
  if (statoIniziale) {
    stato = statoIniziale;
  } else {
    const motivo = await verificaControlliStrutturali(db, dati);
    stato = motivo ? 'rifiutata' : 'accettata';
    motivazioneRifiuto = motivo;
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
    const erroreRiferimento = err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505';
    if (erroreRiferimento) {
      throw new ErroreRiferimentoNonValido('esiste già una variazione attiva su questa occorrenza');
    }
    throw err;
  }
}

export async function trovaVariazionePerId(db: Db, id: string): Promise<Variazione | null> {
  const r = await db.query<RigaVariazione>(`SELECT ${COLONNE_SELECT} FROM variazioni_ordinarie WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}
