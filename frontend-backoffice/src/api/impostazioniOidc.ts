import { ErroreRichiestaApi, richiedi } from './client.ts';

export { ErroreRichiestaApi };

export interface ConfigOidc {
  issuer: string;
  clientId: string;
  // Calcolato server-side da FRONTEND_PUBBLICO_BASE_URL, mai persistito/editabile —
  // null se quella env var non è impostata nel deploy corrente.
  redirectUri: string | null;
  clientSecretConfigurato: boolean;
}

export interface DatiSalvaConfigOidc {
  issuer: string;
  clientId: string;
  clientSecret?: string | undefined;
}

// 404 = "non ancora configurato" (stato legittimo, non un errore da propagare al
// chiamante come tale): la view lo interpreta come form vuoto da compilare al
// primo salvataggio, coerente con ErroreClientSecretMancante lato backend.
export async function leggiConfigOidc(): Promise<ConfigOidc | null> {
  try {
    return await richiedi<ConfigOidc>('/backoffice/impostazioni/oidc');
  } catch (err) {
    if (err instanceof ErroreRichiestaApi && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export function salvaConfigOidc(dati: DatiSalvaConfigOidc): Promise<ConfigOidc> {
  return richiedi('/backoffice/impostazioni/oidc', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}
