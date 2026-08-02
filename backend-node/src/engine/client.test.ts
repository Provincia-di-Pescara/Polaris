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
