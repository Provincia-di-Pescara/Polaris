#!/bin/sh
# Rigenera runtime-config.js da env del container all'avvio — mai a build time
# (stessa immagine gira su più istanze con SENTRY_DSN/APP_VERSION diversi).
# Vedi il commento gemello in src/sentry.ts.
set -e

cat > /usr/share/nginx/html/runtime-config.js <<JSEOF
window.__SENTRY_DSN__ = "${SENTRY_DSN:-}";
window.__APP_VERSION__ = "${APP_VERSION:-}";
JSEOF

exec "$@"
