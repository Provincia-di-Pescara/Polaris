import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaIstituzione, listaIstituzioni, trovaIstituzionePerId, aggiornaIstituzione } from './istituzioni.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'istituzioni scolastiche CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());
    const codiceMecc = `MECC-${randomUUID().slice(0, 8)}`;
    let istituzioneId = '';

    await t.test('crea e ritrova nella lista', async () => {
      const istituzione = await creaIstituzione(pool, {
        denominazione: 'IIS Test',
        codiceMeccanografico: codiceMecc,
        indirizzo: 'Via Test 1',
      });
      istituzioneId = istituzione.id;
      assert.ok(istituzione.id);
      assert.equal(istituzione.codiceMeccanografico, codiceMecc);

      const lista = await listaIstituzioni(pool);
      assert.ok(lista.some((i) => i.id === istituzioneId));
    });

    await t.test('crea senza campi opzionali', async () => {
      const istituzione = await creaIstituzione(pool, { denominazione: 'IIS Minimo' });
      assert.equal(istituzione.codiceMeccanografico, null);
      assert.equal(istituzione.indirizzo, null);
    });

    await t.test('crea con codice meccanografico duplicato viene rifiutata', async () => {
      await assert.rejects(
        creaIstituzione(pool, { denominazione: 'Altra', codiceMeccanografico: codiceMecc }),
        ErroreValoreDuplicato,
      );
    });

    await t.test('trova per id', async () => {
      const trovata = await trovaIstituzionePerId(pool, istituzioneId);
      assert.equal(trovata?.denominazione, 'IIS Test');
    });

    await t.test('trova per id inesistente restituisce null', async () => {
      const trovata = await trovaIstituzionePerId(pool, randomUUID());
      assert.equal(trovata, null);
    });

    await t.test('aggiorna', async () => {
      const aggiornata = await aggiornaIstituzione(pool, istituzioneId, {
        denominazione: 'IIS Test Rinominato',
        indirizzo: 'Via Nuova 2',
      });
      assert.equal(aggiornata.denominazione, 'IIS Test Rinominato');
      assert.equal(aggiornata.indirizzo, 'Via Nuova 2');
      assert.equal(aggiornata.codiceMeccanografico, null);
    });

    await t.test('aggiorna id inesistente viene rifiutato', async () => {
      await assert.rejects(
        aggiornaIstituzione(pool, randomUUID(), { denominazione: 'X' }),
        ErroreNonTrovato,
      );
    });
  },
);
