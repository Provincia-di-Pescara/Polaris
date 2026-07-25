import type { Db } from '../db.ts';

// Audit log applicativo (art. B.39 Allegato B, art. 53 Doc Principale): ogni operazione
// di SCRITTURA è registrata con persona fisica o utente backoffice (esattamente uno, CHECK
// num_nonnulls a livello DB), eventuale associazione rappresentata, ruolo, data/ora.
// Le letture non si registrano (decisione chiusa, vedi CLAUDE.md).

export type AttoreOperazione =
  | { tipo: 'backoffice'; utenteBackofficeId: string; ruolo: 'admin' | 'operatore' }
  | { tipo: 'pubblico'; personaFisicaId: string; associazioneId?: string | null; ruolo?: string | null };

export interface Operazione {
  attore: AttoreOperazione;
  azione: string;
  entitaTipo: string;
  entitaId?: string | null;
  dettaglio?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export async function registraOperazione(db: Db, op: Operazione): Promise<void> {
  const a = op.attore;
  await db.query(
    `INSERT INTO log_operazioni
       (persona_fisica_id, utente_backoffice_id, associazione_id, ruolo, azione, entita_tipo, entita_id, dettaglio, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      a.tipo === 'pubblico' ? a.personaFisicaId : null,
      a.tipo === 'backoffice' ? a.utenteBackofficeId : null,
      a.tipo === 'pubblico' ? (a.associazioneId ?? null) : null,
      a.ruolo ?? null,
      op.azione,
      op.entitaTipo,
      op.entitaId ?? null,
      op.dettaglio ? JSON.stringify(op.dettaglio) : null,
      op.ipAddress ?? null,
    ],
  );
}
