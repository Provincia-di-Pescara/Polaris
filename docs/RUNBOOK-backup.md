# Runbook — Backup e restore PostgreSQL

Backup logico (`pg_dump`) del container `backup` in `docker-compose.yml` (produzione), immagine `prodrigestivill/postgres-backup-local:18-alpine`. Giornaliero di default, rotazione 7 giornalieri / 4 settimanali / 6 mensili — configurabile via `BACKUP_SCHEDULE`/`BACKUP_KEEP_*` in `.env` (vedi `.env.example`).

I dump vivono sul volume named `postgres_backups`, mai su bind mount (coerente col vincolo di produzione — vedi CLAUDE.md).

Questo è un **secondo livello** rispetto a un eventuale backup a livello infrastruttura (snapshot VM/storage), da valutare separatamente in fase di deploy: un dump logico non sostituisce uno snapshot fisico, e viceversa.

## Verificare che i backup girino

```bash
docker compose logs backup --tail 50
docker compose exec backup ls -la /backups/daily /backups/weekly /backups/monthly /backups/last
```

Il container espone un healthcheck HTTP interno sulla porta 8080 (non pubblicata sull'host) che verifica l'ultima esecuzione del cron.

## Backup manuale immediato

Non serve aspettare lo `SCHEDULE`: riavviare il container con `BACKUP_ON_START=TRUE` esegue subito un dump, oppure entrare nel container ed eseguire lo script:

```bash
docker compose exec backup /backup.sh
```

## Restore — procedura verificata

**Verificata per davvero** (non solo letta dalla doc dell'immagine) il 2026-07-27: bring-up reale con Postgres 18 + container di backup, canary row inserita, dump prodotto, database droppato e ricreato vuoto, restore dal dump, verificato che schema (45 tabelle) e canary row siano tornati intatti.

⚠️ **Distruttivo**: la procedura sotto sovrascrive il database corrente. Confermare di voler procedere prima di eseguirla contro un ambiente reale.

1. **Fermare i servizi applicativi** (non Postgres) per evitare scritture durante il restore:
   ```bash
   docker compose stop backend engine
   ```

2. **Individuare il dump da ripristinare** (l'ultimo, o uno specifico da `daily`/`weekly`/`monthly`):
   ```bash
   docker compose exec backup ls -la /backups/last
   ```

3. **Drop e ricreazione del database** (dentro il container `postgres`):
   ```bash
   docker compose exec postgres dropdb -U "$POSTGRES_USER" "$POSTGRES_DB"
   docker compose exec postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
   ```

4. **Restore dal dump**, leggendolo dal volume di backup tramite un container temporaneo sulla stessa rete:
   ```bash
   docker run --rm --network polaris_polaris-net \
     -v polaris_postgres_backups:/backups \
     -e PGPASSWORD="$POSTGRES_PASSWORD" postgres:18-alpine \
     sh -c "zcat /backups/last/${POSTGRES_DB}-latest.sql.gz | psql -h postgres -U $POSTGRES_USER -d $POSTGRES_DB -v ON_ERROR_STOP=1"
   ```
   (nomi volume/rete con prefisso `polaris_` per via di `name: polaris` in `docker-compose.yml` — verificare con `docker volume ls`/`docker network ls` se il prefisso reale differisce).

5. **Verificare il restore** prima di riavviare l'applicazione:
   ```bash
   docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt" | head -20
   ```

6. **Riavviare i servizi applicativi**:
   ```bash
   docker compose start engine backend
   ```

## Note

- I verbali di sorteggio, le assegnazioni e la settimana tipo hanno retention legale fissa (intera stagione + termine di impugnazione) — un restore da un dump più vecchio di quella finestra può perdere dati che non dovrebbero mai essere andati persi. Il dump logico non ha idea di questa distinzione: è un backup dell'intero database, non selettivo per tabella.
- Cambiare `JWT_SECRET` dopo un restore da un dump con un `JWT_SECRET` diverso invalida tutte le sessioni attive e rende irrecuperabile il `client_secret` OIDC cifrato salvato in `impostazioni_sistema` (va reinserito da UI — stesso comportamento documentato in CLAUDE.md per la rotazione del secret).
