import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { creaClientMotore, ErroreMotoreIrraggiungibile, ErroreMotoreDominio } from './client.ts';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function avviaServerFittizio(handler: Handler): Promise<{ baseUrl: string; chiudi: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('impossibile determinare la porta del server fittizio');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    chiudi: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test('eseguiIstruttoria: risposta 200 valida mappata in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/stagioni/stagione-1/istruttoria');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ domande_calcolate: 7 }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.eseguiIstruttoria('stagione-1');
    assert.deepEqual(risultato, { domandeCalcolate: 7 });
  } finally {
    await chiudi();
  }
});

test('eseguiBlocchiGara: risposta 200 valida mappata in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.url, '/stagioni/stagione-2/blocchi-gara');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ elaborazione_id: 'elab-1', numero_assegnazioni: 3, richieste_non_assegnate: 1 }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.eseguiBlocchiGara('stagione-2');
    assert.deepEqual(risultato, { elaborazioneId: 'elab-1', numeroAssegnazioni: 3, richiesteNonAssegnate: 1 });
  } finally {
    await chiudi();
  }
});

test('eseguiPrimaAssegnazione: risposta 200 valida mappata in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.url, '/stagioni/stagione-3/prima-assegnazione');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ elaborazione_id: 'elab-2', numero_assegnazioni: 10, round_eseguiti: 4 }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.eseguiPrimaAssegnazione('stagione-3');
    assert.deepEqual(risultato, { elaborazioneId: 'elab-2', numeroAssegnazioni: 10, roundEseguiti: 4 });
  } finally {
    await chiudi();
  }
});

test('risposta non-2xx con {errore} produce ErroreMotoreDominio col messaggio del motore', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errore: 'stagione inesistente' }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    await assert.rejects(() => client.eseguiIstruttoria('stagione-x'), (err: unknown) => {
      assert.ok(err instanceof ErroreMotoreDominio);
      assert.equal((err as Error).message, 'stagione inesistente');
      return true;
    });
  } finally {
    await chiudi();
  }
});

test('risposta non-2xx senza body JSON valido usa lo status text come messaggio', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((_req, res) => {
    res.writeHead(502);
    res.end('gateway rotto');
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    await assert.rejects(() => client.eseguiIstruttoria('stagione-x'), (err: unknown) => {
      assert.ok(err instanceof ErroreMotoreDominio);
      return true;
    });
  } finally {
    await chiudi();
  }
});

test('connessione rifiutata produce ErroreMotoreIrraggiungibile', async () => {
  // Porta chiusa: nessun server in ascolto su questa porta locale.
  const client = creaClientMotore('http://127.0.0.1:1', 2000);
  await assert.rejects(() => client.eseguiIstruttoria('stagione-y'), (err: unknown) => {
    assert.ok(err instanceof ErroreMotoreIrraggiungibile);
    return true;
  });
});

test('timeout allo scadere produce ErroreMotoreIrraggiungibile', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ domande_calcolate: 1 }));
    }, 500);
  });
  try {
    const client = creaClientMotore(baseUrl, 50);
    await assert.rejects(() => client.eseguiIstruttoria('stagione-z'), (err: unknown) => {
      assert.ok(err instanceof ErroreMotoreIrraggiungibile);
      return true;
    });
  } finally {
    await chiudi();
  }
});

test('anteprimaFabbisogno: invia body snake_case con POST, mappa la risposta in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/anteprima-fabbisogno');
    assert.equal(req.headers['content-type'], 'application/json');
    let corpo = '';
    req.on('data', (chunk: Buffer) => { corpo += chunk.toString(); });
    req.on('end', () => {
      assert.deepEqual(JSON.parse(corpo), {
        associazione_id: 'assoc-1',
        stagione_id: 'stagione-5',
        classe_attivita_codice: 'C1',
        livello_campionato: 'provinciale',
        numero_squadre_federali: 2,
        fd_minuti: '90.000',
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          peso_base: 2,
          incremento_squadre: 1,
          fr_calcolato_minuti: '120.000',
          fr_finale_minuti: '150.000',
          crs: '1.200',
          caa: '1.100',
          csd: '1.050',
          cp: '1.386',
        }),
      );
    });
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.anteprimaFabbisogno({
      associazioneId: 'assoc-1',
      stagioneId: 'stagione-5',
      classeAttivitaCodice: 'C1',
      livelloCampionato: 'provinciale',
      numeroSquadreFederali: 2,
      fdMinuti: '90.000',
    });
    assert.deepEqual(risultato, {
      pesoBase: 2,
      incrementoSquadre: 1,
      frCalcolatoMinuti: '120.000',
      frFinaleMinuti: '150.000',
      crs: '1.200',
      caa: '1.100',
      csd: '1.050',
      cp: '1.386',
    });
  } finally {
    await chiudi();
  }
});

test('anteprimaFabbisogno: livelloCampionato assente diventa null nel body', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    let corpo = '';
    req.on('data', (chunk: Buffer) => { corpo += chunk.toString(); });
    req.on('end', () => {
      const parsed = JSON.parse(corpo) as { livello_campionato: unknown };
      assert.equal(parsed.livello_campionato, null);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          peso_base: 1,
          incremento_squadre: 0,
          fr_calcolato_minuti: '60.000',
          fr_finale_minuti: '60.000',
          crs: '1.000',
          caa: '1.000',
          csd: '1.000',
          cp: '1.000',
        }),
      );
    });
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    await client.anteprimaFabbisogno({
      associazioneId: 'assoc-2',
      stagioneId: 'stagione-6',
      classeAttivitaCodice: 'C1',
      numeroSquadreFederali: 0,
      fdMinuti: '30.000',
    });
  } finally {
    await chiudi();
  }
});

test('eseguiRiassegnazioneResidua: risposta 200 valida mappata in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.url, '/stagioni/stagione-4/riassegnazione-residua');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ elaborazione_id: 'elab-3', numero_assegnazioni: 1, round_eseguiti: 1 }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.eseguiRiassegnazioneResidua('stagione-4');
    assert.deepEqual(risultato, { elaborazioneId: 'elab-3', numeroAssegnazioni: 1, roundEseguiti: 1 });
  } finally {
    await chiudi();
  }
});
