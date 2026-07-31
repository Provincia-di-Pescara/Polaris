import type { Pool } from 'pg';
import type { Db } from '../db.ts';

export interface Sessione {
  id: string;
  utenteBackofficeId: string;
  scadeIl: Date;
  revocataIl: Date | null;
}

export interface NuovaSessione {
  utenteBackofficeId: string;
  refreshTokenHash: string;
  scadeIl: Date;
  ipAddress?: string;
  userAgent?: string;
}

export async function creaSessione(pool: Pool, sessione: NuovaSessione): Promise<string> {
  const risultato = await pool.query<{ id: string }>(
    `INSERT INTO sessioni_backoffice (utente_backoffice_id, refresh_token_hash, scade_il, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      sessione.utenteBackofficeId,
      sessione.refreshTokenHash,
      sessione.scadeIl.toISOString(),
      sessione.ipAddress ?? null,
      sessione.userAgent ?? null,
    ],
  );
  const id = risultato.rows[0]?.id;
  if (!id) {
    throw new Error('creazione sessione non ha restituito un id');
  }
  return id;
}

interface RigaSessione {
  id: string;
  utente_backoffice_id: string;
  scade_il: string;
  revocata_il: string | null;
}

export async function trovaSessionePerHash(pool: Pool, refreshTokenHash: string): Promise<Sessione | null> {
  const risultato = await pool.query<RigaSessione>(
    'SELECT id, utente_backoffice_id, scade_il, revocata_il FROM sessioni_backoffice WHERE refresh_token_hash = $1',
    [refreshTokenHash],
  );
  const riga = risultato.rows[0];
  if (!riga) {
    return null;
  }
  return {
    id: riga.id,
    utenteBackofficeId: riga.utente_backoffice_id,
    scadeIl: new Date(riga.scade_il),
    revocataIl: riga.revocata_il ? new Date(riga.revocata_il) : null,
  };
}

export async function revocaSessione(pool: Pool, id: string): Promise<void> {
  await pool.query('UPDATE sessioni_backoffice SET revocata_il = now() WHERE id = $1 AND revocata_il IS NULL', [id]);
}

export async function revocaSessioniUtente(db: Db, utenteBackofficeId: string): Promise<void> {
  await db.query(
    'UPDATE sessioni_backoffice SET revocata_il = now() WHERE utente_backoffice_id = $1 AND revocata_il IS NULL',
    [utenteBackofficeId],
  );
}
