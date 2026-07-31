import { randomBytes, createHash } from 'node:crypto';
import { DatabaseError } from 'pg';
import type { Db } from '../db.ts';
import { hashPassword } from '../auth/password.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from '../erroriDominio.ts';

const TTL_TOKEN_INVITO_MS = 24 * 60 * 60 * 1000;

export class ErroreUltimoAdmin extends Error {}
export class ErroreTokenInvitoNonValido extends Error {}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface UtenteBackoffice {
  id: string;
  email: string;
  passwordHash: string;
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
  stato: 'attivo' | 'disattivato' | 'in_attesa_verifica';
  creatoDa: string | null;
  creatoIl: string;
  ultimoAccessoIl: string | null;
}

export interface UtenteBackofficePubblico {
  id: string;
  email: string;
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
  stato: 'attivo' | 'disattivato' | 'in_attesa_verifica';
  creatoDa: string | null;
  creatoIl: string;
  ultimoAccessoIl: string | null;
}

export function aPubblico(u: UtenteBackoffice): UtenteBackofficePubblico {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    cognome: u.cognome,
    ruolo: u.ruolo,
    stato: u.stato,
    creatoDa: u.creatoDa,
    creatoIl: u.creatoIl,
    ultimoAccessoIl: u.ultimoAccessoIl,
  };
}

interface RigaUtenteBackoffice {
  id: string;
  email: string;
  password_hash: string;
  nome: string;
  cognome: string;
  ruolo: string;
  stato: string;
  creato_da: string | null;
  creato_il: string;
  ultimo_accesso_il: string | null;
}

const COLONNE_SELECT = 'id, email, password_hash, nome, cognome, ruolo, stato, creato_da, creato_il, ultimo_accesso_il';

function daRiga(riga: RigaUtenteBackoffice): UtenteBackoffice {
  return {
    id: riga.id,
    email: riga.email,
    passwordHash: riga.password_hash,
    nome: riga.nome,
    cognome: riga.cognome,
    ruolo: riga.ruolo as UtenteBackoffice['ruolo'],
    stato: riga.stato as UtenteBackoffice['stato'],
    creatoDa: riga.creato_da,
    creatoIl: riga.creato_il,
    ultimoAccessoIl: riga.ultimo_accesso_il,
  };
}

export async function trovaUtentePerEmail(db: Db, email: string): Promise<UtenteBackoffice | null> {
  const risultato = await db.query<RigaUtenteBackoffice>(`SELECT ${COLONNE_SELECT} FROM utenti_backoffice WHERE email = $1`, [
    email,
  ]);
  const riga = risultato.rows[0];
  return riga ? daRiga(riga) : null;
}

export async function trovaUtentePerId(db: Db, id: string): Promise<UtenteBackoffice | null> {
  const risultato = await db.query<RigaUtenteBackoffice>(`SELECT ${COLONNE_SELECT} FROM utenti_backoffice WHERE id = $1`, [
    id,
  ]);
  const riga = risultato.rows[0];
  return riga ? daRiga(riga) : null;
}

export interface DatiCreaUtenteInvitato {
  email: string;
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
}

export async function creaUtenteInvitato(
  db: Db,
  dati: DatiCreaUtenteInvitato,
  creatoDa: string,
): Promise<{ utente: UtenteBackoffice; token: string }> {
  const token = randomBytes(32).toString('hex');
  // Sentinella non verificabile: nessuna password reale finché l'invito non è
  // completato. Irraggiungibile via login perché auth/login.ts blocca su stato
  // diverso da 'attivo' PRIMA di controllare la password.
  const passwordSentinella = await hashPassword(randomBytes(32).toString('hex'));
  try {
    const r = await db.query<RigaUtenteBackoffice>(
      `INSERT INTO utenti_backoffice
         (email, password_hash, nome, cognome, ruolo, stato, creato_da, token_verifica_hash, token_verifica_scade_il)
       VALUES ($1, $2, $3, $4, $5, 'in_attesa_verifica', $6, $7, $8)
       RETURNING ${COLONNE_SELECT}`,
      [
        dati.email,
        passwordSentinella,
        dati.nome,
        dati.cognome,
        dati.ruolo,
        creatoDa,
        hashToken(token),
        new Date(Date.now() + TTL_TOKEN_INVITO_MS),
      ],
    );
    return { utente: daRiga(r.rows[0]!), token };
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('esiste già un utente backoffice con questa email');
    }
    throw err;
  }
}

export async function listaUtenti(db: Db): Promise<UtenteBackoffice[]> {
  const r = await db.query<RigaUtenteBackoffice>(`SELECT ${COLONNE_SELECT} FROM utenti_backoffice ORDER BY creato_il`);
  return r.rows.map(daRiga);
}

async function contaAltriAdminAttivi(db: Db, idEscluso: string): Promise<number> {
  const r = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM utenti_backoffice WHERE ruolo = 'admin' AND stato = 'attivo' AND id <> $1`,
    [idEscluso],
  );
  return Number(r.rows[0]!.count);
}

export interface DatiAggiornaUtente {
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
}

export async function aggiornaUtente(db: Db, id: string, dati: DatiAggiornaUtente): Promise<UtenteBackoffice> {
  if (dati.ruolo === 'operatore') {
    const attuale = await trovaUtentePerId(db, id);
    if (!attuale) {
      throw new ErroreNonTrovato('utente non trovato');
    }
    if (attuale.ruolo === 'admin' && attuale.stato === 'attivo' && (await contaAltriAdminAttivi(db, id)) === 0) {
      throw new ErroreUltimoAdmin("non è possibile declassare l'ultimo admin attivo a operatore");
    }
  }
  const r = await db.query<RigaUtenteBackoffice>(
    `UPDATE utenti_backoffice SET nome = $2, cognome = $3, ruolo = $4 WHERE id = $1 RETURNING ${COLONNE_SELECT}`,
    [id, dati.nome, dati.cognome, dati.ruolo],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('utente non trovato');
  }
  return daRiga(riga);
}

export async function cambiaStatoUtente(
  db: Db,
  id: string,
  nuovoStato: 'attivo' | 'disattivato',
  chiamanteId: string,
): Promise<UtenteBackoffice> {
  if (id === chiamanteId) {
    throw new ErroreUltimoAdmin('non puoi modificare lo stato del tuo stesso account');
  }
  if (nuovoStato === 'disattivato') {
    const attuale = await trovaUtentePerId(db, id);
    if (!attuale) {
      throw new ErroreNonTrovato('utente non trovato');
    }
    if (attuale.ruolo === 'admin' && attuale.stato === 'attivo' && (await contaAltriAdminAttivi(db, id)) === 0) {
      throw new ErroreUltimoAdmin("non è possibile disattivare l'ultimo admin attivo");
    }
  }
  // Ripulisce sempre un eventuale invito pendente: cambiare esplicitamente lo stato
  // qui è sempre attivo<->disattivato (mai in_attesa_verifica, di competenza esclusiva
  // di impostaNuovoInvito/completaInvito) — un token_verifica lasciato valorizzato
  // violerebbe il CHECK utenti_backoffice_token_verifica_coerente (migration 000005)
  // se lo stato precedente era in_attesa_verifica, e comunque un invito pendente non
  // dovrebbe restare valido dopo un cambio di stato deciso da un admin.
  const r = await db.query<RigaUtenteBackoffice>(
    `UPDATE utenti_backoffice
     SET stato = $2, token_verifica_hash = NULL, token_verifica_scade_il = NULL
     WHERE id = $1
     RETURNING ${COLONNE_SELECT}`,
    [id, nuovoStato],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('utente non trovato');
  }
  return daRiga(riga);
}

export async function impostaNuovoInvito(db: Db, id: string): Promise<{ utente: UtenteBackoffice; token: string } | null> {
  const token = randomBytes(32).toString('hex');
  const r = await db.query<RigaUtenteBackoffice>(
    `UPDATE utenti_backoffice
     SET stato = 'in_attesa_verifica', token_verifica_hash = $2, token_verifica_scade_il = $3
     WHERE id = $1
     RETURNING ${COLONNE_SELECT}`,
    [id, hashToken(token), new Date(Date.now() + TTL_TOKEN_INVITO_MS)],
  );
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return { utente: daRiga(riga), token };
}

export async function completaInvito(db: Db, token: string, password: string): Promise<UtenteBackoffice> {
  const passwordHash = await hashPassword(password);
  const r = await db.query<RigaUtenteBackoffice>(
    `UPDATE utenti_backoffice
     SET stato = 'attivo', password_hash = $2, token_verifica_hash = NULL, token_verifica_scade_il = NULL
     WHERE token_verifica_hash = $1 AND stato = 'in_attesa_verifica' AND token_verifica_scade_il > now()
     RETURNING ${COLONNE_SELECT}`,
    [hashToken(token), passwordHash],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreTokenInvitoNonValido('token non valido o scaduto');
  }
  return daRiga(riga);
}
