const CHIAVE_ACCESS = 'polaris_pubblico_access_token';
const CHIAVE_REFRESH = 'polaris_pubblico_refresh_token';

// In produzione il proxy Vite (dev) o il reverse proxy (prod) fanno sì che le
// chiamate relative raggiungano il backend sulla stessa origin — nessuna base URL
// assoluta necessaria. Nei test (backend reale su porta random, nessun proxy Vite
// in gioco) il test inietta l'URL assoluto tramite questa variabile globale.
export function baseUrl(): string {
  const override = (globalThis as { __API_BASE_URL__?: string }).__API_BASE_URL__;
  return override ?? '';
}

// Lanciato quando anche il refresh fallisce: la sessione è persa, il chiamante
// (AuthContext) deve trattarla come un logout locale e reindirizzare al login.
export class ErroreSessioneScaduta extends Error {}

// Classe unica condivisa: prima di questo, ogni modulo `api/*.ts` (impiantiSpazi,
// deleghe, motore, parametrico, audit) dichiarava una PROPRIA `ErroreRichiestaApi`
// omonima ma distinta a livello di identità di classe — un `instanceof` in un
// componente che importava l'errore da un modulo diverso da quello che l'aveva
// lanciato falliva silenziosamente, degradando a un messaggio generico "Errore
// imprevisto" invece del vero messaggio del backend. Ora esiste una sola classe,
// qui, e ogni modulo la ri-esporta.
export class ErroreRichiestaApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Wrapper condiviso: esegue una apiFetch autenticata, mappa una risposta non-ok
// in ErroreRichiestaApi (leggendo `{errore: string}` dal corpo se presente,
// altrimenti lo status text), altrimenti fa il parse JSON della risposta.
export async function richiedi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
  return (await r.json()) as T;
}

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
  const r = await fetch(`${baseUrl()}/auth/pubblico/refresh`, {
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

// Il refresh token ha rotation: un secondo refresh concorrente sullo STESSO token
// (es. due montaggi di React.StrictMode, o due apiFetch in parallelo che scadono
// insieme) troverebbe il primo già ruotato e fallirebbe con ErroreSessioneScaduta,
// anche se la sessione è in realtà ancora valida. Questa promise condivisa a
// livello di modulo fa sì che tutte le chiamate concorrenti attendano lo stesso,
// unico tentativo di refresh invece di ognuna scatenarne uno proprio.
let refreshInCorso: Promise<string> | null = null;

async function provaRefreshCondiviso(refreshToken: string): Promise<string> {
  if (!refreshInCorso) {
    refreshInCorso = provaRefresh(refreshToken).finally(() => {
      refreshInCorso = null;
    });
  }
  return refreshInCorso;
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

  const nuovoAccessToken = await provaRefreshCondiviso(refreshToken);
  return fetchConToken(path, init, nuovoAccessToken);
}
