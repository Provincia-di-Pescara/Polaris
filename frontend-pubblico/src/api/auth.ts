import { baseUrl, richiedi, impostaTokens, rimuoviTokens } from './client.ts';

export interface PersonaAutenticata {
  sub: string;
  codiceFiscale: string;
  nome: string;
  cognome: string;
}

// Redirect pieno del browser: il flusso OIDC (Authorization Code + PKCE) è
// interamente gestito dal backend/proxy, non da fetch — vedi docs/claude/oidc-spid-cie.md.
export function avviaLoginOidc(): void {
  window.location.href = `${baseUrl()}/auth/oidc/start`;
}

export async function scambiaCallbackOidc(code: string, state: string): Promise<void> {
  const r = await fetch(`${baseUrl()}/auth/oidc/callback`, {
    method: 'POST',
    // Il cookie di stato firmato (impostato da GET /auth/oidc/start) viaggia
    // automaticamente con la richiesta grazie a 'include' — necessario perché
    // il backend confronta lo state del body con quello nel cookie (fix login-CSRF,
    // vedi docs/claude/oidc-spid-cie.md).
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, state }),
  });
  if (!r.ok) {
    let messaggio = 'Autenticazione OIDC fallita, riprovare.';
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta il messaggio di default
    }
    throw new Error(messaggio);
  }
  const { accessToken, refreshToken } = (await r.json()) as { accessToken: string; refreshToken: string };
  impostaTokens(accessToken, refreshToken);
}

export function leggiPersonaAutenticata(): Promise<PersonaAutenticata> {
  return richiedi('/auth/pubblico/me');
}

export async function eseguiLogout(): Promise<void> {
  const refreshToken = localStorage.getItem('polaris_pubblico_refresh_token');
  if (refreshToken) {
    try {
      await fetch(`${baseUrl()}/auth/pubblico/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // il logout locale deve riuscire comunque, anche se la revoca server-side fallisce
    }
  }
  rimuoviTokens();
}
