import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaImpianto, listaImpianti, trovaImpiantoPerId, aggiornaImpianto } from './impianti.ts';
import { creaIstituzione } from './istituzioni.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'impianti CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const istituzione = await creaIstituzione(pool, { denominazione: `IIS Impianti Test ${randomUUID()}` });
    let impiantoId = '';

    await t.test('crea legato a un\'istituzione e ritrova nella lista', async () => {
      const impianto = await creaImpianto(pool, {
        denominazione: 'Palestra A',
        istituzioneScolasticaId: istituzione.id,
        indirizzo: 'Via Sport 1',
      });
      impiantoId = impianto.id;
      assert.equal(impianto.istituzioneScolasticaId, istituzione.id);

      const lista = await listaImpianti(pool);
      assert.ok(lista.some((i) => i.id === impiantoId));
    });

    await t.test('crea senza istituzione (opzionale)', async () => {
      const impianto = await creaImpianto(pool, { denominazione: 'Palestra Senza Scuola' });
      assert.equal(impianto.istituzioneScolasticaId, null);
    });

    await t.test('lista filtrata per istituzione', async () => {
      const lista = await listaImpianti(pool, istituzione.id);
      assert.ok(lista.length >= 1);
      assert.ok(lista.every((i) => i.istituzioneScolasticaId === istituzione.id));
    });

    await t.test('trova per id', async () => {
      const trovato = await trovaImpiantoPerId(pool, impiantoId);
      assert.equal(trovato?.denominazione, 'Palestra A');
    });

    await t.test('aggiorna', async () => {
      const aggiornato = await aggiornaImpianto(pool, impiantoId, { denominazione: 'Palestra A Rinominata' });
      assert.equal(aggiornato.denominazione, 'Palestra A Rinominata');
    });

    await t.test('aggiorna id inesistente viene rifiutato', async () => {
      await assert.rejects(aggiornaImpianto(pool, randomUUID(), { denominazione: 'X' }), ErroreNonTrovato);
    });
  },
);
