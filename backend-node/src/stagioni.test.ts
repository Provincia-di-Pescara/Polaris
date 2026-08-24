import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { listaStagioni, creaStagione, aggiornaStagione, eliminaStagione } from './stagioni.ts';
import { ErroreStagioneNonModificabile, ErroreValoreDuplicato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;
// nome univoco per-esecuzione: i test devono restare rieseguibili su un DB locale persistente
const nomeStagione = `test-node-2029/2030-${randomUUID().slice(0, 8)}`;

test(
  'listaStagioni legge le stagioni da Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const inserimento = await pool.query<{ id: string }>(
        `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, $2, $3) RETURNING id`,
        [nomeStagione, '2029-09-01', '2030-06-30'],
      );
      const stagioneId = inserimento.rows[0]?.id;
      assert.ok(stagioneId, 'insert fixture non ha restituito id');

      const stagioni = await listaStagioni(pool);

      const trovata = stagioni.find((s) => s.id === stagioneId);
      assert.ok(trovata, 'stagione inserita non trovata nel risultato');
      assert.equal(trovata?.nome, nomeStagione);
      assert.equal(trovata?.stato, 'censimento');
      assert.equal(trovata?.dataInizio, '2029-09-01');
    } finally {
      await pool.end();
    }
  },
);

test(
  'creaStagione contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const nome = `stagione-creata-${randomUUID()}`;
      const stagione = await creaStagione(pool, { nome, dataInizio: '2038-09-01', dataFine: '2039-06-30' });
      assert.equal(stagione.nome, nome);
      assert.equal(stagione.stato, 'censimento');
      assert.equal(stagione.dataInizio, '2038-09-01');
    } finally {
      await pool.end();
    }
  },
);

test(
  'aggiornaStagione: ok in censimento, rifiutata fuori censimento o con dati collegati',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const nomeIniziale = `stagione-agg-${randomUUID()}`;
      const s = await creaStagione(pool, { nome: nomeIniziale, dataInizio: '2050-09-01', dataFine: '2051-06-30' });

      const nomeAggiornato = `stagione-agg-rinominata-${randomUUID()}`;
      const aggiornata = await aggiornaStagione(pool, s.id, {
        nome: nomeAggiornato,
        dataInizio: '2050-09-15',
        dataFine: '2051-07-15',
      });
      assert.equal(aggiornata.nome, nomeAggiornato);
      assert.equal(aggiornata.dataInizio, '2050-09-15');

      // Nome duplicato mappato a 409, stesso comportamento di creaStagione.
      const altra = await creaStagione(pool, { nome: `stagione-agg-altra-${randomUUID()}`, dataInizio: '2060-09-01', dataFine: '2061-06-30' });
      await assert.rejects(
        () => aggiornaStagione(pool, s.id, { nome: altra.nome, dataInizio: '2050-09-15', dataFine: '2051-07-15' }),
        ErroreValoreDuplicato,
      );

      // Fuori 'censimento': rifiutata.
      await pool.query(`UPDATE stagioni_sportive SET stato = 'bando_aperto' WHERE id = $1`, [s.id]);
      await assert.rejects(
        () => aggiornaStagione(pool, s.id, { nome: nomeAggiornato, dataInizio: '2050-09-15', dataFine: '2051-07-15' }),
        ErroreStagioneNonModificabile,
      );
      await pool.query(`UPDATE stagioni_sportive SET stato = 'censimento' WHERE id = $1`, [s.id]);

      // Dati "load-bearing" collegati (elaborazioni -- fixture minima, tutte le altre 3
      // tabelle condividono lo stesso controllo booleano OR, non serve ripeterle):
      // rifiutata anche se lo stato è ancora 'censimento'.
      const pv = await pool.query<{ id: string }>('INSERT INTO parametrico_versioni DEFAULT VALUES RETURNING id');
      await pool.query(
        `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id) VALUES ($1, 'blocchi_gara', $2)`,
        [s.id, pv.rows[0]!.id],
      );
      await assert.rejects(
        () => aggiornaStagione(pool, s.id, { nome: nomeAggiornato, dataInizio: '2050-09-15', dataFine: '2051-07-15' }),
        ErroreStagioneNonModificabile,
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'eliminaStagione: 204 in censimento senza dati collegati, rifiutata altrimenti',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const s = await creaStagione(pool, { nome: `stagione-elim-${randomUUID()}`, dataInizio: '2052-09-01', dataFine: '2053-06-30' });
      await eliminaStagione(pool, s.id);

      const r = await pool.query('SELECT 1 FROM stagioni_sportive WHERE id = $1', [s.id]);
      assert.equal(r.rowCount, 0, 'la riga deve essere sparita');

      const s2 = await creaStagione(pool, { nome: `stagione-elim-2-${randomUUID()}`, dataInizio: '2053-09-01', dataFine: '2054-06-30' });
      await pool.query(`UPDATE stagioni_sportive SET stato = 'definitiva' WHERE id = $1`, [s2.id]);
      await assert.rejects(() => eliminaStagione(pool, s2.id), ErroreStagioneNonModificabile);
    } finally {
      await pool.end();
    }
  },
);
