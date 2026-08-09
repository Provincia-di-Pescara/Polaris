import type { Db } from './db.ts';
import { ErroreRiferimentoNonValido } from './erroriDominio.ts';

export interface Indisponibilita {
  id: string;
  slotId: string;
  dal: string;
  al: string;
  motivo: string;
  comunicataDa: 'istituzione_scolastica' | 'ente';
  comunicataIl: string;
  notificataAlleAssociazioniIl: string | null;
  slotRecuperoId: string | null;
}

interface RigaIndisponibilita {
  id: string;
  slot_id: string;
  dal: string;
  al: string;
  motivo: string;
  comunicata_da: 'istituzione_scolastica' | 'ente';
  comunicata_il: Date;
  notificata_alle_associazioni_il: Date | null;
  slot_recupero_id: string | null;
}

const COLONNE_SELECT = `id, slot_id, dal::text, al::text, motivo, comunicata_da, comunicata_il,
  notificata_alle_associazioni_il, slot_recupero_id`;

function daRiga(r: RigaIndisponibilita): Indisponibilita {
  return {
    id: r.id,
    slotId: r.slot_id,
    dal: r.dal,
    al: r.al,
    motivo: r.motivo,
    comunicataDa: r.comunicata_da,
    comunicataIl: r.comunicata_il.toISOString(),
    notificataAlleAssociazioniIl: r.notificata_alle_associazioni_il ? r.notificata_alle_associazioni_il.toISOString() : null,
    slotRecuperoId: r.slot_recupero_id,
  };
}

export interface DatiCreaIndisponibilita {
  slotId: string;
  dal: string;
  al: string;
  motivo: string;
  comunicataDa: 'istituzione_scolastica' | 'ente';
  slotRecuperoId?: string | undefined;
}

// art. B.33: "notifica automaticamente l'indisponibilità alle associazioni interessate" —
// implementato come visibilità immediata via API (notificata_alle_associazioni_il = now()
// all'INSERT), non invio email (le persone fisiche OIDC non garantiscono un claim email
// nei dati SPID/CIE — assunzione 🔺 documentata nello spec).
export async function creaIndisponibilita(db: Db, dati: DatiCreaIndisponibilita): Promise<Indisponibilita> {
  // La FK garantisce solo che slot_recupero_id esista: una fascia di recupero in una
  // stagione DIVERSA da quella della fascia indisponibile non ha senso di dominio e
  // resterebbe invisibile a ogni query per stagione (M7 final review). L'impianto è invece
  // volutamente libero: un recupero in un'altra palestra è uno scenario legittimo.
  if (dati.slotRecuperoId) {
    const stagioni = await db.query<{ id: string; stagione_id: string }>(
      `SELECT id, stagione_id FROM slot_settimana_tipo WHERE id = ANY($1)`,
      [[dati.slotId, dati.slotRecuperoId]],
    );
    const stagioneOrigine = stagioni.rows.find((r) => r.id === dati.slotId)?.stagione_id;
    const stagioneRecupero = stagioni.rows.find((r) => r.id === dati.slotRecuperoId)?.stagione_id;
    if (!stagioneOrigine || !stagioneRecupero) {
      throw new ErroreRiferimentoNonValido('slot indicato inesistente');
    }
    if (stagioneOrigine !== stagioneRecupero) {
      throw new ErroreRiferimentoNonValido('la fascia di recupero deve appartenere alla stessa stagione della fascia indisponibile');
    }
  }
  const r = await db.query<RigaIndisponibilita>(
    `INSERT INTO indisponibilita_sopravvenute (slot_id, dal, al, motivo, comunicata_da, notificata_alle_associazioni_il, slot_recupero_id)
     VALUES ($1, $2, $3, $4, $5, now(), $6)
     RETURNING ${COLONNE_SELECT}`,
    [dati.slotId, dati.dal, dati.al, dati.motivo, dati.comunicataDa, dati.slotRecuperoId ?? null],
  );
  return daRiga(r.rows[0]!);
}

export async function listaIndisponibilitaPerAssociazione(db: Db, associazioneId: string, stagioneId?: string): Promise<Indisponibilita[]> {
  const r = stagioneId
    ? await db.query<RigaIndisponibilita>(
        `SELECT i.id, i.slot_id, i.dal::text, i.al::text, i.motivo, i.comunicata_da, i.comunicata_il,
                i.notificata_alle_associazioni_il, i.slot_recupero_id
         FROM indisponibilita_sopravvenute i
         JOIN assegnazioni a ON a.slot_id = i.slot_id
         JOIN slot_settimana_tipo st ON st.id = i.slot_id
         WHERE a.associazione_id = $1 AND a.stato IN ('provvisoria', 'validata') AND st.stagione_id = $2
         ORDER BY i.dal`,
        [associazioneId, stagioneId],
      )
    : await db.query<RigaIndisponibilita>(
        `SELECT i.id, i.slot_id, i.dal::text, i.al::text, i.motivo, i.comunicata_da, i.comunicata_il,
                i.notificata_alle_associazioni_il, i.slot_recupero_id
         FROM indisponibilita_sopravvenute i
         JOIN assegnazioni a ON a.slot_id = i.slot_id
         WHERE a.associazione_id = $1 AND a.stato IN ('provvisoria', 'validata')
         ORDER BY i.dal`,
        [associazioneId],
      );
  return r.rows.map(daRiga);
}
