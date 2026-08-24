import * as Sentry from '@sentry/react';

// Iniettati a runtime dall'entrypoint nginx (public/runtime-config.js, rigenerato
// all'avvio del container): SENTRY_DSN dall'env (è per-istanza, decisa al deploy),
// APP_VERSION dall'identità di build baked in immagine a build time
// (/etc/polaris-build-version — mai dal canale IMAGE_TAG a runtime, mobile su
// dev/latest e quindi inutile per distinguere build diverse). Stringa vuota di
// default (mai `undefined` non dichiarato) se il file non è stato rigenerato
// (dev locale, `pnpm dev`: il file statico in public/ resta col placeholder vuoto).
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
