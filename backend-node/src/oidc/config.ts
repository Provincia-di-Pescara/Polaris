import type { Pool } from 'pg';
import { leggiImpostazione, scriviImpostazione } from '../repository/impostazioniSistema.ts';
import { cifra, decifra } from './crypto.ts';

const CHIAVE_IMPOSTAZIONE = 'oidc';

export interface ConfigOidc {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface ConfigOidcMemorizzata {
  issuer: string;
  clientId: string;
  clientSecretCifrato: string;
  redirectUri: string;
}

export async function leggiConfigOidc(pool: Pool): Promise<ConfigOidc | null> {
  const memorizzata = await leggiImpostazione<ConfigOidcMemorizzata>(pool, CHIAVE_IMPOSTAZIONE);
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

export async function scriviConfigOidc(pool: Pool, config: ConfigOidc): Promise<void> {
  const memorizzata: ConfigOidcMemorizzata = {
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecretCifrato: await cifra(config.clientSecret),
    redirectUri: config.redirectUri,
  };
  await scriviImpostazione(pool, CHIAVE_IMPOSTAZIONE, memorizzata);
}
