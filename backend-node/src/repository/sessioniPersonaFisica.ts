import type { Pool } from 'pg';

export interface SessionePersonaFisica {
  id: string;
  personaFisicaId: string;
  scadeIl: Date;
  revocataIl: Date | null;
}

export interface NuovaSessionePersonaFisica {
  personaFisicaId: string;
  refreshTokenHash: string;
  scadeIl: Date;
  ipAddress?: string;
  userAgent?: string;
}

export async function creaSessionePersonaFisica(pool: Pool, sessione: NuovaSessionePersonaFisica): Promise<string> {
  const risultato = await pool.query<{ id: string }>(
    `INSERT INTO sessioni_persona_fisica (persona_fisica_id, refresh_token_hash, scade_il, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      sessione.personaFisicaId,
      sessione.refreshTokenHash,
      sessione.scadeIl.toISOString(),
      sessione.ipAddress ?? null,
      sessione.userAgent ?? null,
    ],
  );
  const id = risultato.rows[0]?.id;
  if (!id) {
    throw new Error('creazione sessione persona fisica non ha restituito un id');
  }
  return id;
}

interface RigaSessionePersonaFisica {
  id: string;
  persona_fisica_id: string;
  scade_il: string;
  revocata_il: string | null;
}

export async function trovaSessionePersonaFisicaPerHash(pool: Pool, refreshTokenHash: string): Promise<SessionePersonaFisica | null> {
  const risultato = await pool.query<RigaSessionePersonaFisica>(
    'SELECT id, persona_fisica_id, scade_il, revocata_il FROM sessioni_persona_fisica WHERE refresh_token_hash = $1',
    [refreshTokenHash],
  );
  const riga = risultato.rows[0];
  if (!riga) {
    return null;
  }
  return {
    id: riga.id,
    personaFisicaId: riga.persona_fisica_id,
    scadeIl: new Date(riga.scade_il),
    revocataIl: riga.revocata_il ? new Date(riga.revocata_il) : null,
  };
}

export async function revocaSessionePersonaFisica(pool: Pool, id: string): Promise<void> {
  await pool.query('UPDATE sessioni_persona_fisica SET revocata_il = now() WHERE id = $1 AND revocata_il IS NULL', [id]);
}
