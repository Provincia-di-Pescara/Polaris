# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Sistema telematico di assegnazione di spazi sportivi pubblici (palestre scolastiche di competenza provinciale). Obiettivo: eliminare discrezionalità umana nell'assegnazione, sostituendola con regole matematiche deterministiche, tracciabili e riproducibili da terzi.

**Stato attuale: pre-implementazione, analisi requisiti chiusa.** Nessun codice ancora scritto. Tutte le domande analitiche e i punti aperti sono stati chiusi (vedi sezioni sotto) — pronti per avvio Fase 1 (schema DB) e Fase 2 (motore Go).

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

Punti tecnici degni di nota per chi tocca lo schema:
- `EXCLUDE USING gist` su `slot_settimana_tipo` (spazio + giorno + stagione + intervallo orario) impedisce sovrapposizioni fisiche a livello DB, non solo applicativo. Richiede `btree_gist`.
- `durata_minuti` è colonna `GENERATED ALWAYS ... STORED`, mai scritta a mano.
- **Gotcha verificato**: `boolean::int` non è castabile in Postgres stock (`cannot cast type boolean to integer`). Per i CHECK "esattamente uno tra N campi è valorizzato" si usa `num_nonnulls(a, b) = 1`, non `(a IS NOT NULL)::int + ...`.
- `assegnazioni_slot_attiva_uq` è un indice unico parziale (`WHERE stato IN ('provvisoria','validata')`) — uno slot può avere una sola assegnazione attiva alla volta, ma la storia (decadute/sostituite) resta in tabella.
- Schema validato funzionalmente (non solo sintatticamente) con Postgres 16 in Docker: migrazioni up/down pulite, EXCLUDE e CHECK testati con insert di prova che devono fallire/passare come da specifica.

Test locale rapido:
```
docker run -d --name pg-palestre -e POSTGRES_PASSWORD=test -e POSTGRES_DB=palestre -p 5432:5432 postgres:16-alpine
psql postgresql://postgres:test@localhost:5432/palestre -f db/migrations/000001_init.up.sql
psql postgresql://postgres:test@localhost:5432/palestre -f db/migrations/000002_seed_valori_normativi.up.sql
```

## Architettura target (5 container)

1. **DB — PostgreSQL.** Single source of truth. Vincoli relazionali rigidi, exclusion constraint contro sovrapposizioni slot, lock transazionali per gestire concorrenza in fase di concertazione. Parametri di sistema (🔧 in sezione sopra) in tabella `allegato_parametrico` versionata, editabile da admin via UI backoffice — mai hardcoded, mai letta "current" da un'elaborazione storica (ogni run referenzia la versione vigente al momento dell'esecuzione).
2. **Motore algoritmico — Go.** Microservizio puro, isolato: solo calcolo (FR/ISF/CP, ordine esame fasce, loop round-robin, sorteggio tracciato). Nessuna dipendenza da HTTP/auth/CRUD — deve restare testabile in isolamento per garantire determinismo e riproducibilità bit-esatta (requisito esplicito e ripetuto nei documenti: art. 28 Doc Principale, art. B.1 Allegato B).
3. **Backend API/Backoffice — Node.js + TypeScript.** Autenticazione OIDC (SPID/CIE) per frontend pubblico, autenticazione locale per frontend admin, validazione, CRUD, orchestrazione delle fasi procedurali, coda verso il motore Go. Riusa le regole di business del motore Go via RPC — non duplicare logica di calcolo in Node.
4. **Frontend pubblico — React/Vue + TypeScript.** Accesso associazioni (e scuole, che seguono iter di delega manuale) via SPID/CIE/eIDAS. Richiesta delega/abilitazione per una o più associazioni, domanda, preferenze, concertazione, calendario.
5. **Frontend admin (backoffice provincia) — React/Vue + TypeScript.** Login locale (no OIDC). Primo avvio: wizard di seeding SMTP + creazione primo account admin con validazione via link email (niente credenziali in `.env`). Due ruoli: **admin** (tutto, incluse impostazioni/parametri: SMTP, OIDC, parametri di sistema, loghi, utenti backoffice) e **operatore** (operatività pratica: deleghe, CRUD palestre/slot, istruttoria — non impostazioni/parametri).

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
- **Verbale (record persistito)**: `sorteggio_id`, `procedura_id`, `articolo_riferimento` (es. "B.21", "B.14"), `contesto` (motivo del sorteggio), `seme_hex`, `timestamp_generazione_seme`, `candidati[]` (in ordine canonico), `algoritmo` = `"hmac-sha256-rank-asc"`, `algoritmo_versione` = `"v1"`, `risultati[]` (associazione_id + hmac_hex + rank, ordinati per rank), `vincitore_associazione_id`, `hash_verbale` (SHA256 del payload JSON canonico, per tamper-evidence).
- Retention: intera stagione + termine di impugnazione (vedi sezione retention sopra), mai 30gg.

Tutte le 20 domande analitiche del giro di revisione iniziale sono chiuse. Nessun blocco tecnico residuo per avvio Fase 1 (schema DB) e Fase 2 (motore Go). I valori 🔺 restano da validare con l'Ente ma non impediscono lo sviluppo, essendo parametrici e modificabili post-deploy senza migrazione di schema.
