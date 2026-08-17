import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { listaOrganismiSportivi } from './organismiSportivi.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'listaOrganismiSportivi restituisce l\'elenco seedato, ordinato per codice',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const lista = await listaOrganismiSportivi(pool);
    assert.ok(lista.length >= 70, `attesi almeno 70 organismi seedati, trovati ${lista.length}`);
    assert.ok(lista.some((o) => o.codice === 'UISP'));
    assert.ok(lista.some((o) => o.codice === 'FIPAV'));
    // Ordinato per codice: il primo elemento precede alfabeticamente il secondo.
    assert.ok(lista[0]!.codice < lista[1]!.codice);
  },
);
