# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Sistema telematico di assegnazione di spazi sportivi pubblici (palestre scolastiche di competenza provinciale). Obiettivo: eliminare discrezionalità umana nell'assegnazione, sostituendola con regole matematiche deterministiche, tracciabili e riproducibili da terzi.

**Stato attuale**: analisi requisiti chiusa. Fase 1 (schema DB), Fase 2 (motore Go: calc + sorteggio + round-robin) e Fase 3 (persistenza Postgres + esposizione HTTP del motore) implementate, testate, verificate con Postgres reale. Fase 4 (Backend Node.js+TypeScript) in corso: scaffold, `GET /stagioni`, autenticazione locale backoffice **e** OIDC SPID/CIE pubblico (login/refresh/logout/rate-limit, entrambe, protezione login-CSRF inclusa) — tutto verificato end-to-end con Postgres reale e IdP mock realistico. Fase 6 (Docker Compose + CI/CD) parziale: `docker-compose.yml`/`.override.yml` verificati con bring-up reale (postgres+engine+backend, 3 bug reali trovati e corretti), workflow GitHub Actions scritti (da verificare con un run reale). Fatti anche: blocchi gara nel motore Go (Fase 6 normativa, art. B.12-15, end-to-end con VA iniziale nel round-robin), audit log applicativo (art. B.39) su login/logout, bootstrap primo admin via wizard email (SMTP di bootstrap da `.env`). Residui noti: CORS/security headers, resto del CRUD nel backend Node, provider SPID/CIE/eIDAS ancora hardcoded a 'spid', OIDC mai testato contro il vero pa-sso-proxy, secret `PRODUCTION_DATABASE_URL` per le migration in pipeline non configurato. Piano completo: `docs/SPEC.md`.

## Versioni target (verificate via web search, non da training data — ricontrollare a inizio di ogni fase nuova, l'ecosistema si muove in fretta)

- **PostgreSQL 18** (`postgres:18-alpine`). PostgreSQL 19 è in beta a luglio 2026, non da usare in produzione.
- **Go 1.26** (patch più recente, es. 1.26.5) per il motore algoritmico — Fase 2 completata.
- **Node.js 24** (Active LTS) per il backend API. Node 26 esiste già come release "Current" ma entra in LTS solo da ottobre 2026 — non usarlo prima per un sistema in produzione.
- **TypeScript 7.0** ovunque (backend Node e frontend), nessun blocco: **React 19.2** scelto come framework per entrambi i frontend (decisione presa proprio per evitare il vincolo Vue/Volar su TS7, non ancora supportato — atteso TS 7.1 ~ottobre 2026).

**Specifica di progetto**: `docs/SPEC.md` — piano completo di tutte le fasi (1–8), mappatura articolo-per-articolo verso Allegato B/Doc Principale, lacune note con priorità, decisioni aperte. Aggiornarla alla chiusura di ogni fase; questo file resta la memoria operativa fine-grained.

## Documenti di riferimento (fonte di verità normativa)

Cartella `documenti/`, formato .docx (leggere con estrazione XML via zipfile+regex, il tool Read nativo non gestisce binari .docx):

- `Documento_Principale_-_Sistema_Assegnazione_Spazi_Sportivi__Completo_.docx` — principi generali, fasi procedimento, tutela nuove associazioni, GDPR.
- `Allegato_A_-_Criteri_di_Assegnazione__Completo_.docx` — formule: fabbisogno riconosciuto (FR), indice di soddisfazione (ISF), coefficienti (CRS, CAA, CSD, CP).
- `Allegato_B_-_Procedura_Operativa__Completo_.docx` — procedura operativa passo-passo (16 fasi, artt. B.1-B.39): dall'accreditamento alla settimana tipo definitiva.

Ogni regola di business implementata deve essere riconducibile a un articolo preciso di questi documenti. Non introdurre logiche non esplicitamente scritte (istruzione esplicita del committente).

**Allegato parametrico**: documento ufficiale dell'Ente con i valori numerici definitivi non ancora prodotto. Sviluppo procede con valori placeholder (marcati 🔺, sezione dedicata sotto), versionati in DB e sostituibili dall'Ente in qualunque momento senza migrazione di schema — non blocca l'avvio di Fase 1/2.

## Regole di calcolo consolidate (decisioni chiuse con lo stakeholder)

I valori numerici sotto indicati sono **default**. Tutti i parametri di business (contrassegnati con 🔧) sono editabili dall'admin tramite UI backoffice, persistiti in tabella `allegato_parametrico` **versionata** (mai hardcoded). Ogni elaborazione (round-robin, sorteggio, verbale) deve referenziare e congelare la versione dei parametri vigente al momento dell'esecuzione, così che una rielaborazione storica resti riproducibile anche dopo che l'admin ha cambiato i default correnti. Le decisioni puramente tecniche/architetturali (non business) restano invece hardcoded nel codice, non esposte in UI.

- **Aritmetica**: tutti i valori (FR, VA, ISF, coefficienti) calcolati con tipo `decimal`, mai float. Arrotondamento a **3 cifre decimali**. _(tecnico, fisso)_
- **ISF**: confronto tra associazioni fatto sul valore decimal arrotondato a 3 cifre (non cross-multiplication su interi). _(tecnico, fisso)_
- 🔧 **Tolleranza parità ISF** (art. B.20): default **0,5%** cioè 0,005 in valore di rapporto. Sotto questa soglia due ISF sono considerati pari ai fini del tie-break su contiguità/concentrazione.
- **FR = 0** (associazione richiede solo giornata di gara, nessun fabbisogno allenamento dichiarato): la condizione art. B.19 "non ha ancora raggiunto il fabbisogno riconosciuto" è falsa per definizione (VA ≥ FR = 0 è sempre vera) → l'associazione non entra mai tra i concorrenti del round-robin fasce allenamento. ISF non calcolato per queste associazioni (mostrato come N/A, mai usato in confronti). _(regola logica, fissa)_
- 🔧 **Fasce pregiate — doppia base di calcolo**: il moltiplicatore di ponderazione (art. A.9, valore default da definire) si applica a VA/ISF (valore). Il limite di concentrazione "minuti settimanali massimi" (art. B.19) è invece verificato sui **minuti grezzi** (tempo fisico reale), non ponderati. Il moltiplicatore è parametro; la regola "quale base si usa dove" è fissa.
- 🔧 **CSD** (art. A.11): formula non ancora definita dallo stakeholder — è demandata allo sviluppo, da elaborare tramite iterazioni su dataset di test realistici, verificando assenza di incentivi a dichiarazioni strategiche. Trattare come sotto-task esplicito da chiudere prima della fine di Fase 2. Coefficienti/scaglioni risultanti saranno parametrici.
- **Sorteggio tracciato** (art. B.38): algoritmo scelto = ranking per **HMAC-SHA256(seme ‖ id_candidato)**, ordinamento crescente sul valore esadecimale risultante. Nessuno stato di PRNG da sincronizzare; riproducibile da terzi con solo seme + lista candidati + HMAC-SHA256 standard. La specifica esatta (encoding, ordine canonico candidati, formato output) va documentata in sezione dedicata prima dell'implementazione. _(algoritmo, fisso — il seme è per-esecuzione, non un parametro di sistema)_
- **Terminazione round-robin** (art. B.22): tetto di sicurezza hard-coded = numero round ≤ numero totale fasce disponibili nella procedura. _(tecnico, fisso, non esposto in UI)_
- **Lock e concorrenza** _(tutto tecnico, fisso)_:
  - Fase 8 (prima assegnazione, round-robin): job batch sequenziale, nessun lock necessario (nessuna scrittura concorrente).
  - Fase 11 (concertazione): lock ottimistico con retry sulle righe slot/assegnazione.
  - Proposte concorrenti sullo stesso slot: risolte **FIFO** su ordine di submission.
  - Validazione proposte (art. B.27): serializzata, sempre **FIFO**.
  - Riassegnazione finale (art. B.29): tocca **solo** gli slot rimasti liberi dopo concertazione; le assegnazioni validate in concertazione non vengono mai ricalcolate.
- **Blocco allenamento nel round-robin**: l'assegnazione di un blocco consuma lo slot-round dell'associazione su **tutte** le fasce che lo compongono, non solo sulla prima incontrata nell'ordine di esame. Se un blocco risulta parzialmente indisponibile, l'associazione titolare viene **ricandidata automaticamente** come candidata singola sulle fasce rimaste libere del blocco, nello stesso round. _(regola logica, fissa)_
- **Tie-break contiguità/concentrazione** (art. B.20): valutato con stato **live** (ISF e assegnazioni aggiornate in tempo reale entro il round), non snapshot a inizio round. La presenza di un'assegnazione già ricevuta nello stesso round (anche in altro impianto) conta ai fini del tie-break di altre associazioni. _(regola logica, fissa)_
- **Audit log**: registra **solo operazioni di scrittura** (non le letture). _(tecnico, fisso)_ Retention: 🔧 default **30 giorni** per il log operativo generico (login, CRUD). Verbali di sorteggio, assegnazioni e settimana tipo sono invece conservati per l'**intera stagione sportiva + termine di impugnazione** _(fisso, non derogabile da admin — requisito legale)_, essendo oggetto di possibile contestazione e di riproducibilità richiesta da terzi.

## Schema DB (Fase 1 — implementata)

`db/migrations/`, naming compatibile `golang-migrate` (`NNNNNN_nome.up.sql` / `.down.sql`, eseguibili anche a mano via `psql -f`). Niente ORM: SQL puro, per controllo diretto su exclusion constraint e CHECK complessi richiesti dal dominio.

- `000001_init.up/down.sql` — schema completo (stagioni, impianti/slot, persone/associazioni/abilitazioni, backoffice, domande/fabbisogni/coefficienti, elaborazioni/assegnazioni/sorteggi, concertazione, monitoraggio/convenzioni, audit log).
- `000002_seed_valori_normativi.up/down.sql` — dati normativi reali da Allegato A (classi attività, scaglioni CRS/CAA) + prima versione parametrico con i placeholder 🔺.
- `000003_auth_backoffice.up/down.sql` — `sessioni_backoffice` (refresh token hashati, per la rotation), `tentativi_login_backoffice` (audit sicurezza login, separata da `log_operazioni` — vedi sezione Backend Node).
- `000004_oidc_pubblico.up/down.sql` — `oidc_stato_pkce` (state/code_verifier PKCE, TTL breve, consumo one-shot — Postgres al posto di Redis), `sessioni_persona_fisica` (refresh token hashati per il frontend pubblico, stesso pattern di `sessioni_backoffice`).
- `000005_bootstrap_primo_admin.up/down.sql` — stato `in_attesa_verifica` su `utenti_backoffice` + colonne `token_verifica_hash`/`token_verifica_scade_il` (CHECK di coerenza: token presente ⟺ in attesa). Per il wizard primo avvio.

Punti tecnici degni di nota per chi tocca lo schema:
- `EXCLUDE USING gist` su `slot_settimana_tipo` (spazio + giorno + stagione + intervallo orario) impedisce sovrapposizioni fisiche a livello DB, non solo applicativo. Richiede `btree_gist`.
- `durata_minuti` è colonna `GENERATED ALWAYS ... STORED`, mai scritta a mano.
- **Gotcha verificato**: `boolean::int` non è castabile in Postgres stock (`cannot cast type boolean to integer`). Per i CHECK "esattamente uno tra N campi è valorizzato" si usa `num_nonnulls(a, b) = 1`, non `(a IS NOT NULL)::int + ...`.
- `assegnazioni_slot_attiva_uq` è un indice unico parziale (`WHERE stato IN ('provvisoria','validata')`) — uno slot può avere una sola assegnazione attiva alla volta, ma la storia (decadute/sostituite) resta in tabella.
- Schema validato funzionalmente (non solo sintatticamente) con Postgres 16 e successivamente 18 in Docker: migrazioni up/down pulite, EXCLUDE e CHECK testati con insert di prova che devono fallire/passare come da specifica.
- Ogni modifica a `db/migrations/` va validata contro un container Postgres reale (vedi comandi sotto), non solo controllata a occhio: la sintassi SQL può sembrare corretta e fallire a runtime (es. cast non supportati).

Note ambiente (Windows/Git Bash) per chi lancia questi comandi via Claude Code:
- Docker Desktop su questa macchina non è avviato di default. Se `docker info` fallisce: lanciare `"/c/Program Files/Docker/Docker/Docker Desktop.exe"` in background e attendere (poll `docker info`) prima di usare `docker`.
- `docker exec` con path dentro al container (es. `-f /tmp/x.sql`) da Git Bash: serve `MSYS_NO_PATHCONV=1` davanti al comando, altrimenti il path Unix viene riscritto come path Windows e il comando fallisce. Non applicarlo a `docker cp` quando l'argomento è un path Windows reale (va convertito).
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

## Motore Go (Fase 2 — completata)

`engine-go/`, modulo `github.com/provincia/palestre-engine`, Go 1.26. Nessuna installazione Go locale in questo ambiente di sviluppo: build/test/format/vet vanno eseguiti via Docker (`golang:1.26-alpine`), come per Postgres. Sviluppato rigorosamente in TDD (skill `superpowers:test-driven-development`): ogni funzione ha test scritto e verificato RED prima dell'implementazione. In Go il RED spesso è un errore di compilazione (`undefined: NomeFunzione`), non un'asserzione a runtime — è comunque RED valido (fallisce perché manca la feature, non per typo).

Fatto: `internal/calc/` — calcolatori puri, nessuna dipendenza da DB/HTTP (coerente col vincolo di isolamento del motore), arrotondamento sempre con `github.com/shopspring/decimal` (mai float, mai `math`):
- `IncrementoSquadre` — lookup scaglioni art. A.4
- `LookupCRS` / `LookupCAA` / `LookupCSD` — lookup scaglioni art. A.6/A.7/A.11 (CSD su placeholder, valori da tarare)
- `CalcolaCP` — art. A.12 (CRS×CAA×CSD, round 3 cifre)
- `CalcolaFR` — art. A.5 (FR calcolato + FR finale = min(FD, calcolato))
- `CalcolaISF`, `ISFMinore`, `ISFInTolleranza` — art. A.13/B.16/B.20, incluso il caso FR=0 (ISF non definito, decisione stakeholder)

Fatto: `internal/sorteggio/` — sorteggio tracciato art. B.38 (HMAC-SHA256 rank-asc), formato `hash_verbale` finalizzato (vedi specifica sotto). Testato con test basati su proprietà (determinismo, indipendenza dall'ordine input, ranking valido, sensibilità a seme/candidati) invece di hash hardcoded — verificare a mano un digest SHA-256 non è affidabile, la logica sopra la stdlib crypto è quello che va testato.

Fatto: `internal/roundrobin/` — Fase 8-9 completa (art. B.17-22):
- `OrdineEsameFasce` — ordine di esame (decrescente richiedenti, poi pregiate, poi cronologico), determinato una sola volta
- `RispettaLimiti` / `RispettaLimiteGiornateGara` — limiti di concentrazione (minuti grezzi, slot per impianto, fasce pregiate, giornate gara)
- `SceglieVincitore` — catena di priorità completa art. B.20-21 (ISF→contiguità/presenza impianto→preferenza→CP→sorteggio), narrowing progressivo per criterio
- `SceglieVincitoreBloccoGara` — catena **diversa** art. B.14 per i blocchi gara (CRS→CP→sorteggio, niente ISF)
- `Esegui` — loop round completo: una assegnazione per round per associazione, blocco allenamento assegnato/atomico su tutte le sue fasce se disponibile (decisione Q17), rottura blocco + ricandidatura individuale automatica sulle fasce libere se una fascia del blocco va ad altri (decisione Q18), chiusura su B.22.1/.2/.3, tetto di sicurezza = numero totale fasce

Testato con scenari comportamentali end-to-end (non solo unità isolate): distribuzione bilanciata tra associazioni pari, vincolo "una assegnazione per round", blocco vinto intero, blocco rotto e ricandidatura, tutte e 3 le condizioni di chiusura.

Fatto: `internal/istruttoria/` — Fase 4 (art. B.8): orchestra i calcolatori di `calc/` per calcolare FR e coefficienti (CRS/CAA/CSD/CP) di una singola domanda, applicando i valori neutri di prima stagione (incremento squadre e CAA neutri, non il CRS — dipende solo dalla classe dichiarata quest'anno). **Assunzione esplicita da confermare con l'Ente**: Allegato A/B parlano di un unico "fabbisogno dichiarato (FD)" ma la domanda raccoglie sia un minimo che un ottimale (Doc Principale art. 5) — implementato FD = fabbisogno_ottimale_minuti, non il minimo. Vedi commento doc del package.

Fatto: **quota nuove associazioni** (art. 12 Doc Principale, parametro 🔧 `quota_nuove_associazioni_pct`, default 0 = disattivata — migration `000006`): `Associazione.PrimaStagione` (dato riusato da `coefficienti_associazione.prima_stagione`, già calcolato in istruttoria) e `InputEsecuzione.QuotaNuoveAssociazioniPct` in `internal/roundrobin`. Meccanismo (documentato in `docs/SPEC.md` §7-bis.1, **assunzione da confermare con l'Ente**: il testo normativo non specifica un meccanismo, solo la facoltà): N = floor(pct × fasce totali); finché le fasce vinte da associazioni prima-stagione sono < N, il pool di candidati di una fascia contesa si restringe alle sole prima-stagione **se almeno una è candidata** (altrimenti pool intero — la quota non spreca fasce che nessuna nuova richiede), poi la catena B.20 normale decide tra loro. Un blocco allenamento vinto da una prima-stagione conta tutte le sue fasce nel contatore. **Gotcha di test scoperto**: il loader Postgres prende sempre la versione parametrica con `valida_dal` più recente a livello globale — un test che inserisce una nuova versione (per testare un valore diverso da 0) inquina lo stato di *ogni* altro uso di quel DB persistente finché non viene ripulita esplicitamente; nessuna FK verso `stagioni_sportive`/`parametrico_versioni` ha `ON DELETE CASCADE` (a differenza degli slot), quindi il cleanup va scritto a mano nell'ordine giusto (assegnazioni→elaborazioni→domande→scaglioni CSD→versione parametrica→stagione) — verificato che dopo il cleanup non resti alcuna versione con la quota non-zero.

Fatto: `internal/gara/` — Fase 6 (art. B.12-14): blocco gara = coppia MINIMA di 2 slot consecutivi (stesso spazio+giorno, fine==inizio — Doc Principale art. 9 "almeno due slot consecutivi"; **assunzione da confermare con l'Ente**: i "requisiti tecnici" testuali della richiesta non sono modellabili come vincolo automatico, eventuali fasce attigue extra si gestiranno in concertazione). L'ammissibilità slot per richiesta (disciplina compatibile + omologazione impianto) arriva dal chiamante come set precalcolato in SQL — il package resta puro. Loop deterministico: ordine canonico dei blocchi, concorrenza per blocco risolta con la catena B.14 (CRS→CP→sorteggio, riusa `SceglieVincitoreBloccoGara`), chi perde ripiega sul blocco successivo nell'iterazione dopo, limite giornate gara per associazione. Gotcha di dominio: la concorrenza B.14 è tra ASSOCIAZIONI — due richieste della stessa associazione sullo stesso blocco vanno deduplicate prima del sorteggio (candidati duplicati = errore in `sorteggio.Esegui`).

Fatto: `internal/postgres/` — layer di persistenza (driver `jackc/pgx/v5`, nessun ORM, coerente con lo stile SQL puro dello schema):
- `CaricaParametricoAttivo` — ultima versione parametrica pubblicata (`ORDER BY valida_dal DESC LIMIT 1`) + tutti gli scaglioni collegati (CSD versionati, CRS/CAA/incremento-squadre normativi globali). Valori NUMERIC sempre letti via `::text` + `decimal.NewFromString`, mai binding diretto — pgx v5 non ha supporto nativo per `shopspring/decimal` senza un pacchetto ponte aggiuntivo, e il cast testuale evita quella dipendenza in più.
- `EseguiIstruttoria` — Fase 4 (art. B.8): carica le domande ammesse di una stagione (incluso il calcolo SQL di "prima stagione": nessuna domanda ammessa della stessa associazione in una stagione con `data_inizio` precedente), chiama `istruttoria.Calcola` per ciascuna, upserta `fabbisogni_riconosciuti`+`coefficienti_associazione` in un'unica transazione (`ON CONFLICT (domanda_id) DO UPDATE`).
- `EseguiRoundRobin` — Fase 8 end-to-end: carica fasce/richieste/blocchi allenamento/associazioni (richiede istruttoria già eseguita, legge FR/CP da lì), chiama `roundrobin.Esegui`, persiste `elaborazioni`+`assegnazioni`+(se necessario)`sorteggi`+`sorteggio_candidati` in un'unica transazione. Esclude gli slot con assegnazione attiva (blocchi gara) e ricostruisce da quelle VA iniziale (art. B.15, minuti grezzi come da B.14) e stato di concentrazione iniziale (`roundrobin.InputEsecuzione.StatoIniziale`: i minuti gara contano nei limiti B.19 e l'impianto gara conta nel tie-break di contiguità B.20).
- `EseguiBlocchiGara` — Fase 6 end-to-end: carica richieste `in_esame` con CRS/CP (richiede istruttoria), ammissibilità slot in SQL (spazio compatibile con una disciplina della domanda; se `necessita_impianto_omologato`, disciplina ∈ `spazi_sportivi.omologazioni`), chiama `gara.Esegui`, persiste elaborazione tipo `blocchi_gara` + una riga `assegnazioni` PER SLOT del blocco (tipo `blocco_gara`, `valore_minuti` grezzi) + stato richieste (`assegnata`/`non_assegnata`) + verbali sorteggio con `articolo_riferimento='B.14'`.
- Nota: `roundrobin.Assegnazione` non porta ancora l'ISF al momento dell'assegnazione — colonna `isf_al_momento` (nullable) lasciata NULL per ora, non blocca nulla ma andrà chiuso se serve in dashboard/audit.
- Fixture dei test di integrazione: ogni valore UNIQUE (nomi, CF, PIVA, protocolli) con suffisso random per-esecuzione — il DB locale persiste tra i run, valori fissi = duplicate key al secondo run (stesso identico gotcha visto nei test Node).

Validato con test di integrazione reale (non mockato): rete Docker dedicata, Postgres con schema+seed applicati, container Go connesso via rete, scenario end-to-end istruttoria→round-robin verificato sui dati effettivamente persistiti in DB (non solo sul valore di ritorno Go).

Fatto: `internal/httpapi/` + `cmd/service/` — esposizione HTTP verso il backend Node. Niente router esterno: `http.ServeMux` con pattern nativi Go 1.22+ (`"POST /stagioni/{id}/istruttoria"`). Le dipendenze Postgres sono iniettate come funzioni (`Server.EseguiIstruttoria`, `Server.EseguiRoundRobin`), non un'interfaccia — i test della logica HTTP non richiedono un DB reale. `GeneraSeme` iniettabile per test deterministici; default `GeneraSemeCSPRNG` (`crypto/rand`, 32 byte hex, coerente col requisito CSPRNG dell'art. B.38).

Endpoint:
- `GET /healthz`
- `POST /stagioni/{id}/istruttoria` → `{"domande_calcolate": N}`
- `POST /stagioni/{id}/blocchi-gara` → genera il seme, esegue la Fase 6, `{"elaborazione_id", "numero_assegnazioni", "richieste_non_assegnate"}`
- `POST /stagioni/{id}/prima-assegnazione` → genera il seme, esegue il round-robin, `{"elaborazione_id", "numero_assegnazioni", "round_eseguiti"}`

`cmd/service/main.go` legge `DATABASE_URL`/`PORT`, shutdown pulito su SIGTERM. Verificato con smoke test reale (non solo `go build`): binario avviato con `go run` contro Postgres vero su rete Docker dedicata, tutti e 3 gli scenari chiamati via `curl` — healthz 200, istruttoria/prima-assegnazione su stagione vuota (0 domande, chiusura round-robin corretta con 0 fasce), stagione inesistente propaga correttamente il vincolo FK come errore 500 leggibile (non un crash).

Da fare (Fase 3, resto): nessuna autenticazione/autorizzazione sull'HTTP del motore ancora (accettabile per ora: è un servizio interno, il backend Node farà da gatekeeper — da rivedere quando si disegna la rete tra i container). Riassegnazione finale (art. B.29) non ancora esposta (riuserà il round-robin sui soli slot liberi post-concertazione).

Comandi (container Postgres e Go possono girare in parallelo, porte diverse):
```
docker volume create palestre-go-mod-cache   # una tantum, cache moduli persistente
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -w /app golang:1.26-alpine go test ./... -v
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -w /app golang:1.26-alpine sh -c "gofmt -w . && go vet ./..."
```
(`MSYS_NO_PATHCONV=1` necessario solo da Git Bash su Windows, vedi nota ambiente sopra — qui serve perché `-w /app` è un path del container, non dell'host.)

Test di integrazione `internal/postgres` (skippato di default, serve `TEST_DATABASE_URL`):
```
docker network create palestre-integration-net
docker run -d --name pg-integration --network palestre-integration-net -e POSTGRES_PASSWORD=test -e POSTGRES_DB=palestre postgres:18-alpine
# attendere pg_isready, poi applicare db/migrations/000001 e 000002 con psql dentro il container (vedi sezione Schema DB)
MSYS_NO_PATHCONV=1 docker run --rm --network palestre-integration-net \
  -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod \
  -e TEST_DATABASE_URL="postgres://postgres:test@pg-integration:5432/palestre?sslmode=disable" \
  -w /app golang:1.26-alpine go test ./internal/postgres/... -v
# poi: docker rm -f pg-integration && docker network rm palestre-integration-net
```

Smoke test del binario reale (`cmd/service`) contro Postgres vero: stessa rete Docker+migrazioni del test di integrazione sopra, ma al posto di `go test` si lancia `go run ./cmd/service` con `-p HOSTPORT:8080 -e DATABASE_URL=...`, poi `curl localhost:HOSTPORT/...` dall'host. Utile per verificare il wiring di `main.go` (mai coperto da unit test).

## Backend Node (Fase 4 — in corso)

`backend-node/`, Node.js 24 (disponibile **in locale** su questa macchina, a differenza di Go/Postgres — niente Docker necessario per lo sviluppo Node, solo per Postgres di test). TypeScript 7.0.2 esatto (`--save-exact`, coerente con la ricerca versioni fatta a inizio progetto).

**Package manager: pnpm** (direttiva esplicita) — non npm. Repo avrà 3 pacchetti Node/TS nel tempo (backend + 2 frontend), pnpm workspaces è pensato per questo (link tra pacchetti, store condiviso, niente dipendenze fantasma). Installato via `npm install -g pnpm` (non `corepack enable`: su questa macchina Windows fallisce con EPERM scrivendo in `Program Files`, servono permessi admin che non ci sono). Comandi: `pnpm install`, `pnpm add <pkg>`, `pnpm add -D <pkg>`, `pnpm exec tsc`.

Scelte tecniche:
- **Niente ORM**: `pg` diretto con query parametrizzate, stessa disciplina SQL puro di `db/migrations` e `internal/postgres`.
- **Niente build step**: Node 24 esegue `.ts` nativamente (type-stripping). `tsc` usato **solo** per il typecheck (`noEmit: true`, `allowImportingTsExtensions: true`) — mai per emettere JS. Import sempre con estensione `.ts` esplicita (richiesta dalla risoluzione ESM nativa di Node); questo è in conflitto con la convenzione tsc classica ("importa come .js anche se il sorgente è .ts") se si prova a compilare con `tsc` normale — da qui la scelta di non compilare affatto.
- **Express** per il routing (a differenza di Go, Node non ha un router nativo con path pattern come `http.ServeMux` di Go 1.22+ — qui un router esterno è giustificato, non un'eccezione alla minimalità).
- **zod** per la validazione runtime di ogni input HTTP — i tipi TypeScript spariscono a runtime, non proteggono da body malformati.
- Test con `node:test` nativo (`node --test`), niente Jest/Vitest. Stesso pattern Go: test contro Postgres reale via `TEST_DATABASE_URL`, skip pulito se non impostata. Test HTTP end-to-end con `fetch` nativo di Node contro il server vero (`app.listen`), niente supertest.

Fatto — scaffold + primo endpoint verticale: `GET /healthz`, `GET /stagioni` (legge da Postgres reale, mappa `snake_case`→`camelCase`).

Fatto — **autenticazione locale backoffice** (`src/auth/`), NON OIDC/SPID (quello resta a parte, serve un IdP reale o mock, sistema diverso):
- `password.ts` — hash con `node:crypto` scrypt nativo (niente bcrypt/argon2, niente dipendenza compilata). Formato self-describing `scrypt:N:r:p:salt:hash`: se in futuro si alzano i parametri per hardware più veloce, gli hash vecchi restano verificabili con i propri parametri originali invece di rompersi. **Gotcha reale incontrato**: `promisify(crypto.scrypt)` sceglie l'overload TS sbagliato (perde le opzioni N/r/p) — usare una `Promise` scritta a mano attorno alla callback-form. Altro gotcha: `128*N*r` deve stare sotto `maxmem` — con N=32768,r=8 si tocca **esattamente** il default di Node (32 MiB) e fallisce; serve passare `maxmem` esplicito con margine.
- `jwt.ts` — access token JWT, algoritmo **pinnato a `HS256`** sia in firma che in verifica (mai fidarsi dell'`alg` nell'header del token: previene l'attacco di algorithm-confusion tipo `alg=none`). Scadenza breve, 15 minuti.
- `refreshToken.ts` — refresh token casuale ad alta entropia, **hash SHA-256** (non scrypt: è già casuale, non serve un KDF lento, solo un digest per confronto sicuro). Salvato hashato in `sessioni_backoffice` (migration `000003`), mai in chiaro.
- Refresh con **rotation**: ogni refresh revoca il token usato e ne emette uno nuovo — un refresh token rubato resta valido una sola volta.
- `tentativi_login_backoffice` (migration `000003`) — tabella **separata** da `log_operazioni`: quest'ultima richiede sempre un attore noto (CHECK `num_nonnulls`), ma un login con email inesistente non ha nessun `utente_backoffice_id` da collegare. Non si è toccato il CHECK esistente (giusto per il suo scopo di audit di business) — nuova tabella dedicata al monitoraggio sicurezza.
- **No enumerazione utenti**: email inesistente e password sbagliata restituiscono lo **stesso** errore HTTP (401 generico) — l'esito specifico è distinto solo internamente in `tentativi_login_backoffice`, mai esposto al client.
- Rate limiting su `/auth/login` con `express-rate-limit` (10 tentativi/15 min per IP) — protezione volumetrica di base, non sostituisce un lockout per-account (non implementato, richiederebbe altre colonne schema).
- Validato end-to-end reale, non solo unit test: `node --test` contro Postgres reale (intero ciclo login→refresh→logout→riuso-token-revocato), più smoke test HTTP con server vero (`node src/index.ts`) + `curl` su tutti gli scenari (login ok/sbagliato/inesistente/malformato, `/auth/me` con e senza token, refresh, riuso post-rotation).

Fatto — **audit log applicativo** (art. B.39): `repository/logOperazioni.ts` (`registraOperazione`, attore = union backoffice XOR persona fisica, coerente col CHECK `num_nonnulls` dello schema), agganciato a login/logout di entrambi i mondi (solo esiti riusciti — i login falliti restano in `tentativi_login_backoffice`, non hanno attore certo). Accetta `Db` (interfaccia minima Pool|PoolClient in `db.ts`) per poter girare dentro transazioni.

Fatto — **bootstrap primo admin (wizard primo avvio)**: migration `000005`, flusso `auth/bootstrapAdmin.ts` + endpoint `GET /auth/bootstrap/stato`, `POST /auth/bootstrap/primo-admin` (crea admin `in_attesa_verifica`, invia email con link, 409 se esiste già un utente verificato; una nuova richiesta sostituisce un pendente mai verificato), `POST /auth/bootstrap/verifica` (token one-shot SHA-256 hashato, TTL 24h → account attivo + audit log). **SMTP di bootstrap da `.env`** (`SMTP_*`, `BACKOFFICE_BASE_URL` — decisione esplicita del committente: al primo avvio non esiste un admin che possa configurare SMTP da UI; senza `SMTP_HOST` l'endpoint risponde 503). Modulo email `src/email/smtp.ts` (nodemailer, trasporto iniettabile). Verificato: unit+HTTP con Postgres reale, SMTP con Mailpit reale (container `axllent/mailpit`, API su :8025 per leggere le email nei test), smoke test end-to-end completo (server vero + email vera + curl: stato→richiesta→link dalla mail→verifica→login→riuso token 401).

Note test (gotcha reali):
- I test che richiedono il controllo di un'intera tabella (es. bootstrap: "nessun utente esiste") NON possono girare sul DB condiviso: i file di test girano **in paralleli** e READ COMMITTED rende visibili gli insert committati dagli altri anche dopo una DELETE locale. Soluzione: `src/testutil/dbDedicato.ts` (CREATE DATABASE usa-e-getta + migration reali + DROP).
- Fixture con valori UNIQUE (email, nomi stagione): sempre con suffisso random per-esecuzione — il DB locale di sviluppo persiste tra i run, valori fissi = duplicate key al secondo run (successo davvero). In CI non si vede perché il DB è sempre fresco.
- La search di Mailpit matcha per sottostringa e il catcher accumula tra i run: nei test filtrare per oggetto esatto univoco, mai `assert total === 1`.

Da fare: CORS + security headers (`helmet`) — rimandato, da decidere insieme al design della rete tra container, lockout per-account sui tentativi falliti (richiede migration), middleware `richiedeRuolo('admin')` (il ruolo è già nel JWT), CRUD per le altre ~15 entità dello schema, orchestrazione delle 16 fasi procedurali (Allegato B), coda verso l'HTTP del motore Go (`internal/httpapi`) per istruttoria/prima-assegnazione, audit log sulle scritture CRUD future (helper pronto).

## OIDC SPID/CIE (frontend pubblico) — implementato

Il proxy SPID/CIE→OIDC in uso è **pa-sso-proxy** (SATOSA), già in esercizio, gestito dall'Ente al di fuori di questo repo — provider reale, non un mock da simulare. Standard OIDC lato nostro (Authorization Code + PKCE), niente SAML/SPID-specifico nel nostro codice: tutta la complessità SPID/CIE/eIDAS resta nel proxy.

Riferimento diretto usato in fase di analisi (stesso proxy, stesso stack TypeScript, licenza EUPL-1.2): [Comune-di-Montesilvano/ComunicaPA](https://github.com/Comune-di-Montesilvano/ComunicaPA) (`apps/backend/src/auth/oidc/oidc-flow.service.ts`, `.../strategies/oidc-citizen.strategy.ts`).

**Interoperabilità pa-sso-proxy (vincoli protocollari applicati nel codice, non assunzioni):**
- Issuer = radice del proxy **senza** `/OIDC` in fondo; discovery su `/.well-known/openid-configuration`; endpoint effettivi sotto `/OIDC/`.
- Supporta **solo** `client_secret_basic` (header `Authorization: Basic`) — client_secret nel body → 401 HTML. `oidc/flow.ts` usa sempre l'header, mai il body.
- Claim codice fiscale: `fiscal_number` formato **`TINIT-<CF>`**, più varianti eIDAS/SPID URI-based — `oidc/claims.ts` prova più chiavi in ordine.
- Claim nome: spesso `given_name`/`family_name` separati, senza `name` — gestito con fallback.

**`backend-node/src/oidc/` + `src/auth/loginPubblico.ts` — implementazione completa:**
- `crypto.ts` — AES-256-GCM per il `client_secret` at-rest, chiave derivata da `JWT_SECRET` via scrypt con context label dedicato (non i byte grezzi del secret: separazione di scopo firma-JWT/cifratura).
- `config.ts` — config OIDC in `impostazioni_sistema` (chiave `'oidc'`, già nello schema Fase 1), secret sempre cifrato in scrittura/decifrato in lettura.
- `pkce.ts` + `repository/oidcPkceState.ts` — PKCE S256, `state`/`code_verifier` in tabella Postgres dedicata (`oidc_stato_pkce`, migration `000004`) con TTL 5 min e consumo one-shot (`DELETE...RETURNING`, non Redis: coerente con "riusa Postgres" già seguito nel resto del progetto).
- `discovery.ts` — `.well-known`, cache 10 min in memoria.
- `idTokenVerify.ts` — verifica firma via JWKS del proxy (`jwks-rsa`), **mai** con un secret nostro. Testato con RSA vera generata al volo: issuer/audience/firma-manomessa/scadenza tutti verificati a rifiutare correttamente.
- `flow.ts` — orchestrazione `costruisciUrlAutorizzazione`/`scambiaCode`.
- `auth/loginPubblico.ts` + `repository/personeFisiche.ts` + `repository/sessioniPersonaFisica.ts` — dopo lo scambio, trova/crea `persone_fisiche`, emette JWT proprio (`jwtPubblico.ts`, **non** pass-through dell'id_token del proxy, a differenza di ComunicaPA — scelto per coerenza con lo stesso pattern già usato per il backoffice: JWT+refresh rotation nostri).
- **`audience` sui JWT**: sia `jwt.ts` (backoffice, `aud:'backoffice'`) che `jwtPubblico.ts` (`aud:'pubblico'`) usano lo stesso `JWT_SECRET` ma audience diverse, controllate esplicitamente in verifica — un token pubblico non deve mai passare per un endpoint backoffice anche se la firma è valida. Gap reale trovato in retrospettiva: `jwt.ts` non aveva audience prima di costruire `jwtPubblico.ts`, aggiunta a entrambi.

**Endpoint**: `GET /auth/oidc/start` (redirect, rate-limited), `POST /auth/oidc/callback` (`{code,state}`), `POST /auth/pubblico/refresh`, `POST /auth/pubblico/logout`, `GET /auth/pubblico/me` (protetta).

**Due bug reali trovati dallo smoke test HTTP, non dai test automatici iniziali** (motivo per cui lo smoke test resta necessario anche con test di integrazione già verdi — i test iniziali non avevano esercitato "stesso codice fiscale, `oidc_subject` diverso", scenario realistico: stessa persona autenticata via SPID una volta e via CIE un'altra, o comunque il proxy che emette `sub` diversi tra sessioni):
- `persone_fisiche` ha **due** vincoli UNIQUE indipendenti (`codice_fiscale`, e `(oidc_provider, oidc_subject)`). Un `ON CONFLICT` su uno solo dei due fallisce nell'altro caso. Fix in `repository/personeFisiche.ts`: due lookup espliciti in sequenza (per subject, poi per CF) prima di un eventuale INSERT — niente `ON CONFLICT` unico. Race TOCTOU teorica tra le richieste accettata (esito peggiore: errore di vincolo raro, non dato corrotto), non usata una transazione SERIALIZABLE per un login.
- Verificato anche: cifratura config con un `JWT_SECRET` diverso da quello con cui è stata scritta produce un errore criptico Node (`Unsupported state or unable to authenticate data`) invece di un messaggio chiaro — comportamento strutturalmente corretto (fallisce, non decifra dati sbagliati) ma da tenere a mente: **cambiare `JWT_SECRET` in produzione rende irrecuperabile ogni `client_secret` già cifrato**, va reinserito da UI (stesso comportamento di ComunicaPA, per lo stesso motivo).

**Placeholder esplicito da confermare con l'Ente**: `OIDC_PROVIDER_DEFAULT = 'spid'` in `loginPubblico.ts` — non sappiamo ancora come pa-sso-proxy segnala SPID vs CIE vs eIDAS nei claim reali, va verificato a integrazione con l'IdP vero.

**Terzo bug reale, trovato da una security review automatica dopo il primo giro di implementazione** (non dai nostri test, che validavano solo il "cammino felice" del binding PKCE): `state` non era legato al browser che avvia il flusso. PKCE da solo **non previene login CSRF/session fixation**: un attaccante può completare il **proprio** login legittimo (code+state autentici, PKCE valido perché il `code_verifier` è recuperato lato server via `state`, non dal browser) facendolo eseguire dal browser della vittima — il server autenticherebbe la vittima **come l'attaccante**. Rilevante in particolare qui perché ogni domanda/operazione deve tracciare la vera persona fisica (art. 53 Doc Principale) — un'identità scambiata rompe quella garanzia.

Fix (`server.ts`, non in `oidc/flow.ts` — è un concern HTTP, i moduli oidc/auth restano transport-agnostic):
- `GET /auth/oidc/start` imposta un cookie firmato (`cookie-parser`, secret = `JWT_SECRET`) con lo `state`: `httpOnly`, `sameSite:'lax'`, `secure` solo in produzione, `path:'/auth/oidc'`, TTL 5 min (stesso del record in `oidc_stato_pkce`).
- `POST /auth/oidc/callback` legge il cookie **prima** di chiamare `eseguiCallbackOidc`/consumare lo `state` in DB, lo confronta con `state` del body a tempo costante (`crypto.timingSafeEqual`, stesso motivo per cui le password non si confrontano con `===`) — mancante o non corrispondente → 401 immediato, cookie sempre ripulito.
- Testato con `server.test.ts`: server HTTP vero (`app.listen(0)`) + IdP mock vero, replica letterale dello scenario d'attacco (callback senza cookie; cookie di una sessione usato per completare lo `state` di un'altra) — entrambi correttamente 401, il percorso legittimo resta 200.
- `costruisciUrlAutorizzazione` ora restituisce `{url, state}` invece della sola stringa URL (serviva lo `state` esplicito per impostare il cookie) — firma cambiata, tutti i chiamanti (test inclusi) aggiornati.

**Non verificato — richiede credenziali reali**: tutto il codice è stato testato con un IdP mock realistico (RSA vera, stesso protocollo, stesso vincolo `client_secret_basic`) ma **mai contro il vero pa-sso-proxy**. Serve un giro di verifica con `client_id`/`client_secret`/`issuer`/`redirect_uri` reali prima del go-live — non ne abbiamo l'accesso da qui.

**Gotcha da tenere a mente per quando ci sarà un reverse proxy esterno davanti al backend** (non ancora rilevante, non c'è ancora): un proxy esterno può sostituire il body delle risposte non-2xx con una pagina HTML propria, rendendo illeggibili gli errori applicativi — pattern da valutare allora: rispondere comunque 200 con un flag tipo `{ok:false, errore:'...'}` per gli errori "previsti" che l'utente deve poter leggere, riservando i codici HTTP di errore veri a fallimenti non previsti.

## CI/CD e Docker Compose (Fase 6 — parziale)

Riferimento diretto usato per la struttura (stesso pattern prod/dev, stesso motivo): [Comune-di-Montesilvano/ComunicaPA](https://github.com/Comune-di-Montesilvano/ComunicaPA) — `docker-compose.yml` + `docker-compose.override.yml` + `.env.example`.

**`docker-compose.yml`** (produzione) — immagini da `ghcr.io/provincia-di-pescara/...`, **niente bind mount** (deploy non deve dipendere da un checkout del repo sull'host — unico volume named è `postgres_data`). `docker-compose.override.yml` (sviluppo) — build locale da `Dockerfile.dev`, bind mount per hot-reload, porte esposte. Attivato impostando `COMPOSE_FILE=docker-compose.yml;docker-compose.override.yml` in `.env` (mai in produzione); **attenzione**: se entrambi i file sono presenti nella stessa directory, `docker compose` li unisce automaticamente anche senza `COMPOSE_FILE` — per validare SOLO la produzione serve `docker compose -f docker-compose.yml ...` esplicito.

**`.env.example`** — solo bootstrap (Postgres, `JWT_SECRET`, porte). Tutto il resto (OIDC, SMTP, branding, parametrico) resta in DB via `impostazioni_sistema`/`parametrico_versioni`, mai in env — stesso principio di ComunicaPA (che deriva anche la chiave di cifratura dei settings da `JWT_SECRET`, esattamente come la nostra `oidc/crypto.ts`).

**Migration: NON girano come container** (decisione presa in sessione, dopo aver valutato e scartato un servizio `migrate` dedicato in compose). Le esegue `.github/workflows/release.yml` come job separato, con `docker run migrate/migrate` diretto contro `secrets.PRODUCTION_DATABASE_URL` — **gap esplicito**: quel secret non è ancora configurato, il job fa un no-op con warning finché non lo è. Serve prima decidere come il runner GitHub-hosted raggiunge il Postgres di produzione (rete privata → serve self-hosted runner, o endpoint esposto con allowlist — non ancora deciso).

**Tre bug reali trovati testando per davvero con `docker compose up` (non con `config --quiet`, che non li avrebbe mai presi)**:
1. **Postgres 18 ha cambiato convenzione della directory dati**: vuole un mount unico su `/var/lib/postgresql` (poi crea da sé una sottodirectory versionata), non più `.../data` come le versioni precedenti. Con `.../data` il container entra in restart loop lamentandosi di dati "unused" al vecchio path. Mai emerso nei test precedenti in sessione perché ogni container Postgres usato prima era effimero, senza volume named persistente — questo bug esiste solo con un volume reale, che prima di ora non avevamo mai avuto in questo progetto.
2. **`Dockerfile.dev` del backend senza `.dockerignore`**: `COPY . .` copiava anche il `node_modules` locale dell'host (Windows, con symlink pnpm assoluti tipo `C:/Users/...`) SOPRA quello appena installato nel container Linux durante il build, rompendo la risoluzione dei moduli a runtime (`ERR_MODULE_NOT_FOUND` su `pg`). Il volume named `backend_node_modules` viene seminato dal contenuto dell'immagine alla prima creazione — se l'immagine ha il `node_modules` sbagliato, lo eredita anche il volume. Fix: `.dockerignore` con `node_modules` (aggiunto anche a `engine-go/` per igiene, anche se lì non era necessario: `Dockerfile.dev` di Go non fa `COPY` affatto, il sorgente arriva solo da bind mount).
3. Non un bug del progetto ma un promemoria confermato: `docker exec` su Postgres con `POSTGRES_USER` diverso da `postgres` (qui `polaris`) richiede `psql -U polaris` esplicito — il ruolo DB di default non esiste con un altro nome.

**`.github/workflows/ci.yml`** — due job paralleli (`engine-go`, `backend-node`), ciascuno con un service container Postgres 18 (stesso pattern degli ephemeral container usati manualmente tutta la sessione, qui automatizzato), migration applicate via `psql -f` prima dei test, poi build/vet/gofmt/test per Go e typecheck/test per Node — inclusi i test che richiedono `TEST_DATABASE_URL` (skippati finora in locale se non impostata, qui sempre eseguiti). Terzo job valida `docker compose -f docker-compose.yml config --quiet`.

**`.github/workflows/release.yml`** — build+push di `polaris-engine`/`polaris-backend` su push a `master` (tag `:dev`) e su tag `v*` (tag `:vX.Y.Z`+`:latest`), più il job `migrate` sopra descritto. **Gotcha reale, confermato applicabile qui**: il nome org (`Provincia-di-Pescara`) ha maiuscole — `ghcr.io` rifiuta namespace non lowercase, quindi il namespace immagine è hardcoded (`provincia-di-pescara`) invece di derivato da `github.repository`. Stesso identico problema documentato da ComunicaPA, stessa causa.

Versioni Actions verificate via API (non assunte): `actions/checkout@v7`, `actions/setup-go@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `docker/build-push-action@v7`, `docker/login-action@v4`, `docker/setup-buildx-action@v4`.

Da fare: build/push effettivo verificato con un run reale su GitHub (non solo sintassi locale); secret `PRODUCTION_DATABASE_URL` quando l'infrastruttura di deploy sarà decisa; reverse proxy davanti a backend/frontend (non ancora nel compose, i frontend non esistono ancora).

## Architettura target (5 container)

1. **DB — PostgreSQL.** Single source of truth. Vincoli relazionali rigidi, exclusion constraint contro sovrapposizioni slot, lock transazionali per gestire concorrenza in fase di concertazione. Parametri di sistema (🔧 in sezione sopra) in tabella `allegato_parametrico` versionata, editabile da admin via UI backoffice — mai hardcoded, mai letta "current" da un'elaborazione storica (ogni run referenzia la versione vigente al momento dell'esecuzione).
2. **Motore algoritmico — Go.** Microservizio puro, isolato: solo calcolo (FR/ISF/CP, ordine esame fasce, loop round-robin, sorteggio tracciato). Nessuna dipendenza da HTTP/auth/CRUD — deve restare testabile in isolamento per garantire determinismo e riproducibilità bit-esatta (requisito esplicito e ripetuto nei documenti: art. 28 Doc Principale, art. B.1 Allegato B).
3. **Backend API/Backoffice — Node.js + TypeScript.** Autenticazione OIDC (SPID/CIE) per frontend pubblico, autenticazione locale per frontend admin, validazione, CRUD, orchestrazione delle fasi procedurali, coda verso il motore Go. Riusa le regole di business del motore Go via RPC — non duplicare logica di calcolo in Node.
4. **Frontend pubblico — React 19 + TypeScript 7.** Accesso associazioni (e scuole, che seguono iter di delega manuale) via SPID/CIE/eIDAS. Richiesta delega/abilitazione per una o più associazioni, domanda, preferenze, concertazione, calendario.
5. **Frontend admin (backoffice provincia) — React 19 + TypeScript 7.** Login locale (no OIDC). Primo avvio: wizard di seeding SMTP + creazione primo account admin con validazione via link email (niente credenziali in `.env`). Due ruoli: **admin** (tutto, incluse impostazioni/parametri: SMTP, OIDC, parametri di sistema, loghi, utenti backoffice) e **operatore** (operatività pratica: deleghe, CRUD palestre/slot, istruttoria — non impostazioni/parametri).

Infrastruttura: Docker, CI/CD via GitHub Actions → GHCR, reverse proxy davanti ai frontend/API.

## Vincoli progettuali non negoziabili

- **Determinismo**: stesso input → stesso output, sempre. Vietato usare fonti di non-determinismo non seedate (orologio di sistema, ordine di iterazione di map non ordinate, float non specificato) nel motore Go.
- **Sorteggio tracciato**: seme pubblicato prima dell'elaborazione, algoritmo deterministico e documentato pubblicamente, verbale automatico, esito riproducibile da terzi.
- **Tracciabilità**: ogni operazione registrata con persona fisica, associazione rappresentata, ruolo, data/ora (art. 53 Doc Principale, art. B.39 Allegato B).
- **Unità di misura**: tutti i conteggi rilevanti (fabbisogno, valore assegnato, limiti di concentrazione) sono espressi in minuti, mai in numero di slot (le fasce hanno durate diverse).
- **Denaro**: i corrispettivi per l'uso delle palestre non transitano mai dalla piattaforma (regolati direttamente tra associazioni e istituzioni scolastiche).

## Valori di default allegato parametrico (seed iniziale — 🔺 da validare con Ente prima del go-live)

Tutti editabili via UI admin, tutti in tabella `allegato_parametrico` versionata (vedi sopra). I valori sotto sono placeholder di sviluppo scelti per coerenza interna, non valori concordati con l'Ente:

- 🔺 Moltiplicatore Peso→minuti (art. A.5): **60 minuti per punto** di (Peso base + incremento squadre). Es. Classe A senza squadre federali (peso 1) → FR calcolato 60 min/sett; Classe E con >6 squadre (peso 4+3=7) → FR calcolato 420 min/sett. Soggetto comunque al tetto FR finale = min(FD, FR calcolato).
- 🔺 Peso ponderazione fasce pregiate (art. A.9): **1,25** (valore più basso dei due esempi citati nel documento, "1,25 o 1,50").
- 🔺 Limiti di concentrazione (art. 11 Doc Principale, art. B.19): minuti settimanali massimi = **600**; slot massimi stesso impianto = **4**; fasce pregiate massime = **2**; giornate di gara massime = **1**.
- Valori neutri prima stagione (art. A.4, A.7 — già indicati nel testo, non placeholder): incremento squadre = **0**; CAA = **1,00**.
- 🔺 CSD neutro (associazione prima stagione / nessuna penalizzazione): **1,00**, coerente con la scala CRS/CAA dove 1,00 = neutro.
- 🔺 Soglie mancato utilizzo (art. B.35): richiesta giustificazione al 1° mancato utilizzo non giustificato; diffida al **2°**; decadenza al **3°**.
- 🔺 Soglia "scostamento significativo" dichiarato/monitorato (art. 5 Doc Principale, art. B.36): **20%** di scostamento tra dichiarato e rilevato.
- 🔺 Soglia ISF "significativamente inferiore" per compensazione (art. A.15): differenza ISF ≥ **0,20** (20 punti percentuali) tra associazioni concorrenti attiva il principio di compensazione.

## Struttura CSD (art. A.11) — decisione architetturale, valori da tarare in sviluppo

Modellata come tabella a scaglioni, stessa shape di CRS/CAA (coerenza con Allegato A): `intervallo rapporto FD/FR → coefficiente CSD`. Placeholder iniziale, da validare con simulazioni su dataset di test prima di Fase 2 (obiettivo: scoraggiare FD gonfiato senza penalizzare esigenze legittime):

| Rapporto FD/FR | CSD placeholder |
|---|---|
| ≤ 1,00 | 1,00 |
| 1,00 – 1,50 | 0,95 |
| 1,50 – 2,00 | 0,90 |
| > 2,00 | 0,85 |

## Specifica verbale di sorteggio tracciato (art. B.38)

Algoritmo: HMAC-SHA256(seme, candidato_id), ranking crescente sul valore esadecimale.

- **Seme**: generato con CSPRNG (`crypto/rand` Go), 32 byte, encoding hex, pubblicato prima dell'elaborazione.
- **Ordine canonico candidati**: lista candidati ordinata per `associazione_id` (UUID) ASC prima del calcolo — garantisce che il verbale pubblicato sia riproducibile indipendentemente dall'ordine di iterazione/inserimento DB.
- **Calcolo per candidato**: `hmac = HMAC-SHA256(key = decode_hex(seme), message = UTF8(associazione_id))`, rappresentato come stringa hex lowercase.
- **Ranking**: ordinamento crescente per confronto lessicografico della stringa hex (equivalente a confronto numerico big-endian). Vince il candidato con hmac più basso.
- **Verbale (record persistito)**: `sorteggio_id`, `procedura_id`, `articolo_riferimento` (es. "B.21", "B.14"), `contesto` (motivo del sorteggio), `seme_hex`, `timestamp_generazione_seme`, `candidati[]` (in ordine canonico), `algoritmo` = `"hmac-sha256-rank-asc"`, `algoritmo_versione` = `"v1"`, `risultati[]` (associazione_id + hmac_hex + rank, ordinati per rank), `vincitore_associazione_id`, `hash_verbale` (per tamper-evidence).
- **`hash_verbale`** (implementato in `engine-go/internal/sorteggio`): **non** JSON — concatenazione testuale deterministica (JSON "canonico" è ambiguo tra implementazioni/linguaggi diversi, inaccettabile per un hash che terzi devono poter ricalcolare). Formato esatto: `algoritmo + "\n" + algoritmo_versione + "\n" + seme_hex + "\n"`, poi per ciascun candidato in ordine di rank crescente `associazione_id + "|" + hmac_hex + "|" + rank + "\n"`; SHA-256 del risultato, hex lowercase. Pareggio HMAC (probabilità trascurabile): risolto su `associazione_id` crescente, per mantenere un ordine totale sempre definito.
- Retention: intera stagione + termine di impugnazione (vedi sezione retention sopra), mai 30gg.

Tutte le 20 domande analitiche del giro di revisione iniziale sono chiuse. Nessun blocco tecnico residuo per avvio Fase 1 (schema DB) e Fase 2 (motore Go). I valori 🔺 restano da validare con l'Ente ma non impediscono lo sviluppo, essendo parametrici e modificabili post-deploy senza migrazione di schema.
