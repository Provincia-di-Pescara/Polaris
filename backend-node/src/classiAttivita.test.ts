import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { listaClassiAttivita } from './classiAttivita.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'listaClassiAttivita restituisce le 5 classi seedate (A-E), ordinate per codice',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const lista = await listaClassiAttivita(pool);
    assert.equal(lista.length, 5);
    assert.deepEqual(lista.map((c) => c.codice), ['A', 'B', 'C', 'D', 'E']);
    assert.equal(lista[0]!.pesoBase, 1);
  },
);
