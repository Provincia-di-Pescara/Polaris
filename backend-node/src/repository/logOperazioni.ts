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

export interface OperazioneConAttore {
  id: string;
  attoreNome: string;
  attoreTipo: 'backoffice' | 'pubblico';
  ruolo: string | null;
  azione: string;
  entitaTipo: string;
  entitaId: string | null;
  dettaglio: Record<string, unknown> | null;
  ipAddress: string | null;
  avvenutaIl: string;
}

export interface FiltriListaOperazioni {
  entitaTipo?: string | undefined;
  azione?: string | undefined;
  dataDa?: string | undefined;
  dataA?: string | undefined;
  limit: number;
  offset: number;
}

interface RigaOperazione {
  id: string;
  ruolo: string | null;
  azione: string;
  entita_tipo: string;
  entita_id: string | null;
  dettaglio: Record<string, unknown> | null;
  ip_address: string | null;
  avvenuta_il: Date;
  backoffice_email: string | null;
  backoffice_nome: string | null;
  backoffice_cognome: string | null;
  persona_nome: string | null;
  persona_cognome: string | null;
}

function daRigaOperazione(r: RigaOperazione): OperazioneConAttore {
  const attoreNome = r.backoffice_email
    ? `${r.backoffice_nome} ${r.backoffice_cognome} (${r.backoffice_email})`
    : `${r.persona_nome} ${r.persona_cognome}`;
  return {
    id: r.id,
    attoreNome,
    attoreTipo: r.backoffice_email ? 'backoffice' : 'pubblico',
    ruolo: r.ruolo,
    azione: r.azione,
    entitaTipo: r.entita_tipo,
    entitaId: r.entita_id,
    dettaglio: r.dettaglio,
    ipAddress: r.ip_address,
    avvenutaIl: r.avvenuta_il.toISOString(),
  };
}

export async function listaOperazioni(db: Db, filtri: FiltriListaOperazioni): Promise<OperazioneConAttore[]> {
  const condizioni: string[] = [];
  const parametri: unknown[] = [];
  if (filtri.entitaTipo) {
    parametri.push(filtri.entitaTipo);
    condizioni.push(`lo.entita_tipo = $${parametri.length}`);
  }
  if (filtri.azione) {
    parametri.push(filtri.azione);
    condizioni.push(`lo.azione = $${parametri.length}`);
  }
  if (filtri.dataDa) {
    parametri.push(filtri.dataDa);
    condizioni.push(`lo.avvenuta_il::date >= $${parametri.length}::date`);
  }
  if (filtri.dataA) {
    parametri.push(filtri.dataA);
    condizioni.push(`lo.avvenuta_il::date <= $${parametri.length}::date`);
  }
  const whereClause = condizioni.length > 0 ? `WHERE ${condizioni.join(' AND ')}` : '';
  parametri.push(filtri.limit);
  const limitPlaceholder = `$${parametri.length}`;
  parametri.push(filtri.offset);
  const offsetPlaceholder = `$${parametri.length}`;
  const r = await db.query<RigaOperazione>(
    `SELECT lo.id, lo.ruolo, lo.azione, lo.entita_tipo, lo.entita_id, lo.dettaglio, lo.ip_address::text AS ip_address, lo.avvenuta_il,
            ub.email AS backoffice_email, ub.nome AS backoffice_nome, ub.cognome AS backoffice_cognome,
            pf.nome AS persona_nome, pf.cognome AS persona_cognome
     FROM log_operazioni lo
     LEFT JOIN utenti_backoffice ub ON ub.id = lo.utente_backoffice_id
     LEFT JOIN persone_fisiche pf ON pf.id = lo.persona_fisica_id
     ${whereClause}
     ORDER BY lo.avvenuta_il DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    parametri,
  );
  return r.rows.map(daRigaOperazione);
}
