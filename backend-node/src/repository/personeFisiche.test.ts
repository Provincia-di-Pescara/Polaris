import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
const dsn = process.env.TEST_DATABASE_URL;
import { creaPersonaFisicaShell, trovaPersonaFisicaPerCf, trovaOCreaPersonaFisica } from './personeFisiche.ts';

test(
  'creaPersonaFisicaShell + completamento al primo login reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const cf = `TSTSHL${randomUUID().slice(0, 10).toUpperCase()}`;
      const shell = await creaPersonaFisicaShell(pool, { codiceFiscale: cf, nome: 'Luca', cognome: 'Bianchi' });
      assert.equal(shell.codiceFiscale, cf);

      const trovato = await trovaPersonaFisicaPerCf(pool, cf);
      assert.equal(trovato?.id, shell.id);

      const dopoLogin = await trovaOCreaPersonaFisica(pool, {
        codiceFiscale: cf,
        nome: 'Luca',
        cognome: 'Bianchi',
        oidcSubject: randomUUID(),
        oidcProvider: 'spid',
      });
      assert.equal(dopoLogin.id, shell.id, 'il login reale deve completare lo shell esistente, non crearne uno nuovo');
    } finally {
      await pool.end();
    }
  },
);
