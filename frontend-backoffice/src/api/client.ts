const CHIAVE_ACCESS = 'polaris_access_token';
const CHIAVE_REFRESH = 'polaris_refresh_token';

// In produzione il proxy Vite (dev) o il reverse proxy (prod) fanno sì che le
// chiamate relative raggiungano il backend sulla stessa origin — nessuna base URL
// assoluta necessaria. Nei test (backend reale su porta random, nessun proxy Vite
// in gioco) il test inietta l'URL assoluto tramite questa variabile globale.
function baseUrl(): string {
  const override = (globalThis as { __API_BASE_URL__?: string }).__API_BASE_URL__;
  return override ?? '';
}

// Lanciato quando anche il refresh fallisce: la sessione è persa, il chiamante
// (AuthContext) deve trattarla come un logout locale e reindirizzare al login.
export class ErroreSessioneScaduta extends Error {}

export function impostaTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(CHIAVE_ACCESS, accessToken);
  localStorage.setItem(CHIAVE_REFRESH, refreshToken);
}

export function rimuoviTokens(): void {
  localStorage.removeItem(CHIAVE_ACCESS);
  localStorage.removeItem(CHIAVE_REFRESH);
}

function leggiAccessToken(): string | null {
  return localStorage.getItem(CHIAVE_ACCESS);
}

function leggiRefreshToken(): string | null {
  return localStorage.getItem(CHIAVE_REFRESH);
}

async function fetchConToken(path: string, init: RequestInit, accessToken: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return fetch(`${baseUrl()}${path}`, { ...init, headers });
}

async function provaRefresh(refreshToken: string): Promise<string> {
  const r = await fetch(`${baseUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!r.ok) {
    rimuoviTokens();
    throw new ErroreSessioneScaduta('refresh fallito');
  }

  const { accessToken, refreshToken: nuovoRefreshToken } = await r.json();
  impostaTokens(accessToken, nuovoRefreshToken);
  return accessToken;
}

// Wrapper unico su fetch per tutte le chiamate autenticate al backend. Allega il
// Bearer token se presente; su 401 tenta UN SOLO refresh (solo se esiste un refresh
// token in storage) e ripete la richiesta originale una volta. Se non esiste alcun
// refresh token, il 401 originale viene propagato invariato (nessuna sessione da
// rinnovare — non è un errore di sessione scaduta, è semplicemente "non autenticato").
// Se un refresh viene tentato e fallisce, propaga ErroreSessioneScaduta (il
// chiamante — AuthContext — decide cosa fare, es. redirect a /login).
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const primaRisposta = await fetchConToken(path, init, leggiAccessToken());
  if (primaRisposta.status !== 401) {
    return primaRisposta;
  }

  const refreshToken = leggiRefreshToken();
  if (!refreshToken) {
    return primaRisposta;
  }

  const nuovoAccessToken = await provaRefresh(refreshToken);
  return fetchConToken(path, init, nuovoAccessToken);
}
