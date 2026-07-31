import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.ts';
import { hashPassword } from './password.ts';
import { registraOperazione } from '../repository/logOperazioni.ts';
import type { Email } from '../email/smtp.ts';

// Bootstrap del primo admin (wizard primo avvio): l'account nasce 'in_attesa_verifica'
// e diventa attivo solo con il token ricevuto via email — così l'indirizzo del primo
// admin è verificato prima che esista qualunque credenziale amministrativa.
// L'SMTP usato qui è quello di bootstrap in .env (vedi src/email/smtp.ts).

const TTL_TOKEN_VERIFICA_MS = 24 * 60 * 60 * 1000; // 24 ore
const LUNGHEZZA_MINIMA_PASSWORD = 12;

export class ErroreBootstrapNonDisponibile extends Error {
  constructor() {
    super('bootstrap non disponibile: esiste già almeno un utente backoffice');
  }
}

export class ErroreTokenVerificaNonValido extends Error {
  constructor() {
    super('token di verifica non valido o scaduto');
  }
}

export interface DatiPrimoAdmin {
  email: string;
  password: string;
  nome: string;
  cognome: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Disponibile finché nessun utente ha MAI completato un login e nessun utente è
// correntemente attivo. Non ci si può basare solo sullo stato 'in_attesa_verifica'
// corrente: un admin reale può trovarsi in quello stato temporaneamente durante un
// reset-password (POST /backoffice/utenti/:id/reset-password), non solo durante un
// bootstrap mai completato.
// - ultimo_accesso_il valorizzato è prova che un login è già avvenuto in passato (per
//   QUALUNQUE utente, non solo il target di un eventuale reset): il valore non viene mai
//   azzerato da impostaNuovoInvito, quindi un admin "in reset" che ha già fatto login
//   almeno una volta continua a bloccare il bootstrap anche mentre è in_attesa_verifica.
// - stato = 'attivo' copre il caso di un admin verificato via email (bootstrap appena
//   completato) ma che non ha ancora effettuato il primo login: senza questa condizione
//   il solo criterio ultimo_accesso_il lascerebbe una finestra in cui un bootstrap appena
//   completato e mai ancora "loggato" risulterebbe erroneamente ancora disponibile,
//   riaprendo lo stesso tipo di problema che questo fix vuole chiudere.
export async function bootstrapDisponibile(db: Db): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM utenti_backoffice WHERE ultimo_accesso_il IS NOT NULL OR stato = 'attivo' LIMIT 1`,
  );
  return r.rows.length === 0;
}

export async function richiediPrimoAdmin(
  db: Db,
  dati: DatiPrimoAdmin,
  inviaEmailFn: (email: Email) => Promise<void>,
  baseUrl: string,
): Promise<void> {
  if (dati.password.length < LUNGHEZZA_MINIMA_PASSWORD) {
    throw new Error(`password troppo corta: minimo ${LUNGHEZZA_MINIMA_PASSWORD} caratteri`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dati.email)) {
    throw new Error('email non valida');
  }
  if (!(await bootstrapDisponibile(db))) {
    throw new ErroreBootstrapNonDisponibile();
  }

  const token = randomBytes(32).toString('hex');
  const passwordHash = await hashPassword(dati.password);

  // Sostituisce eventuali bootstrap pendenti mai verificati (uno solo alla volta).
  // Ristretto a ultimo_accesso_il IS NULL: una riga in_attesa_verifica con un login
  // già avvenuto in passato è un utente REALE in mezzo a un reset-password, non un
  // tentativo di bootstrap mai completato — non va mai cancellata da qui.
  await db.query(`DELETE FROM utenti_backoffice WHERE stato = 'in_attesa_verifica' AND ultimo_accesso_il IS NULL`);
  await db.query(
    `INSERT INTO utenti_backoffice
       (email, password_hash, nome, cognome, ruolo, stato, token_verifica_hash, token_verifica_scade_il)
     VALUES ($1, $2, $3, $4, 'admin', 'in_attesa_verifica', $5, $6)`,
    [dati.email, passwordHash, dati.nome, dati.cognome, hashToken(token), new Date(Date.now() + TTL_TOKEN_VERIFICA_MS)],
  );

  await inviaEmailFn({
    a: dati.email,
    oggetto: 'POLARIS — attivazione account amministratore',
    testo: [
      `Buongiorno ${dati.nome} ${dati.cognome},`,
      '',
      'per completare la creazione del primo account amministratore di POLARIS apra questo link:',
      '',
      `${baseUrl}/bootstrap/verifica?token=${token}`,
      '',
      'Il link scade tra 24 ore. Se non ha richiesto questa attivazione, ignori questa email.',
    ].join('\n'),
  });
}

export async function verificaPrimoAdmin(db: Db, token: string): Promise<{ id: string; email: string }> {
  const r = await db.query<{ id: string; email: string }>(
    `UPDATE utenti_backoffice
     SET stato = 'attivo', token_verifica_hash = NULL, token_verifica_scade_il = NULL
     WHERE token_verifica_hash = $1 AND stato = 'in_attesa_verifica' AND token_verifica_scade_il > now()
     RETURNING id, email`,
    [hashToken(token)],
  );
  const utente = r.rows[0];
  if (!utente) {
    throw new ErroreTokenVerificaNonValido();
  }

  await registraOperazione(db, {
    attore: { tipo: 'backoffice', utenteBackofficeId: utente.id, ruolo: 'admin' },
    azione: 'bootstrap_primo_admin',
    entitaTipo: 'utenti_backoffice',
    entitaId: utente.id,
  });

  return utente;
}
