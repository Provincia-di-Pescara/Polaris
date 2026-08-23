import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { middlewareSentry, inizializzaSentry } from './sentry.ts';

// SENTRY_DSN punta a un host locale inesistente: Sentry.init() gira per davvero
// (il wrapping di res.json va esercitato, non solo il ramo "assente"), ma la
// consegna di rete fallisce silenziosamente (comportamento fire-and-forget
// dell'SDK, non responsabilità di questo codice verificare la consegna — quello
// è testato upstream da @sentry/node stesso).
test('middlewareSentry: risposte 2xx passano invariate, 5xx pure (nessuna eccezione, nessun corpo alterato)', async (t) => {
  const dsnOriginale = process.env.SENTRY_DSN;
  process.env.SENTRY_DSN = 'http://public@127.0.0.1:1/1';
  t.after(() => {
    if (dsnOriginale === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = dsnOriginale;
  });
  inizializzaSentry();

  const app = express();
  middlewareSentry(app);
  app.get('/ok', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/errore', (_req, res) => res.status(500).json({ errore: 'qualcosa è andato storto' }));

  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address() as { port: number };

  const rOk = await fetch(`http://127.0.0.1:${port}/ok`);
  assert.equal(rOk.status, 200);
  assert.deepEqual(await rOk.json(), { ok: true });

  const rErrore = await fetch(`http://127.0.0.1:${port}/errore`);
  assert.equal(rErrore.status, 500);
  assert.deepEqual(await rErrore.json(), { errore: 'qualcosa è andato storto' });
});

test('middlewareSentry: senza SENTRY_DSN è un no-op (nessun middleware installato)', async (t) => {
  const dsnOriginale = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  t.after(() => {
    if (dsnOriginale !== undefined) process.env.SENTRY_DSN = dsnOriginale;
  });

  const app = express();
  const numeroMiddlewareIniziale = (app._router?.stack.length as number | undefined) ?? 0;
  middlewareSentry(app);
  const numeroMiddlewareFinale = (app._router?.stack.length as number | undefined) ?? 0;
  assert.equal(numeroMiddlewareFinale, numeroMiddlewareIniziale);
});
