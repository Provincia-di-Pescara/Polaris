import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseError } from 'pg';
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

    await t.test('aggiorna omettendo disciplineCompatibili lascia la join table invariata', async () => {
      const spazioConDiscipline = await creaSpazio(pool, {
        impiantoId: impianto.id,
        denominazione: 'Campo Test Omit',
        disciplineCompatibili: [d1.codice, d2.codice],
      });
      const spazioIdOmit = spazioConDiscipline.id;
      assert.deepEqual([...spazioConDiscipline.disciplineCompatibili].sort(), [d1.codice, d2.codice].sort());

      const aggiornato = await aggiornaSpazio(pool, spazioIdOmit, {
        denominazione: 'Campo Test Omit Rinominato',
      });
      assert.equal(aggiornato.denominazione, 'Campo Test Omit Rinominato');
      assert.deepEqual([...aggiornato.disciplineCompatibili].sort(), [d1.codice, d2.codice].sort());
    });

    // Finding 1 (review whole-branch): omologazioni doveva seguire lo STESSO principio
    // "ometti per preservare" di disciplineCompatibili sopra, non svuotarsi a []. Stesso
    // scenario del test sopra ma sul campo omologazioni.
    await t.test('aggiorna omettendo omologazioni lascia il valore precedente invariato', async () => {
      const spazioConOmologazioni = await creaSpazio(pool, {
        impiantoId: impianto.id,
        denominazione: 'Campo Test Omit Omologazioni',
        omologazioni: ['X'],
      });
      assert.deepEqual(spazioConOmologazioni.omologazioni, ['X']);

      const aggiornato = await aggiornaSpazio(pool, spazioConOmologazioni.id, {
        denominazione: 'Campo Test Omit Omologazioni Rinominato',
      });
      assert.equal(aggiornato.denominazione, 'Campo Test Omit Omologazioni Rinominato');
      assert.deepEqual(aggiornato.omologazioni, ['X']);
    });

    // Finding 2 (review whole-branch): sostituisciDisciplineCompatibili faceva DELETE+N
    // INSERT senza transazione — un INSERT fallito a metà (FK verso discipline_sportice
    // inesistente) lasciava la join table svuotata permanentemente. Verifica sia il rifiuto
    // sia che lo stato precedente sopravviva intatto (atomicità, non solo l'errore).
    await t.test('aggiorna con un codice disciplina inesistente non perde le discipline precedenti', async () => {
      const spazioProtetto = await creaSpazio(pool, {
        impiantoId: impianto.id,
        denominazione: 'Campo Test Atomicita',
        disciplineCompatibili: [d1.codice, d2.codice],
      });

      await assert.rejects(
        aggiornaSpazio(pool, spazioProtetto.id, {
          denominazione: 'Campo Test Atomicita',
          disciplineCompatibili: [d1.codice, `NON-ESISTE-${randomUUID()}`],
        }),
        (err: unknown) => err instanceof DatabaseError && err.code === '23503',
      );

      const dopo = await trovaSpazioPerId(pool, spazioProtetto.id);
      assert.deepEqual([...dopo!.disciplineCompatibili].sort(), [d1.codice, d2.codice].sort());
    });
  },
);
