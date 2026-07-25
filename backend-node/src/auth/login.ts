import type { Pool } from 'pg';
import { trovaUtentePerEmail, trovaUtentePerId } from '../repository/utentiBackoffice.ts';
import { creaSessione, revocaSessione, trovaSessionePerHash } from '../repository/sessioni.ts';
import { registraTentativoLogin } from '../repository/tentativiLogin.ts';
import { registraOperazione } from '../repository/logOperazioni.ts';
import { verificaPassword } from './password.ts';
import { generaAccessToken } from './jwt.ts';
import { generaRefreshToken, hashRefreshToken } from './refreshToken.ts';
import { ErroreCredenzialiNonValide, ErroreRefreshTokenNonValido, ErroreUtenteDisattivato } from './errori.ts';

const DURATA_REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

export interface EsitoAutenticazione {
  accessToken: string;
  refreshToken: string;
}

async function emettiTokenPerUtente(
  pool: Pool,
  utente: { id: string; email: string; ruolo: 'admin' | 'operatore' },
  ipAddress: string | null,
): Promise<EsitoAutenticazione> {
  const accessToken = generaAccessToken({ sub: utente.id, email: utente.email, ruolo: utente.ruolo });
  const refreshToken = generaRefreshToken();
  await creaSessione(pool, {
    utenteBackofficeId: utente.id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    scadeIl: new Date(Date.now() + DURATA_REFRESH_TOKEN_MS),
    ...(ipAddress ? { ipAddress } : {}),
  });
  return { accessToken, refreshToken };
}

export async function eseguiLogin(
  pool: Pool,
  email: string,
  password: string,
  ipAddress: string | null,
): Promise<EsitoAutenticazione> {
  const utente = await trovaUtentePerEmail(pool, email);

  if (!utente) {
    await registraTentativoLogin(pool, { emailTentata: email, esito: 'utente_non_trovato', ipAddress });
    throw new ErroreCredenzialiNonValide();
  }

  if (utente.stato !== 'attivo') {
    await registraTentativoLogin(pool, {
      emailTentata: email,
      utenteBackofficeId: utente.id,
      esito: 'utente_disattivato',
      ipAddress,
    });
    throw new ErroreUtenteDisattivato();
  }

  const passwordOk = await verificaPassword(password, utente.passwordHash);
  if (!passwordOk) {
    await registraTentativoLogin(pool, {
      emailTentata: email,
      utenteBackofficeId: utente.id,
      esito: 'password_errata',
      ipAddress,
    });
    throw new ErroreCredenzialiNonValide();
  }

  await registraTentativoLogin(pool, {
    emailTentata: email,
    utenteBackofficeId: utente.id,
    esito: 'successo',
    ipAddress,
  });

  // Audit log art. B.39: solo il login riuscito (i falliti restano in
  // tentativi_login_backoffice — log_operazioni richiede un attore certo).
  await registraOperazione(pool, {
    attore: { tipo: 'backoffice', utenteBackofficeId: utente.id, ruolo: utente.ruolo },
    azione: 'login',
    entitaTipo: 'utenti_backoffice',
    entitaId: utente.id,
    ipAddress,
  });

  return emettiTokenPerUtente(pool, utente, ipAddress);
}

// Rotazione refresh token: ad ogni refresh il vecchio token viene revocato e se ne emette
// uno nuovo, per limitare il danno di un refresh token rubato (resta valido una sola volta).
export async function eseguiRefresh(pool: Pool, refreshToken: string, ipAddress: string | null): Promise<EsitoAutenticazione> {
  const hash = hashRefreshToken(refreshToken);
  const sessione = await trovaSessionePerHash(pool, hash);

  if (!sessione || sessione.revocataIl !== null || sessione.scadeIl.getTime() < Date.now()) {
    throw new ErroreRefreshTokenNonValido();
  }

  const utente = await trovaUtentePerId(pool, sessione.utenteBackofficeId);
  if (!utente || utente.stato !== 'attivo') {
    throw new ErroreRefreshTokenNonValido();
  }

  await revocaSessione(pool, sessione.id);

  return emettiTokenPerUtente(pool, utente, ipAddress);
}

export async function eseguiLogout(pool: Pool, refreshToken: string): Promise<void> {
  const hash = hashRefreshToken(refreshToken);
  const sessione = await trovaSessionePerHash(pool, hash);
  if (sessione) {
    await revocaSessione(pool, sessione.id);
    const utente = await trovaUtentePerId(pool, sessione.utenteBackofficeId);
    if (utente) {
      await registraOperazione(pool, {
        attore: { tipo: 'backoffice', utenteBackofficeId: utente.id, ruolo: utente.ruolo },
        azione: 'logout',
        entitaTipo: 'utenti_backoffice',
        entitaId: utente.id,
      });
    }
  }
}
