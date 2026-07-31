# Design — Parametrico versionato (backoffice)

Data: 2026-07-31. Riferimento: `docs/SPEC.md` Fase 4, item 3 (ultimo pezzo mai chiuso, dopo `impostazioni/oidc` e CRUD utenti backoffice). Chiude la parte admin prevista per priorità dal committente prima di tornare al Flusso pubblico blocco 2/4.

## Scope

Lettura della versione parametrica attiva, storico versioni, creazione di una nuova versione (mai update in place — `parametrico_versioni` è progettata come append-only, ogni elaborazione futura congela la versione vigente al momento dell'esecuzione). Nessuna modifica al motore Go: `engine-go/internal/postgres/parametrico.go::CaricaParametricoAttivo` legge già `ORDER BY valida_dal DESC LIMIT 1`, comportamento invariato — una nuova riga con `valida_dal` più recente diventa automaticamente quella attiva.

**Fuori scope esplicito**: `crs_scaglioni`, `caa_scaglioni`, `incremento_squadre_scaglioni`, `classi_attivita` — verificato leggendo lo schema (`db/migrations/000001_init.up.sql`) che sono tabelle **normative globali senza FK verso `parametrico_versioni`** (a differenza di `csd_scaglioni`, che invece è versionata). Non editabili da questo blocco.

## Campi coinvolti

`parametrico_versioni` ha 16 campi scalari 🔧 (editabili) più `id`/`valida_dal`/`pubblicata_da`/`note`/`creata_il` (gestiti dal backend, mai nel body):

**Decimal (9, rappresentati come stringa in TS — vedi sotto)**: `moltiplicatoreMinutiPerPunto`, `pesoFasciaPregiata`, `minutiSettimanaliMax`, `caaNeutro`, `csdNeutro`, `tolleranzaIsfPct`, `sogliaScostamentoDichiaratoPct`, `sogliaIsfCompensazione`, `quotaNuoveAssociazioniPct` (quest'ultima da migration `000006`).

**Integer (7)**: `slotMaxStessoImpianto`, `fascePregiateMax`, `giornateGaraMax`, `incrementoSquadreNeutro`, `sogliaMancatiUtilizziDiffida`, `sogliaMancatiUtilizziDecadenza`, `retentionLogOperazioniGiorni`.

**Array collegato**: `csdScaglioni: [{rapportoFdFrMin, rapportoFdFrMax: number|null, coefficiente}]` — righe in `csd_scaglioni`, FK `parametrico_versione_id` verso la nuova versione, CHECK esistente `rapporto_fd_fr_max IS NULL OR rapporto_fd_fr_max > rapporto_fd_fr_min` replicato lato zod con `.refine()`.

## Rappresentazione numerica

I campi `NUMERIC` sono rappresentati come **stringa decimale** in TypeScript, non `number` — coerente con come il driver `pg` li restituisce di default (nessun cast a float, evita perdita di precisione sui parametri che il motore Go userà nei calcoli deterministici). I campi `INTEGER` restano numeri JS normali. Validazione zod: regex decimale per i primi (`/^\d+(\.\d{1,4})?$/`, precisione massima coerente con la colonna più stretta, `NUMERIC(6,4)`), `z.number().int()` per i secondi.

## Endpoint

Tutti `richiedeAutenticazione` + `richiedeRuolo('admin')` — mai `operatore` (governa tutti i calcoli del motore, dato sensibile).

- **`GET /backoffice/parametrico`**: versione attiva completa (16 campi + `csdScaglioni`).
- **`GET /backoffice/parametrico/versioni`**: storico leggero — `[{id, validaDal, pubblicataDa, note}]`, senza i 16 campi (per audit/tracciabilità art. B.39, non per editing).
- **`GET /backoffice/parametrico/versioni/:id`**: dettaglio completo di una versione storica specifica, stesso shape del GET attivo — 404 se id inesistente.
- **`POST /backoffice/parametrico`**: crea una nuova versione. Body: tutti i 16 campi **obbligatori** (nessun merge-on-omit — decisione presa: niente logica di ereditarietà nascosta lato server, il client futuro legge la versione attiva via GET, precompila, l'admin modifica e reinvia tutto) + `csdScaglioni` (array, può essere vuoto) + `note` opzionale. `pubblicata_da` = `req.utente.sub`, mai dal body. Transazione: INSERT `parametrico_versioni` + INSERT multipli `csd_scaglioni` + `registraOperazione` (`crea_versione_parametrico`, `dettaglio` = i 16 campi, non l'array scaglioni per contenere la dimensione del log).

## Testing

`node --test` contro Postgres reale, server HTTP vero. Scenari minimi:
- GET attivo su DB con solo il seed di migration `000002`/`000006` → 200, valori di default corretti.
- POST con tutti i campi → 201, nuova riga con `valida_dal` più recente, `csd_scaglioni` collegati correttamente (FK verificata via query diretta).
- GET attivo dopo il POST → ritorna la nuova versione, non quella precedente.
- POST con un campo mancante → 400 (zod).
- POST con `csdScaglioni` che viola il range (`max <= min`) → 400 (refine zod, non 23514/500 da Postgres).
- GET storico → include entrambe le versioni in ordine.
- GET versione storica per id → ritorna i valori congelati della versione precedente, non quelli attuali.
- 403 per operatore su tutte e 4 le route.
- `registraOperazione` scritto su POST, verificato via query.

## Fuori scope

- UI backoffice (Fase 5).
- Endpoint PUT/DELETE su una versione esistente — non esistono per costruzione (append-only).
- Validazione dei valori 🔺 ancora placeholder (Fase 7, richiede l'Ente).
