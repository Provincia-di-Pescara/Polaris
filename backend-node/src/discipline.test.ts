import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaDisciplina, listaDiscipline, aggiornaDisciplina } from './discipline.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'discipline sportive CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());
    const codice = `TST-${randomUUID().slice(0, 8).toUpperCase()}`;

    await t.test('crea e ritrova nella lista', async () => {
      const disciplina = await creaDisciplina(pool, { codice, denominazione: 'Disciplina Test' });
      assert.equal(disciplina.codice, codice);
      assert.equal(disciplina.denominazione, 'Disciplina Test');

      const lista = await listaDiscipline(pool);
      assert.ok(lista.some((d) => d.codice === codice));
    });

    await t.test('crea con codice duplicato viene rifiutata', async () => {
      await assert.rejects(creaDisciplina(pool, { codice, denominazione: 'Altra' }), ErroreValoreDuplicato);
    });

    await t.test('aggiorna la denominazione', async () => {
      const aggiornata = await aggiornaDisciplina(pool, codice, 'Nuovo Nome');
      assert.equal(aggiornata.denominazione, 'Nuovo Nome');
    });

    await t.test('aggiorna un codice inesistente viene rifiutato', async () => {
      await assert.rejects(aggiornaDisciplina(pool, `NON-ESISTE-${randomUUID()}`, 'X'), ErroreNonTrovato);
    });
  },
);
