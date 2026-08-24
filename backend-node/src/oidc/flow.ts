import type { Pool } from 'pg';
import { leggiConfigOidc, redirectUriOidc } from './config.ts';
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

// redirectUri fa parte della "configurazione completa" tanto quanto issuer/clientId
// anche se ora vive in un env var (FRONTEND_PUBBLICO_BASE_URL) invece che in DB — un
// deploy che dimentica di impostarlo deve fallire qui con lo stesso errore leggibile
// di un OIDC mai configurato, non mandare un redirect_uri "null"/vuoto all'IdP.
async function richiediConfig(pool: Pool) {
  const config = await leggiConfigOidc(pool);
  if (!config) {
    throw new ErroreOidcNonConfigurato('configurazione OIDC non presente (impostazioni_sistema, chiave "oidc")');
  }
  const redirectUri = redirectUriOidc();
  if (!redirectUri) {
    throw new ErroreOidcNonConfigurato('FRONTEND_PUBBLICO_BASE_URL non impostata: redirect_uri non calcolabile');
  }
  return { ...config, redirectUri };
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

  const claimsCompleti = await arricchisciConUserinfo(claimsVerificati, oidcSubject, endpoint.userinfoEndpoint, payload.access_token);

  return { oidcSubject, claims: estraiClaimPersona(claimsCompleti) };
}

// pa-sso-proxy emette un id_token minimale (solo claim JWT standard: iss/sub/
// aud/iat/exp/at_hash) — i dati di profilo SPID/CIE (codice fiscale, nome,
// cognome) arrivano dall'endpoint UserInfo, non dall'id_token. Trovato in
// produzione (2026-08-24), confermato contro lo stesso pattern già in uso in
// Comune-di-Montesilvano/ComunicaPA (stesso pa-sso-proxy). Mai un requisito
// bloccante: se l'endpoint manca o non risponde, si prosegue con i soli claim
// dell'id_token (estraiClaimPersona fallirà comunque con un errore leggibile
// se mancano i dati necessari, invece di un errore di rete opaco qui).
async function arricchisciConUserinfo(
  claimsIdToken: Record<string, unknown>,
  oidcSubject: string,
  userinfoEndpoint: string | undefined,
  accessToken: string | undefined,
): Promise<Record<string, unknown>> {
  if (!userinfoEndpoint || !accessToken) {
    return claimsIdToken;
  }
  try {
    const res = await fetch(userinfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return claimsIdToken;
    }
    const userinfo = (await res.json()) as Record<string, unknown>;
    // Il claim sub di UserInfo DEVE combaciare con quello (verificato) dell'id_token
    // (art. 5.3.2 OIDC Core) -- altrimenti l'access_token non è legato a questo
    // login, ignora silenziosamente invece di fidarsi di dati non collegati.
    if (userinfo['sub'] !== undefined && String(userinfo['sub']) !== oidcSubject) {
      return claimsIdToken;
    }
    return { ...claimsIdToken, ...userinfo };
  } catch {
    return claimsIdToken;
  }
}
