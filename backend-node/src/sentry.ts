import * as Sentry from '@sentry/node';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';

// Identità di build reale (tag git o dev-<sha>, decisa da release.yml), baked
// nell'immagine a build time in un file — non un env var IMAGE_TAG letto a
// runtime: quel canale è mobile su dev/latest, quindi identico per build diverse
// e inutile per distinguerle in Sentry. Stesso schema in engine-go.
function leggiVersioneBuild(): string | undefined {
  try {
    return readFileSync('/etc/polaris-build-version', 'utf-8').trim();
  } catch {
    return undefined;
  }
}

// Opzionale per costruzione: mai un requisito per far girare l'app (dev/test/CI
// restano invariati senza SENTRY_DSN impostata).
export function inizializzaSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: leggiVersioneBuild(),
    // Mai catturare body/cookie/header di default: il progetto tratta dati
    // GDPR-sensibili (art. 53 Doc Principale) — solo messaggio+stack, mai PII
    // implicita da una richiesta HTTP.
    sendDefaultPii: false,
  });
}

// Nessun middleware di errore centralizzato in questo backend: ogni route cattura
// il proprio errore e risponde `res.status(500).json({errore: ...})` (~40 punti,
// vedi server.ts) — instrumentare ognuno singolarmente sarebbe invasivo e fragile
// (nuove route future lo dimenticherebbero). Questo middleware intercetta invece
// `res.json` una sola volta, a monte: ogni risposta 5xx (presente e futura, senza
// bisogno di toccare le route) viene inoltrata a Sentry come messaggio — non
// captureException con lo stack originale (l'oggetto Error non è più disponibile
// a questo livello), ma il messaggio è quasi sempre `err.message` dalla route.
export function middlewareSentry(app: Express): void {
  if (!process.env.SENTRY_DSN) return;
  app.use((req, res, next) => {
    const jsonOriginale = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 500) {
        const messaggio =
          body && typeof body === 'object' && 'errore' in body
            ? String((body as { errore: unknown }).errore)
            : `Errore ${res.statusCode} non tipizzato su ${req.method} ${req.path}`;
        Sentry.captureMessage(messaggio, 'error');
      }
      return jsonOriginale(body);
    }) as typeof res.json;
    next();
  });
}

// Errori che sfuggono a QUALUNQUE try/catch applicativo (crash reali) — qui
// l'oggetto Error è ancora disponibile, captureException preserva lo stack.
export function catturaErroriProcesso(): void {
  if (!process.env.SENTRY_DSN) return;
  process.on('uncaughtException', (err) => Sentry.captureException(err));
  process.on('unhandledRejection', (reason) => Sentry.captureException(reason));
}
