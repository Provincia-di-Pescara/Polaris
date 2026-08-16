# Schema DB (Fase 1 — implementata)

`db/migrations/`, naming compatibile `golang-migrate` (`NNNNNN_nome.up.sql` / `.down.sql`, eseguibili anche a mano via `psql -f`). Niente ORM: SQL puro, per controllo diretto su exclusion constraint e CHECK complessi richiesti dal dominio.

- `000001_init.up/down.sql` — schema completo (stagioni, impianti/slot, persone/associazioni/abilitazioni, backoffice, domande/fabbisogni/coefficienti, elaborazioni/assegnazioni/sorteggi, concertazione, monitoraggio/convenzioni, audit log).
- `000002_seed_valori_normativi.up/down.sql` — dati normativi reali da Allegato A (classi attività, scaglioni CRS/CAA) + prima versione parametrico con i placeholder 🔺.
- `000003_auth_backoffice.up/down.sql` — `sessioni_backoffice` (refresh token hashati, per la rotation), `tentativi_login_backoffice` (audit sicurezza login, separata da `log_operazioni` — vedi `docs/claude/backend-node.md`).
- `000004_oidc_pubblico.up/down.sql` — `oidc_stato_pkce` (state/code_verifier PKCE, TTL breve, consumo one-shot — Postgres al posto di Redis), `sessioni_persona_fisica` (refresh token hashati per il frontend pubblico, stesso pattern di `sessioni_backoffice`).
- `000005_bootstrap_primo_admin.up/down.sql` — stato `in_attesa_verifica` su `utenti_backoffice` + colonne `token_verifica_hash`/`token_verifica_scade_il` (CHECK di coerenza: token presente ⟺ in attesa). Per il wizard primo avvio.
- `000008_scopo_token_verifica.up/down.sql` — colonna `utenti_backoffice.token_verifica_scopo TEXT` (`'bootstrap'`/`'invito_utente'`, CHECK di coerenza presenza-token⟺presenza-scopo, stesso pattern della `000005`) per separare i namespace del token di verifica tra il wizard di bootstrap e l'invito/reset-password degli utenti backoffice — senza, un token di reset poteva essere usato su `/auth/bootstrap/verifica` bypassando il reset (vedi Critical fix in `docs/claude/backend-node.md`). Backfill delle righe pendenti preesistenti via `creato_da IS NULL` come proxy dello scopo originale.

Punti tecnici degni di nota per chi tocca lo schema:
- `EXCLUDE USING gist` su `slot_settimana_tipo` (spazio + giorno + stagione + intervallo orario) impedisce sovrapposizioni fisiche a livello DB, non solo applicativo. Richiede `btree_gist`.
- `durata_minuti` è colonna `GENERATED ALWAYS ... STORED`, mai scritta a mano.
- **Gotcha verificato**: `boolean::int` non è castabile in Postgres stock (`cannot cast type boolean to integer`). Per i CHECK "esattamente uno tra N campi è valorizzato" si usa `num_nonnulls(a, b) = 1`, non `(a IS NOT NULL)::int + ...`.
- `assegnazioni_slot_attiva_uq` è un indice unico parziale (`WHERE stato IN ('provvisoria','validata')`) — uno slot può avere una sola assegnazione attiva alla volta, ma la storia (decadute/sostituite) resta in tabella.
- Schema validato funzionalmente (non solo sintatticamente) con Postgres 16 e successivamente 18 in Docker: migrazioni up/down pulite, EXCLUDE e CHECK testati con insert di prova che devono fallire/passare come da specifica.
- Ogni modifica a `db/migrations/` va validata contro un container Postgres reale (vedi comandi sotto), non solo controllata a occhio: la sintassi SQL può sembrare corretta e fallire a runtime (es. cast non supportati).

Note ambiente (Windows/Git Bash) per chi lancia questi comandi via Claude Code:
- Docker Desktop su questa macchina non è avviato di default. Se `docker info` fallisce: lanciare `"/c/Program Files/Docker/Docker/Docker Desktop.exe"` in background e attendere (poll `docker info`) prima di usare `docker`. Il container persistente `pg-palestre-dev` si ferma insieme a Docker Desktop — `docker start pg-palestre-dev` (mai ricrearlo, si perderebbero i dati/lo schema). Dopo il riavvio verificare sempre che lo schema sia allineato all'ultima migration attesa prima di lanciare test: se un blocco/sessione precedente ha aggiunto migration mai applicate a questo Postgres persistente (capita quando sessioni diverse lavorano in parallelo su blocchi diversi), i test falliscono con "column does not exist" invece di un errore di connessione, facile da fraintendere come bug di codice. Rilanciare la suite intera subito dopo un riavvio di Docker Desktop può anche mostrare un file casuale (diverso ad ogni run, mai correlato al lavoro in corso) fallire con un `exitCode` numerico enorme (crash nativo del processo Node, non un `AssertionError`) — flakiness nota, non una regressione: verificare rilanciando il file da solo (passa) e la suite intera un'altra volta (passa) prima di trattarla come reale.
- Dopo `git merge` di un branch/worktree che ha aggiunto nuove dipendenze npm, il checkout principale NON ha `node_modules` aggiornato finché non gira `pnpm install` lì — sintomo: ogni test che importa il modulo nuovo fallisce con `ERR_MODULE_NOT_FOUND`, su tutti i file che lo importano in un colpo solo (facile scambiarlo per una regressione sistemica reale). Sempre `pnpm install` nel checkout di destinazione subito dopo un merge locale, prima di rilanciare la suite per la verifica finale del merge.
- `docker exec` con path dentro al container (es. `-f /tmp/x.sql`) da Git Bash: serve `MSYS_NO_PATHCONV=1` davanti al comando, altrimenti il path Unix viene riscritto come path Windows e il comando fallisce. Non applicarlo a `docker cp` quando l'argomento è un path Windows reale (va convertito).
- `docker exec ... -f /dev/stdin < file.sql` per applicare una migration psql fallisce silenziosamente su Git Bash/Windows (nessun errore, nessun effetto) — affidabile solo `docker cp file.sql container:/tmp/x.sql` poi `docker exec container psql -f /tmp/x.sql`.
- `.gitattributes` forza `eol=lf` su `.go`/`.sql`/`.md` (bug reale: CRLF da Windows rompeva `gofmt -l` al primo clone). Aggiungere altri tipi di file testuale lì se necessario, non lasciarli a CRLF di default.
- Seed/chiavi hex nei test (es. seme sorteggio, 32 byte = 64 caratteri): non scriverli a mano, capita facilmente di sbagliare la lunghezza (successo 3 volte in questa sessione). Generarli con `python3 -c "import secrets; print(secrets.token_hex(32))"` e verificarne la lunghezza prima di incollarli.
- `go get` una dipendenza prima di usarla nel codice: `go mod tidy` la rimuove da `go.mod` finché nessun file la importa davvero. Non è un bug, va solo richiamato `go get` di nuovo quando si scrive il codice che la usa.
- Glob `src/**/*.test.ts` NON quotato in bash (CI incluso): senza globstar `**` degrada a `*` e i test top-level spariscono silenziosamente (successo davvero: CI verde con `server.test.ts` mai eseguito). Sempre quotare il pattern e lasciare il glob al test runner di Node.
- `jq` non disponibile in questo ambiente. Per estrarre campi da risposte JSON di `curl` negli smoke test (es. incatenare login→token): `curl ... | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).campo))"`.

Test locale rapido:
```
docker run -d --name pg-palestre -e POSTGRES_PASSWORD=test -e POSTGRES_DB=palestre -p 5432:5432 postgres:18-alpine
psql postgresql://postgres:test@localhost:5432/palestre -f db/migrations/000001_init.up.sql
psql postgresql://postgres:test@localhost:5432/palestre -f db/migrations/000002_seed_valori_normativi.up.sql
```

