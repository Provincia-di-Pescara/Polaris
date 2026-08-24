import { richiedi } from './client.ts';

export interface UtenteBackoffice {
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

export function listaUtenti(): Promise<UtenteBackoffice[]> {
  return richiedi('/backoffice/utenti');
}

export interface DatiCreaUtente {
  email: string;
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
}

// Crea l'account in_attesa_verifica e invia l'email di invito (token one-shot,
// scade in 24h) — nessuna password scelta qui, la imposta il destinatario
// via /utenti/accetta-invito.
export function creaUtente(dati: DatiCreaUtente): Promise<UtenteBackoffice> {
  return richiedi('/backoffice/utenti', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

export interface DatiAggiornaUtente {
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
}

export function aggiornaUtente(id: string, dati: DatiAggiornaUtente): Promise<UtenteBackoffice> {
  return richiedi(`/backoffice/utenti/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

// 409 se l'utente è l'ultimo admin attivo (ErroreUltimoAdmin, lato backend) —
// mostrato verbatim, nessun controllo client-side duplicato.
export function cambiaStatoUtente(id: string, stato: 'attivo' | 'disattivato'): Promise<UtenteBackoffice> {
  return richiedi(`/backoffice/utenti/${encodeURIComponent(id)}/stato`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stato }),
  });
}

// Rigenera il token di invito (nuova email, sessioni attive dell'utente revocate)
// — usato sia per il primo invito perso sia per un reset password vero e proprio.
export function richiediResetPassword(id: string): Promise<UtenteBackoffice> {
  return richiedi(`/backoffice/utenti/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
}
