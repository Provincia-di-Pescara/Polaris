#!/bin/sh
# Applica le migration prima di avviare il backend — vedi CLAUDE.md/docs/claude/cicd-docker.md
# per il perché (Postgres di produzione su rete privata, non raggiungibile da GitHub Actions).
# Idempotente (golang-migrate non riapplica ciò che è già registrato in schema_migrations)
# e serializzato tra istanze concorrenti (il driver postgres di golang-migrate usa
# pg_advisory_lock internamente) — sicuro anche se più container/redeploy si sovrappongono.
set -e

echo "Applico le migration..."
migrate -path=/migrations -database "$DATABASE_URL" up

exec "$@"
