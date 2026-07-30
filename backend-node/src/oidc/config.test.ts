import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  leggiConfigOidc,
  leggiConfigOidcPubblica,
  scriviConfigOidc,
  ErroreClientSecretMancante,
} from './config.ts';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

test(
  'scriviConfigOidc: primo salvataggio richiede clientSecret, secret opzionale sui successivi',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    // La prima asserzione dipende dall'ASSENZA globale di qualunque configurazione OIDC
    // (chiave singleton 'oidc' in impostazioni_sistema): non può girare sul DB condiviso,
    // dove altri file di test (server.test.ts, loginPubblico.test.ts) scrivono/leggono
    // la stessa chiave in parallelo. Stesso pattern di src/testutil/dbDedicato.ts già
    // usato per il bootstrap primo admin (altro caso di "nessuna riga esiste ancora").
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    try {
      const issuer1 = `https://idp-test-${randomUUID()}.invalid`;
      await assert.rejects(
        () => scriviConfigOidc(pool, { issuer: issuer1, clientId: 'client-a', redirectUri: 'https://app.invalid/cb' }),
        ErroreClientSecretMancante,
        'primo salvataggio in assoluto senza clientSecret deve fallire',
      );

      await scriviConfigOidc(pool, {
        issuer: issuer1,
        clientId: 'client-a',
        clientSecret: 'segreto-iniziale',
        redirectUri: 'https://app.invalid/cb',
      });
      const dopoPrimo = await leggiConfigOidc(pool);
      assert.equal(dopoPrimo?.clientSecret, 'segreto-iniziale');

      const issuer2 = `https://idp-test-${randomUUID()}.invalid`;
      await scriviConfigOidc(pool, { issuer: issuer2, clientId: 'client-a', redirectUri: 'https://app.invalid/cb2' });
      const dopoSecondo = await leggiConfigOidc(pool);
      assert.equal(dopoSecondo?.issuer, issuer2, 'issuer aggiornato');
      assert.equal(dopoSecondo?.clientSecret, 'segreto-iniziale', 'clientSecret invariato perché omesso');

      const pubblica = await leggiConfigOidcPubblica(pool);
      assert.equal(pubblica?.clientSecretConfigurato, true);
      assert.equal((pubblica as unknown as { clientSecret?: unknown }).clientSecret, undefined, 'mai il secret nel DTO pubblico');
    } finally {
      await distruggi();
    }
  },
);
