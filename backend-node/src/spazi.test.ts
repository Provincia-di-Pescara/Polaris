import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaSpazio, listaSpaziPerImpianto, trovaSpazioPerId, aggiornaSpazio } from './spazi.ts';
import { creaImpianto } from './impianti.ts';
import { creaDisciplina } from './discipline.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'spazi sportivi CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const impianto = await creaImpianto(pool, { denominazione: `Impianto Spazi Test ${randomUUID()}` });
    const d1 = await creaDisciplina(pool, { codice: `SPZ-${randomUUID().slice(0, 6)}`, denominazione: 'Disciplina Spazi 1' });
    const d2 = await creaDisciplina(pool, { codice: `SPZ-${randomUUID().slice(0, 6)}`, denominazione: 'Disciplina Spazi 2' });
    let spazioId = '';

    await t.test('crea con omologazioni e discipline compatibili, ritrova nella lista', async () => {
      const spazio = await creaSpazio(pool, {
        impiantoId: impianto.id,
        denominazione: 'Campo Grande',
        omologazioni: [d1.codice],
        note: 'nota di prova',
        disciplineCompatibili: [d1.codice, d2.codice],
      });
      spazioId = spazio.id;
      assert.deepEqual(spazio.omologazioni, [d1.codice]);
      assert.deepEqual([...spazio.disciplineCompatibili].sort(), [d1.codice, d2.codice].sort());

      const lista = await listaSpaziPerImpianto(pool, impianto.id);
      assert.ok(lista.some((s) => s.id === spazioId));
    });

    await t.test('crea senza campi opzionali', async () => {
      const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo Minimo' });
      assert.deepEqual(spazio.omologazioni, []);
      assert.deepEqual(spazio.disciplineCompatibili, []);
      assert.equal(spazio.note, null);
    });

    await t.test('trova per id', async () => {
      const trovato = await trovaSpazioPerId(pool, spazioId);
      assert.equal(trovato?.denominazione, 'Campo Grande');
    });

    await t.test('aggiorna sostituisce interamente le discipline compatibili', async () => {
      const aggiornato = await aggiornaSpazio(pool, spazioId, {
        denominazione: 'Campo Grande Rinominato',
        disciplineCompatibili: [d2.codice],
      });
      assert.deepEqual(aggiornato.disciplineCompatibili, [d2.codice]);
    });

    await t.test('aggiorna id inesistente viene rifiutato', async () => {
      await assert.rejects(
        aggiornaSpazio(pool, randomUUID(), { denominazione: 'X' }),
        ErroreNonTrovato,
      );
    });
  },
);
