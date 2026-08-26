import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import {
  cercaScuole,
  leggiUrlAnagraficaScuole,
  scriviUrlAnagraficaScuole,
  ErroreAnagraficaNonConfigurata,
} from './anagraficaScuole.ts';

const dsn = process.env.TEST_DATABASE_URL;

interface ServerMock {
  server: Server;
  url: string;
  numeroChiamate: () => number;
}

// Stessa forma "@graph" + prefisso "miur:" del dataset reale (script PHP di
// riferimento) -- fixture minima ma fedele, non inventata.
async function avviaServerMock(): Promise<ServerMock> {
  let chiamate = 0;
  const server = createServer((req, res) => {
    chiamate++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        '@graph': [
          {
            'miur:CODICESCUOLA': 'PEIC12345',
            'miur:DENOMINAZIONESCUOLA': 'IC PESCARA CENTRO',
            'miur:DESCRIZIONECOMUNE': 'Pescara',
            'miur:INDIRIZZOSCUOLA': 'Via Roma 1',
          },
          {
            'miur:CODICESCUOLA': 'PEIC67890',
            'miur:DENOMINAZIONESCUOLA': 'IC MONTESILVANO NORD',
            'miur:DESCRIZIONECOMUNE': 'Montesilvano',
            'miur:INDIRIZZOSCUOLA': 'Via Milano 5',
          },
          // Riga senza codice: deve essere scartata silenziosamente, non far
          // fallire il parsing delle altre.
          { 'miur:DENOMINAZIONESCUOLA': 'SCUOLA SENZA CODICE' },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('indirizzo server mock non disponibile');
  }
  return { server, url: `http://127.0.0.1:${address.port}/anagrafica.json`, numeroChiamate: () => chiamate };
}

test(
  'cercaScuole: 503 (ErroreAnagraficaNonConfigurata) se l\'URL non è mai stato salvato',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      await pool.query(`DELETE FROM impostazioni_sistema WHERE chiave = 'anagrafica_scuole_url'`);
      await assert.rejects(() => cercaScuole(pool, 'pescara'), ErroreAnagraficaNonConfigurata);
    } finally {
      await pool.end();
    }
  },
);

test(
  'scriviUrlAnagraficaScuole + cercaScuole: cerca per denominazione (case-insensitive) e per codice, usa la cache',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    const mock = await avviaServerMock();
    try {
      await scriviUrlAnagraficaScuole(pool, mock.url);
      assert.equal(await leggiUrlAnagraficaScuole(pool), mock.url);

      const perNome = await cercaScuole(pool, 'pescara centro');
      assert.equal(perNome.length, 1);
      assert.equal(perNome[0]!.codice, 'PEIC12345');
      assert.equal(perNome[0]!.comune, 'PESCARA');
      assert.equal(perNome[0]!.indirizzo, 'Via Roma 1');

      const perCodice = await cercaScuole(pool, 'peic678');
      assert.equal(perCodice.length, 1);
      assert.equal(perCodice[0]!.denominazione, 'IC MONTESILVANO NORD');

      // Seconda ricerca (stesso URL): non deve ricontattare il server, la cache
      // (24h) è ancora valida.
      await cercaScuole(pool, 'montesilvano');
      assert.equal(mock.numeroChiamate(), 1);
    } finally {
      await pool.query(`DELETE FROM impostazioni_sistema WHERE chiave = 'anagrafica_scuole_url'`);
      mock.server.close();
      await pool.end();
    }
  },
);

test(
  'cercaScuole: query solo spazi (dopo trim, vuota) ritorna array vuoto -- difesa in profondità oltre allo schema Zod (min 2) di server.ts',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    const mock = await avviaServerMock();
    try {
      await scriviUrlAnagraficaScuole(pool, mock.url);
      const risultato = await cercaScuole(pool, '   ');
      assert.deepEqual(risultato, []);
    } finally {
      await pool.query(`DELETE FROM impostazioni_sistema WHERE chiave = 'anagrafica_scuole_url'`);
      mock.server.close();
      await pool.end();
    }
  },
);

test(
  'cercaScuole: righe senza codice o denominazione nel dataset vengono scartate silenziosamente',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    const mock = await avviaServerMock();
    try {
      await scriviUrlAnagraficaScuole(pool, mock.url);
      const risultato = await cercaScuole(pool, 'senza codice');
      assert.equal(risultato.length, 0, 'la riga senza miur:CODICESCUOLA non deve comparire nei risultati');
    } finally {
      await pool.query(`DELETE FROM impostazioni_sistema WHERE chiave = 'anagrafica_scuole_url'`);
      mock.server.close();
      await pool.end();
    }
  },
);
