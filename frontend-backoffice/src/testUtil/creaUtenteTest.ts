import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from '../../../backend-node/src/auth/password.ts';

export interface UtenteTest {
  email: string;
  password: string;
}

const PASSWORD_TEST = 'password-test-123456';

export async function creaUtenteTest(dsn: string, ruolo: 'admin' | 'operatore'): Promise<UtenteTest> {
  const pool = new Pool({ connectionString: dsn });
  try {
    const email = `frontend-test-${randomUUID()}@test.local`;
    const hash = await hashPassword(PASSWORD_TEST);
    await pool.query(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, $2, 'Frontend', 'Test', $3, 'attivo')`,
      [email, hash, ruolo],
    );
    return { email, password: PASSWORD_TEST };
  } finally {
    await pool.end();
  }
}
