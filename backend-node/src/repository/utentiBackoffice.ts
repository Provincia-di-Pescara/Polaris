import type { Pool } from 'pg';

export interface UtenteBackoffice {
  id: string;
  email: string;
  passwordHash: string;
  ruolo: 'admin' | 'operatore';
  stato: 'attivo' | 'disattivato';
}

interface RigaUtenteBackoffice {
  id: string;
  email: string;
  password_hash: string;
  ruolo: string;
  stato: string;
}

function daRiga(riga: RigaUtenteBackoffice): UtenteBackoffice {
  return {
    id: riga.id,
    email: riga.email,
    passwordHash: riga.password_hash,
    ruolo: riga.ruolo as UtenteBackoffice['ruolo'],
    stato: riga.stato as UtenteBackoffice['stato'],
  };
}

export async function trovaUtentePerEmail(pool: Pool, email: string): Promise<UtenteBackoffice | null> {
  const risultato = await pool.query<RigaUtenteBackoffice>(
    'SELECT id, email, password_hash, ruolo, stato FROM utenti_backoffice WHERE email = $1',
    [email],
  );
  const riga = risultato.rows[0];
  return riga ? daRiga(riga) : null;
}

export async function trovaUtentePerId(pool: Pool, id: string): Promise<UtenteBackoffice | null> {
  const risultato = await pool.query<RigaUtenteBackoffice>(
    'SELECT id, email, password_hash, ruolo, stato FROM utenti_backoffice WHERE id = $1',
    [id],
  );
  const riga = risultato.rows[0];
  return riga ? daRiga(riga) : null;
}
