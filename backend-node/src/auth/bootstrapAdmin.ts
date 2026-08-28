import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.ts';
import { hashPassword } from './password.ts';
import { registraOperazione } from '../repository/logOperazioni.ts';
import { corpoEmailConLink, type Email } from '../email/smtp.ts';

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

// Disponibile finché nessun utente backoffice è correntemente attivo. Non basta
// l'assenza di righe 'in_attesa_verifica': un admin reale può trovarsi in quello
// stato temporaneamente durante un reset-password (POST /backoffice/utenti/:id/
// reset-password), non solo durante un bootstrap mai completato — per questo il
// criterio è positivo (esiste un attivo) e non negativo (non esiste un pendente).
//
// Nota: in precedenza il criterio includeva anche `ultimo_accesso_il IS NOT NULL`
// come segnale aggiuntivo ("un login è già avvenuto in passato"). Rimosso perché
// era codice morto: `utenti_backoffice.ultimo_accesso_il` non viene mai scritta da
// nessun percorso di produzione (auth/login.ts non la tocca al login riuscito, a
// differenza dell'omonima colonna su persone_fisiche) — il disgiunto non era mai
// vero in pratica. La difesa reale contro il bypass del reset-password è il
// binding di `token_verifica_scopo` (migration 000008): un token emesso da
// impostaNuovoInvito non è più utilizzabile su questo endpoint.
export async function bootstrapDisponibile(db: Db): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM utenti_backoffice WHERE stato = 'attivo' LIMIT 1`);
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
  // Ristretto a token_verifica_scopo = 'bootstrap' (migration 000008): una riga
  // in_attesa_verifica con scopo 'invito_utente' è un utente REALE in mezzo a un
  // invito o un reset-password (POST /backoffice/utenti/:id/reset-password), non
  // un tentativo di bootstrap mai completato — non va mai cancellata da qui. Prima
  // dell'introduzione dello scopo esplicito questo filtro si basava su
  // `ultimo_accesso_il IS NULL`, un criterio che si è rivelato codice morto (la
  // colonna non viene mai scritta in produzione) e che avrebbe cancellato anche
  // righe di invito/reset legittime.
  await db.query(`DELETE FROM utenti_backoffice WHERE stato = 'in_attesa_verifica' AND token_verifica_scopo = 'bootstrap'`);
  await db.query(
    `INSERT INTO utenti_backoffice
       (email, password_hash, nome, cognome, ruolo, stato, token_verifica_hash, token_verifica_scade_il, token_verifica_scopo)
     VALUES ($1, $2, $3, $4, 'admin', 'in_attesa_verifica', $5, $6, 'bootstrap')`,
    [dati.email, passwordHash, dati.nome, dati.cognome, hashToken(token), new Date(Date.now() + TTL_TOKEN_VERIFICA_MS)],
  );

  {
    const urlVerifica = `${baseUrl}/bootstrap/verifica?token=${token}`;
    const primaDelLink = [
      `Buongiorno ${dati.nome} ${dati.cognome},`,
      'per completare la creazione del primo account amministratore di POLARIS apra questo link:',
    ];
    const dopoIlLink = ['Il link scade tra 24 ore. Se non ha richiesto questa attivazione, ignori questa email.'];
    await inviaEmailFn({
      a: dati.email,
      oggetto: 'POLARIS — attivazione account amministratore',
      testo: [...primaDelLink, '', urlVerifica, '', ...dopoIlLink].join('\n'),
      html: corpoEmailConLink(primaDelLink, urlVerifica, dopoIlLink),
    });
  }
}

export async function verificaPrimoAdmin(db: Db, token: string): Promise<{ id: string; email: string }> {
  const r = await db.query<{ id: string; email: string }>(
    `UPDATE utenti_backoffice
     SET stato = 'attivo', token_verifica_hash = NULL, token_verifica_scade_il = NULL, token_verifica_scopo = NULL
     WHERE token_verifica_hash = $1 AND stato = 'in_attesa_verifica' AND token_verifica_scade_il > now()
       AND token_verifica_scopo = 'bootstrap'
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
