import * as Sentry from '@sentry/react';

// Iniettati a runtime dall'entrypoint nginx (public/runtime-config.js, sovrascritto
// da SENTRY_DSN/APP_VERSION del container all'avvio) — mai a build time: la stessa
// immagine gira su più istanze con DSN/versione diversi. Stringa vuota di default
// (mai `undefined` non dichiarato) se il file non è stato rigenerato (dev locale,
// `pnpm dev`: il file statico in public/ resta col placeholder vuoto).
function runtimeConfig(): { sentryDsn: string; appVersion: string } {
  const g = globalThis as { __SENTRY_DSN__?: string; __APP_VERSION__?: string };
  return { sentryDsn: g.__SENTRY_DSN__ ?? '', appVersion: g.__APP_VERSION__ ?? '' };
}

export function inizializzaSentry(): void {
  const { sentryDsn, appVersion } = runtimeConfig();
  if (!sentryDsn) return;
  Sentry.init({
    dsn: sentryDsn,
    release: appVersion || undefined,
    // Mai catturare dati aggiuntivi di default: il progetto tratta dati
    // GDPR-sensibili (art. 53 Doc Principale) — solo messaggio+stack.
    sendDefaultPii: false,
  });
}

export function versioneApp(): string | null {
  const { appVersion } = runtimeConfig();
  return appVersion.length > 0 ? appVersion : null;
}
