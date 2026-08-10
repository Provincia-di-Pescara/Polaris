import type { Pool } from 'pg';

export type EsitoTentativoLogin = 'successo' | 'password_errata' | 'utente_non_trovato' | 'utente_disattivato' | 'account_bloccato';

export interface TentativoLogin {
  emailTentata: string;
  utenteBackofficeId?: string | null;
  esito: EsitoTentativoLogin;
  ipAddress?: string | null;
}

export async function registraTentativoLogin(pool: Pool, tentativo: TentativoLogin): Promise<void> {
  await pool.query(
    `INSERT INTO tentativi_login_backoffice (email_tentata, utente_backoffice_id, esito, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [tentativo.emailTentata, tentativo.utenteBackofficeId ?? null, tentativo.esito, tentativo.ipAddress ?? null],
  );
}

// Lockout per-account (hardening Fase 4): conta solo 'password_errata' — un account che
// non esiste (utente_non_trovato) o è già disattivato (utente_disattivato) non ha bisogno
// di questa protezione aggiuntiva, è già coperto dal rate limiter per-IP su /auth/login.
export async function contaTentativiFallitiRecenti(pool: Pool, email: string, finestraMs: number): Promise<number> {
  const r = await pool.query<{ conteggio: string }>(
    `SELECT count(*) AS conteggio FROM tentativi_login_backoffice
     WHERE email_tentata = $1 AND esito = 'password_errata' AND avvenuto_il > now() - ($2 || ' milliseconds')::interval`,
    [email, finestraMs],
  );
  return Number(r.rows[0]!.conteggio);
}
