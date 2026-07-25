import type { Pool } from 'pg';
import { scambiaCode } from '../oidc/flow.ts';
import { trovaOCreaPersonaFisica, trovaPersonaFisicaPerId, type PersonaFisica } from '../repository/personeFisiche.ts';
import {
  creaSessionePersonaFisica,
  revocaSessionePersonaFisica,
  trovaSessionePersonaFisicaPerHash,
} from '../repository/sessioniPersonaFisica.ts';
import { generaAccessTokenPubblico } from './jwtPubblico.ts';
import { generaRefreshToken, hashRefreshToken } from './refreshToken.ts';
import { ErroreRefreshTokenNonValido } from './errori.ts';

const DURATA_REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
// Placeholder: pa-sso-proxy federa sia SPID che CIE, la distinzione esatta nel claim
// del token va confermata con l'Ente prima del go-live (vedi CLAUDE.md).
const OIDC_PROVIDER_DEFAULT = 'spid' as const;

export interface EsitoAutenticazionePubblica {
  accessToken: string;
  refreshToken: string;
  persona: PersonaFisica;
}

async function emettiTokenPerPersona(
  pool: Pool,
  persona: PersonaFisica,
  ipAddress: string | null,
): Promise<EsitoAutenticazionePubblica> {
  const accessToken = generaAccessTokenPubblico({
    sub: persona.id,
    codiceFiscale: persona.codiceFiscale,
    nome: persona.nome,
    cognome: persona.cognome,
  });
  const refreshToken = generaRefreshToken();
  await creaSessionePersonaFisica(pool, {
    personaFisicaId: persona.id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    scadeIl: new Date(Date.now() + DURATA_REFRESH_TOKEN_MS),
    ...(ipAddress ? { ipAddress } : {}),
  });
  return { accessToken, refreshToken, persona };
}

export async function eseguiCallbackOidc(
  pool: Pool,
  code: string,
  state: string,
  ipAddress: string | null,
): Promise<EsitoAutenticazionePubblica> {
  const { oidcSubject, claims } = await scambiaCode(pool, code, state);

  const persona = await trovaOCreaPersonaFisica(pool, {
    codiceFiscale: claims.codiceFiscale,
    nome: claims.nome,
    cognome: claims.cognome,
    oidcSubject,
    oidcProvider: OIDC_PROVIDER_DEFAULT,
  });

  return emettiTokenPerPersona(pool, persona, ipAddress);
}

export async function eseguiRefreshPubblico(
  pool: Pool,
  refreshToken: string,
  ipAddress: string | null,
): Promise<EsitoAutenticazionePubblica> {
  const hash = hashRefreshToken(refreshToken);
  const sessione = await trovaSessionePersonaFisicaPerHash(pool, hash);

  if (!sessione || sessione.revocataIl !== null || sessione.scadeIl.getTime() < Date.now()) {
    throw new ErroreRefreshTokenNonValido();
  }

  const persona = await trovaPersonaFisicaPerId(pool, sessione.personaFisicaId);
  if (!persona) {
    throw new ErroreRefreshTokenNonValido();
  }

  await revocaSessionePersonaFisica(pool, sessione.id);

  return emettiTokenPerPersona(pool, persona, ipAddress);
}

export async function eseguiLogoutPubblico(pool: Pool, refreshToken: string): Promise<void> {
  const hash = hashRefreshToken(refreshToken);
  const sessione = await trovaSessionePersonaFisicaPerHash(pool, hash);
  if (sessione) {
    await revocaSessionePersonaFisica(pool, sessione.id);
  }
}
