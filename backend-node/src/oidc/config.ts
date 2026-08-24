import type { Db } from '../db.ts';
import { leggiImpostazione, scriviImpostazione } from '../repository/impostazioniSistema.ts';
import { cifra, decifra } from './crypto.ts';

const CHIAVE_IMPOSTAZIONE = 'oidc';

// Lanciato quando un PUT omette il client_secret ma non esiste ancora nessuna
// configurazione OIDC salvata da cui ereditarlo — non validabile con zod puro perché
// dipende dallo stato del DB, non solo dal body della richiesta.
export class ErroreClientSecretMancante extends Error {}

export interface ConfigOidc {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export interface ConfigOidcInput {
  issuer: string;
  clientId: string;
  clientSecret?: string | undefined;
}

// DTO per la GET HTTP: mai il secret, nemmeno cifrato. redirectUri è calcolato
// (mai persistito né editabile da un admin) — vedi redirectUriOidc().
export interface ConfigOidcPubblica {
  issuer: string;
  clientId: string;
  redirectUri: string | null;
  clientSecretConfigurato: boolean;
}

interface ConfigOidcMemorizzata {
  issuer: string;
  clientId: string;
  clientSecretCifrato: string;
}

// redirectUri NON è più un campo che un admin digita: prima di questo era il
// valore inviato letteralmente all'IdP (oidc/flow.ts) — un errore di battitura
// rompeva il login SPID/CIE in modo silenzioso, scoperto solo al primo tentativo
// reale. Ora è calcolato da FRONTEND_PUBBLICO_BASE_URL (stesso pattern di
// BACKOFFICE_BASE_URL già esistente per il link di invito email), esposto in
// sola lettura in UI con un pulsante "copia" — l'unica cosa che un admin deve
// fare è incollarlo nella registrazione client lato IdP. Nessun valore
// inventato/derivato da request headers: solo l'env var esplicita, o null.
export function redirectUriOidc(): string | null {
  const base = process.env.FRONTEND_PUBBLICO_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/oidc/callback`;
}

export async function leggiConfigOidc(db: Db): Promise<ConfigOidc | null> {
  const memorizzata = await leggiImpostazione<ConfigOidcMemorizzata>(db, CHIAVE_IMPOSTAZIONE);
  if (!memorizzata) {
    return null;
  }
  return {
    issuer: memorizzata.issuer,
    clientId: memorizzata.clientId,
    clientSecret: await decifra(memorizzata.clientSecretCifrato),
  };
}

export async function leggiConfigOidcPubblica(db: Db): Promise<ConfigOidcPubblica | null> {
  const memorizzata = await leggiImpostazione<ConfigOidcMemorizzata>(db, CHIAVE_IMPOSTAZIONE);
  if (!memorizzata) {
    return null;
  }
  return {
    issuer: memorizzata.issuer,
    clientId: memorizzata.clientId,
    redirectUri: redirectUriOidc(),
    clientSecretConfigurato: Boolean(memorizzata.clientSecretCifrato),
  };
}

export async function scriviConfigOidc(
  db: Db,
  config: ConfigOidcInput,
  aggiornataDa?: string | undefined,
): Promise<void> {
  let clientSecretCifrato: string;
  if (config.clientSecret !== undefined) {
    clientSecretCifrato = await cifra(config.clientSecret);
  } else {
    const esistente = await leggiImpostazione<ConfigOidcMemorizzata>(db, CHIAVE_IMPOSTAZIONE);
    if (!esistente) {
      throw new ErroreClientSecretMancante(
        'client_secret obbligatorio: nessuna configurazione OIDC esistente da cui ereditarlo',
      );
    }
    clientSecretCifrato = esistente.clientSecretCifrato;
  }
  const memorizzata: ConfigOidcMemorizzata = {
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecretCifrato,
  };
  await scriviImpostazione(db, CHIAVE_IMPOSTAZIONE, memorizzata, aggiornataDa);
}
