#!/bin/sh
# Rigenera runtime-config.js all'avvio del container. SENTRY_DSN resta letta
# dall'env (è per-istanza, decisa al deploy) -- APP_VERSION invece viene
# dall'identità di build baked in immagine (/etc/polaris-build-version, scritta
# a build time da BUILD_VERSION in Dockerfile), mai dal canale IMAGE_TAG a
# runtime: quel canale è mobile su dev/latest, quindi identico per build diverse
# e inutile per distinguerle nel footer o in Sentry.
set -e

APP_VERSION="$(cat /etc/polaris-build-version 2>/dev/null || echo sconosciuta)"

cat > /usr/share/nginx/html/runtime-config.js <<JSEOF
window.__SENTRY_DSN__ = "${SENTRY_DSN:-}";
window.__APP_VERSION__ = "${APP_VERSION}";
JSEOF

exec "$@"
