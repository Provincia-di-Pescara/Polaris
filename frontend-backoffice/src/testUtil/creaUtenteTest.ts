import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from '../../../backend-node/src/auth/password.ts';

export interface UtenteTest {
  email: string;
  password: string;
  // Rimuove l'utente creato per il test. Ogni chiamante deve invocarla in un
  // t.after()/afterEach del proprio file — senza, gli utenti admin di test (con
  // password nota, mai revocati) si accumulano indefinitamente sul Postgres
  // condiviso di sviluppo.
  elimina: () => Promise<void>;
}

const PASSWORD_TEST = 'password-test-123456';

// log_operazioni (audit log, scritto ad ogni login riuscito) e tentativi_login_backoffice
// (audit sicurezza, ad ogni tentativo) hanno entrambi una FK verso utenti_backoffice
// SENZA ON DELETE CASCADE (a differenza di sessioni_backoffice, che ce l'ha) — un
// utente di test che ha effettuato almeno un login reale non è cancellabile senza
// prima ripulire queste due tabelle figlie.
async function eliminaConDipendenze(pool: Pool, doveClause: string, parametri: unknown[]): Promise<void> {
  const sottoquery = `SELECT id FROM utenti_backoffice ${doveClause}`;
  await pool.query(`DELETE FROM log_operazioni WHERE utente_backoffice_id IN (${sottoquery})`, parametri);
  await pool.query(`DELETE FROM tentativi_login_backoffice WHERE utente_backoffice_id IN (${sottoquery})`, parametri);
  await pool.query(`DELETE FROM utenti_backoffice ${doveClause}`, parametri);
}

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
    return {
      email,
      password: PASSWORD_TEST,
      elimina: async () => {
        const poolPulizia = new Pool({ connectionString: dsn });
        try {
          await eliminaConDipendenze(poolPulizia, 'WHERE email = $1', [email]);
        } finally {
          await poolPulizia.end();
        }
      },
    };
  } finally {
    await pool.end();
  }
}

// Rete di sicurezza aggiuntiva, NON usata nei file di test di questo progetto
// (vedi App.test.tsx/AuthContext.test.tsx/client.test.ts, che tracciano i propri
// utenti e chiamano elimina() per ciascuno): un DELETE per-pattern come questo,
// se chiamato dall'afterAll di un file mentre un ALTRO file di test gira ancora
// in un worker parallelo (comportamento di default di vitest), cancella anche gli
// utenti di test di quell'altro file a metà esecuzione — causa reale osservata
// durante lo sviluppo di questo fix (login falliva con "credenziali non valide"
// solo quando la suite intera girava in parallelo, mai isolando un singolo file).
// Resta qui come strumento manuale/una-tantum per ripulire residui accumulati da
// run precedenti interrotti (es. da lanciare a mano contro il DB di sviluppo),
// mai da un afterAll di un file di test eseguito insieme ad altri.
export async function puliziaUtentiTest(dsn: string): Promise<void> {
  const pool = new Pool({ connectionString: dsn });
  try {
    await eliminaConDipendenze(pool, "WHERE email LIKE 'frontend-test-%'", []);
  } finally {
    await pool.end();
  }
}
