import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaAssociazione, trovaAssociazionePerId, creaDocumentoAssociazione, listaDocumentiPerAssociazione, trovaDocumentoPerId } from './associazioni.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'creaAssociazione contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const piva = `PIVA-${randomUUID().slice(0, 8)}`;
      const associazione = await creaAssociazione(pool, {
        denominazione: 'ASD Test Calcio',
        codiceFiscalePartitaIva: piva,
      });
      assert.equal(associazione.denominazione, 'ASD Test Calcio');
      assert.equal(associazione.codiceFiscalePartitaIva, piva);
      assert.equal(associazione.rnaNumeroIscrizione, null);

      const trovata = await trovaAssociazionePerId(pool, associazione.id);
      assert.equal(trovata?.id, associazione.id);

      await assert.rejects(
        () => creaAssociazione(pool, { denominazione: 'Altra', codiceFiscalePartitaIva: piva }),
        ErroreValoreDuplicato,
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'trovaAssociazionePerId su id inesistente ritorna null',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const risultato = await trovaAssociazionePerId(pool, randomUUID());
      assert.equal(risultato, null);
    } finally {
      await pool.end();
    }
  },
);

test(
  'creaDocumentoAssociazione contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const piva = `PIVA-${randomUUID().slice(0, 8)}`;
      const associazione = await creaAssociazione(pool, { denominazione: 'ASD Doc Test', codiceFiscalePartitaIva: piva });

      const documento = await creaDocumentoAssociazione(pool, {
        associazioneId: associazione.id,
        tipo: 'statuto',
        filePath: `${randomUUID()}.pdf`,
      });
      assert.equal(documento.associazioneId, associazione.id);
      assert.equal(documento.tipo, 'statuto');

      await assert.rejects(
        () => creaDocumentoAssociazione(pool, { associazioneId: randomUUID(), tipo: 'statuto', filePath: 'x.pdf' }),
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'listaDocumentiPerAssociazione e trovaDocumentoPerId',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Documenti Test',
      codiceFiscalePartitaIva: randomUUID(),
    });
    const doc = await creaDocumentoAssociazione(pool, {
      associazioneId: associazione.id,
      tipo: 'statuto',
      filePath: 'file-di-test.pdf',
    });

    const lista = await listaDocumentiPerAssociazione(pool, associazione.id);
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.tipo, 'statuto');
    assert.ok(!('filePath' in lista[0]!));

    const trovato = await trovaDocumentoPerId(pool, doc.id);
    assert.equal(trovato?.filePath, 'file-di-test.pdf');

    const inesistente = await trovaDocumentoPerId(pool, randomUUID());
    assert.equal(inesistente, null);
  },
);
