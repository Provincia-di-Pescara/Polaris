import type { Pool } from 'pg';
import { leggiConfigOidc } from './config.ts';
import { scopriEndpoint } from './discovery.ts';
import { generaPkce } from './pkce.ts';
import { salvaStatoPkce, consumaStatoPkce } from '../repository/oidcPkceState.ts';
import { verificaIdToken } from './idTokenVerify.ts';
import { estraiClaimPersona, type ClaimPersona } from './claims.ts';

export class ErroreOidcNonConfigurato extends Error {}
export class ErroreStatoNonValido extends Error {}
export class ErroreScambioCode extends Error {}

export interface EsitoScambioCode {
  oidcSubject: string;
  claims: ClaimPersona;
}

async function richiediConfig(pool: Pool) {
  const config = await leggiConfigOidc(pool);
  if (!config) {
    throw new ErroreOidcNonConfigurato('configurazione OIDC non presente (impostazioni_sistema, chiave "oidc")');
  }
  return config;
}

export interface UrlAutorizzazione {
  url: string;
  state: string;
}

// Il chiamante (server.ts) DEVE legare `state` alla sessione browser che ha avviato il
// flusso (cookie firmato) e verificarlo al callback PRIMA di chiamare scambiaCode —
// altrimenti un attaccante può completare il PROPRIO login legittimo (code+state veri,
// PKCE valido: il code_verifier è recuperato lato server, non dal browser) facendolo
// però eseguire dal browser della vittima, autenticandola come l'attaccante
// (login CSRF / session fixation). PKCE da solo non previene questo scenario: protegge
// dall'intercettazione di un code altrui, non da un attaccante che usa il proprio.
export async function costruisciUrlAutorizzazione(pool: Pool): Promise<UrlAutorizzazione> {
  const config = await richiediConfig(pool);
  const endpoint = await scopriEndpoint(config.issuer);
  const { state, codeVerifier, codeChallenge } = generaPkce();
  await salvaStatoPkce(pool, state, codeVerifier);

  const url = new URL(endpoint.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString(), state };
}

interface RispostaTokenEndpoint {
  id_token?: string;
  access_token?: string;
}

export async function scambiaCode(pool: Pool, code: string, state: string): Promise<EsitoScambioCode> {
  const codeVerifier = await consumaStatoPkce(pool, state);
  if (!codeVerifier) {
    throw new ErroreStatoNonValido('sessione di login scaduta o non valida: riprovare');
  }

  const config = await richiediConfig(pool);
  const endpoint = await scopriEndpoint(config.issuer);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });
  // pa-sso-proxy supporta SOLO client_secret_basic: il secret nel body causa un 401
  // con pagina HTML invece di un errore OIDC leggibile (vedi CLAUDE.md).
  const credenziali = Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString(
    'base64',
  );

  let res: Response;
  try {
    res = await fetch(endpoint.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credenziali}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new ErroreScambioCode(`provider OIDC non raggiungibile: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const dettaglio = await res.text().catch(() => '');
    throw new ErroreScambioCode(`scambio del code OIDC fallito (HTTP ${res.status}): ${dettaglio.slice(0, 500)}`);
  }

  const payload = (await res.json()) as RispostaTokenEndpoint;
  const idToken = payload.id_token ?? payload.access_token;
  if (!idToken) {
    throw new ErroreScambioCode('il provider OIDC non ha restituito un id_token');
  }

  const claimsVerificati = await verificaIdToken(idToken, endpoint.jwksUri, config.issuer, config.clientId);
  const oidcSubject = String(claimsVerificati['sub'] ?? '');
  if (!oidcSubject) {
    throw new ErroreScambioCode('id_token privo di claim sub');
  }

  return { oidcSubject, claims: estraiClaimPersona(claimsVerificati) };
}
