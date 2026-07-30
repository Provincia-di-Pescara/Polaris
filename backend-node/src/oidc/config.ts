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
  redirectUri: string;
}

export interface ConfigOidcInput {
  issuer: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string | undefined;
}

// DTO per la GET HTTP: mai il secret, nemmeno cifrato.
export interface ConfigOidcPubblica {
  issuer: string;
  clientId: string;
  redirectUri: string;
  clientSecretConfigurato: boolean;
}

interface ConfigOidcMemorizzata {
  issuer: string;
  clientId: string;
  clientSecretCifrato: string;
  redirectUri: string;
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
    redirectUri: memorizzata.redirectUri,
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
    redirectUri: memorizzata.redirectUri,
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
    redirectUri: config.redirectUri,
  };
  await scriviImpostazione(db, CHIAVE_IMPOSTAZIONE, memorizzata, aggiornataDa);
}
