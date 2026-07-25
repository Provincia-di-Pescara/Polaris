import type { Pool } from 'pg';

export type EsitoTentativoLogin = 'successo' | 'password_errata' | 'utente_non_trovato' | 'utente_disattivato';

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
