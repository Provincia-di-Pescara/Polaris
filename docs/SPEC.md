# POLARIS — Specifica di progetto completa

Piattaforma Organizzativa per la Localizzazione e l'Assegnazione delle Risorse e degli Impianti Sportivi — Provincia di Pescara.

Questo documento è la specifica tecnica completa del progetto: copre tutte le fasi di sviluppo (fatte, in corso, future), la mappatura verso i documenti normativi e le lacune note. Fonte di verità normativa: `documenti/` (Documento Principale, Allegato A, Allegato B). Fonte di verità operativa per lo stato corrente e i gotcha d'ambiente: `CLAUDE.md`.

**Regola fondante** (istruzione esplicita del committente): ogni regola di business implementata deve essere riconducibile a un articolo preciso dei documenti normativi. Non si introducono logiche non scritte.

---

## 1. Obiettivo e principi vincolanti

Sistema telematico di assegnazione degli spazi sportivi pubblici (palestre scolastiche di competenza provinciale) che sostituisce la discrezionalità amministrativa con regole matematiche deterministiche, tracciabili e riproducibili da terzi.

Vincoli non negoziabili (Doc Principale art. 1, 13, 22; Allegato B art. B.1, B.38, B.39):

- **Determinismo**: stesso input → stesso output, sempre. Nessuna fonte di non-determinismo non seedata nel motore di calcolo (orologio, ordine di iterazione di map, float).
- **Sorteggio tracciato**: seme CSPRNG pubblicato prima dell'elaborazione, algoritmo pubblico (HMAC-SHA256 rank-asc), verbale automatico con hash di integrità, esito riproducibile da terzi.
- **Tracciabilità**: ogni operazione di scrittura registrata con persona fisica, associazione rappresentata, ruolo, data/ora (art. 53 Doc Principale, art. B.39).
- **Unità di misura**: minuti, mai numero di slot (le fasce hanno durate diverse).
- **Aritmetica**: `decimal` ovunque (mai float), arrotondamento a 3 cifre decimali.
- **Denaro**: i corrispettivi non transitano mai dalla piattaforma.
- **Parametri di business versionati**: mai hardcoded; tabella `parametrico_versioni` versionata, editabile da admin via UI; ogni elaborazione congela la versione vigente al momento dell'esecuzione (rielaborazioni storiche riproducibili).

## 2. Architettura (5 container)

| # | Componente | Tecnologia | Stato |
|---|---|---|---|
| 1 | Database | PostgreSQL 18 (`postgres:18-alpine`) | ✅ Schema completo (4 migration) |
| 2 | Motore algoritmico | Go 1.26, `shopspring/decimal`, `pgx/v5`, HTTP nativo | ✅ Calcolo+persistenza+HTTP; ❌ blocchi gara non orchestrati |
| 3 | Backend API | Node.js 24 (esecuzione `.ts` nativa, no build), TypeScript 7.0.2, Express 5, zod, pnpm | 🔶 Auth completa (locale+OIDC); ❌ CRUD e orchestrazione procedimento |
| 4 | Frontend pubblico | React 19.2 + TypeScript 7 | ❌ Da avviare |
| 5 | Frontend backoffice | React 19.2 + TypeScript 7 | ❌ Da avviare |

Infrastruttura: Docker Compose (prod: immagini GHCR, zero bind mount; dev: override con hot-reload), GitHub Actions (CI + release su GHCR), reverse proxy davanti a frontend/API (❌ non ancora nel compose).

Confini architetturali fissi:
- Il motore Go resta puro: solo calcolo, nessuna auth/CRUD. Il backend Node è l'unico gatekeeper; il motore non è mai esposto fuori dalla rete interna dei container.
- Nessuna logica di calcolo duplicata in Node: il backend orchestra il motore via HTTP interno (`ENGINE_URL`).
- Nessun ORM da nessuna parte: SQL puro parametrizzato (controllo diretto su exclusion constraint e CHECK di dominio).
- Configurazione applicativa (OIDC, SMTP, branding, parametrico) in DB (`impostazioni_sistema`, `parametrico_versioni`), mai in variabili d'ambiente. In env solo bootstrap: `DATABASE_URL`, `JWT_SECRET`, porte.

## 3. Mappatura normativa → componenti e stato

### Allegato B — le 16 fasi della procedura operativa

| Fase normativa | Articoli | Componente responsabile | Stato |
|---|---|---|---|
| 1. Quadro delle disponibilità (censimento impianti, settimana tipo, fasce pregiate) | B.2–B.4 | Schema ✅ · CRUD backoffice ✅ (`/backoffice/{istituzioni,impianti,spazi,discipline,slot,stagioni}`) · UI ❌ | **Fatto (backend)** |
| 2. Presentazione delle domande | B.5–B.6 | Schema ✅ · API pubblica ✅ (`POST /pubblico/domande`) · UI ❌ | **Fatto (backend)** |
| 3. Istruttoria — verifica di ammissibilità | B.7 | API backoffice ✅ (`PUT /backoffice/domande/:id/{ammetti,escludi}`) · UI ❌ | **Fatto (backend)** |
| 4. Calcolo dei parametri (FR, CRS, CAA, CSD, CP) | B.8–B.9 | Motore Go ✅ (`internal/istruttoria`, `POST /stagioni/{id}/istruttoria`) | **Fatto** |
| 5. Pubblicazione esiti istruttoria + osservazioni/riesame | B.10–B.11 | Schema ✅ · API ✅ (`GET /pubblico/stagioni/:id/domande/esiti`, `POST /pubblico/domande/:id/osservazioni`, `PUT /backoffice/osservazioni/:id/{accogli,respingi}`) · UI ❌ | **Fatto (backend)** |
| 6. Assegnazione dei blocchi gara | B.12–B.14 | Motore Go ✅ (`internal/gara` + orchestrazione Postgres + endpoint HTTP) | **Fatto** |
| 7. Calcolo iniziale ISF (VA da blocchi gara) | B.15–B.16 | Motore Go ✅ (VA + stato concentrazione iniziali nel round-robin) | **Fatto** |
| 8. Assegnazione progressiva per round | B.17–B.21 | Motore Go ✅ (`internal/roundrobin`, incl. blocchi allenamento, tie-break live, sorteggio) | **Fatto** |
| 9. Completamento (condizioni di chiusura) | B.22 | Motore Go ✅ (B.22.1/.2/.3 + tetto di sicurezza) | **Fatto** |
| 10. Pubblicazione proposta provvisoria | B.23 | API ✅ (`POST /backoffice/stagioni/:id/pubblica-proposta`, `GET /pubblico/stagioni/:id/proposta`) · UI ❌ | **Fatto (backend)** |
| 11. Concertazione tra associazioni | B.24–B.26 | Schema ✅ · API ✅ (`POST /pubblico/stagioni/:id/concertazione/proposte`, accetta/annulla) · UI ❌ | **Fatto (backend)** |
| 12. Validazione delle proposte | B.27–B.28 | Schema ✅ · API ✅ (`PUT /backoffice/concertazione/proposte/:id/{valida,rigetta}`, FIFO + lock per-slot) · UI ❌ | **Fatto (backend)** |
| 13. Assegnazione fasce residue (riassegnazione finale) | B.29 | Motore Go ✅ (`EseguiRiassegnazioneResidua`, riusa il round-robin esistente) · API Node ✅ (`POST /backoffice/stagioni/:id/riassegnazione-residua`, chiude anche la finestra di concertazione) | **Fatto (backend)** |
| 14. Settimana tipo definitiva | B.30–B.31 | API ✅ (`POST /backoffice/stagioni/:id/approva-definitiva` — crea convenzioni; `PUT /backoffice/convenzioni/:id/conferma`; `GET /pubblico/stagioni/:id/settimana-tipo-definitiva` con efficacia derivata) · UI ❌ | **Fatto (backend)** |
| 15. Gestione stagionale: variazioni, indisponibilità, monitoraggio, decadenza | B.32–B.36 | Schema ✅ · B.32-33 (indisponibilità sopravvenute + variazioni ordinarie) API ✅ (`POST /backoffice/slot/:id/indisponibilita`, `GET /pubblico/associazioni/:id/indisponibilita`, `POST /pubblico/variazioni{,/:id/accetta,/:id/annulla}`, `GET /backoffice/stagioni/:id/variazioni`) · B.34-36 (monitoraggio/decadenza) ❌ | 🔶 B.32-33 fatti (backend), B.34-36 da pianificare |
| 16. Disposizioni comuni: parametrico, sorteggio, tracciabilità | B.37–B.39 | Parametrico versionato ✅ · sorteggio ✅ · audit log ✅ (`registraOperazione` su ogni scrittura) | **Fatto** |

### Documento Principale — articoli con impatti realizzativi non coperti dall'Allegato B

| Art. | Tema | Stato |
|---|---|---|
| 3 | Identità digitale SPID/CIE/eIDAS, deleghe con approvazione operatore | OIDC ✅ · workflow deleghe/abilitazioni 🔶 (API blocco 1/4 fatto: sub-delega gerarchica + approvazione/rigetto/revoca operatore, vedi §4 Fase 4 punto 5) |
| 4 | Accreditamento associazioni (esistenza, affiliazioni, assicurazione, responsabili) | Schema ✅ (`associazioni`, `associazioni_documenti`) · API 🔶 (creazione + upload documenti fatti, vedi §4 Fase 4 punto 5) · UI ❌ |
| 5 | Dichiarazione fabbisogno (minimo + ottimale) | Schema ✅ · **assunzione aperta: FD = fabbisogno ottimale** (da confermare con l'Ente) |
| 12 | Tutela nuove associazioni (quota fasce riservabile) | **Non modellata** né in schema né nel motore. Facoltativa ("l'Ente può") — serve decisione: si implementa? Se sì: parametro 🔧 quota + ramo dedicato nel round-robin |
| 19 | Rapporti con istituzioni scolastiche (convenzioni) | Schema ✅ (`convenzioni`) · logica ❌ |
| 23 | GDPR: retention differenziata, minimizzazione | Regole definite (30gg log operativo 🔧 / stagione+impugnazione per verbali-assegnazioni, fisso) · **job di retention non implementato** ❌ |
| 24 | Consultazione annuale associazioni | Fuori piattaforma (processo organizzativo, nessun requisito software) |

## 4. Piano di progetto — tutte le fasi

### Fase 1 — Schema dati (✅ completata)
`db/migrations/000001–000004`, SQL puro compatibile golang-migrate. Validata funzionalmente con Postgres 18 reale (migrazioni up/down, EXCLUDE e CHECK testati con insert che devono fallire/passare). Ogni modifica futura va validata contro container reale.

### Fase 2 — Motore algoritmico Go (✅ completata)
`engine-go/internal/{calc,sorteggio,roundrobin,istruttoria}` in TDD rigoroso. Residuo esplicito: **taratura CSD** (art. A.11 — formula demandata allo sviluppo) da chiudere con simulazioni su dataset realistici prima del collaudo (vedi Fase 7).

### Fase 3 — Persistenza e HTTP del motore (✅ completata, con residui)
`internal/postgres` + `internal/httpapi` + `cmd/service`. Verificato end-to-end con Postgres reale. Blocchi gara (B.12–B.15) inclusi: `internal/gara`, `EseguiBlocchiGara`, endpoint `POST /stagioni/{id}/blocchi-gara`, VA/stato iniziali nel round-robin.
Residui:
- `assegnazioni.isf_al_momento` lasciato NULL — da valorizzare quando servirà in dashboard/audit (nota: `GET /pubblico/stagioni/:id/{proposta,settimana-tipo-definitiva}` calcola l'ISF a runtime via query, non legge questa colonna — vedi Fase 4).
- ~~Riassegnazione finale (B.29) — dopo la concertazione~~ ✅ **Fatto**: `EseguiRiassegnazioneResidua`, riusa `EseguiRoundRobin` senza nuova logica algoritmica (thin wrapper su `tipo` parametrizzato).

### Fase 4 — Backend Node (🔶 in corso)
Fatto: scaffold, `GET /healthz`, `GET /stagioni`, autenticazione locale backoffice completa (scrypt, JWT HS256 pinnato con audience, refresh rotation, rate limit, no user enumeration), OIDC SPID/CIE completa (PKCE, state one-shot in Postgres, verifica JWKS, JWT propri, protezione login-CSRF con cookie firmato). Tutto verificato con Postgres reale e IdP mock realistico.

Da fare (ordine consigliato):
1. ~~**Middleware autorizzazione per ruolo** (`richiedeRuolo('admin')`) — il ruolo è già nel JWT, manca solo il middleware. Prerequisito di ogni endpoint impostazioni.~~ ✅ **Fatto**: middleware in `src/auth/middleware.ts`, usato in tutti gli endpoint CRUD.
2. ~~**Audit log** (art. B.39): helper + integrazione su ogni scrittura~~ ✅ **Fatto**: `repository/logOperazioni.ts::registraOperazione`, agganciato a ogni scrittura di ogni blocco successivo.
3. ~~**CRUD backoffice**: stagioni, istituzioni scolastiche, impianti/spazi/slot settimana tipo (incl. fasce pregiate — Fase normativa 1), discipline.~~ ✅ **Fatto**: CRUD completo per discipline, istituzioni, impianti, spazi, slot, e creazione stagioni. Role-based via `richiedeRuolo('admin', 'operatore')` (admin solo per stagioni). Ogni operazione scrive `log_operazioni` (art. B.39). Gestione errori: `ErroreValoreDuplicato` (23505 unique violation) → HTTP 409; `ErroreNonTrovato` (lanciato da repository quando query non trova righe, nessun SQLSTATE) → HTTP 404; `ErroreSovrapposizioneSlot` (23P01 EXCLUDE violation) → HTTP 409; validazione zod → HTTP 400.
   **Utenti backoffice** ✅ **Fatto**: `POST /backoffice/utenti` (invito, admin only, nessuna password scelta dall'admin — solo un token one-shot inviato via email), `GET /backoffice/utenti`, `GET /backoffice/utenti/:id`, `PUT /backoffice/utenti/:id` (anagrafica+ruolo), `PUT /backoffice/utenti/:id/stato` (attivo/disattivato), `POST /backoffice/utenti/:id/reset-password` (nuovo token invito + revoca sessioni attive), `POST /backoffice/utenti/accetta-invito` (pubblico, token one-shot, imposta la password). Protezione ultimo admin (non declassabile/disattivabile se è l'unico admin attivo), auto-modifica di stato vietata. Riusa le colonne `token_verifica_hash`/`token_verifica_scade_il` di `utenti_backoffice` già introdotte in migration `000005` per il bootstrap. Migration `000008` aggiunta nel secondo giro di final-review: colonna `token_verifica_scopo` (`'bootstrap'`/`'invito_utente'`) per evitare che un token di reset-password fosse accettato anche dall'endpoint di bootstrap.
   **Parametrico versionato** ✅ **Fatto** (chiude la parte admin decisa col committente prima del Flusso pubblico blocco 2/4): `GET /backoffice/parametrico` (versione attiva), `GET /backoffice/parametrico/versioni` (lista sintetica), `GET /backoffice/parametrico/versioni/:id` (dettaglio storico), `POST /backoffice/parametrico` (crea nuova versione — append-only, mai update in place). Tutte e 4 solo admin. Valori NUMERIC restituiti sempre come stringa decimale (mai binding numerico diretto, coerente col motore Go), `csd_scaglioni` collegata via FK `ON DELETE CASCADE`. Nessuna modifica al motore Go: `CaricaParametricoAttivo` leggeva già `ORDER BY valida_dal DESC LIMIT 1`. **Impostazioni OIDC** ✅ **Fatto**: `GET`/`PUT /backoffice/impostazioni/oidc` (solo admin), chiave singleton `oidc` in `impostazioni_sistema`, `client_secret` cifrato at-rest (AES-256-GCM) e mai restituito in chiaro via HTTP (GET espone solo `clientSecretConfigurato: boolean`), merge-on-omit sul PUT (un secret omesso preserva quello già salvato — obbligatorio solo al primo salvataggio). **Impostazioni SMTP: permanentemente fuori scope** (decisione esplicita del committente — un solo server SMTP, configurazione sempre da `.env`, mai un secondo store in DB).
4. ~~Wizard primo avvio~~ ✅ **Fatto** (lato backend): endpoint `/auth/bootstrap/{stato,primo-admin,verifica}`, account attivato via link email, SMTP di bootstrap da `.env` (decisione committente — al primo avvio non c'è un admin che possa configurare SMTP da UI). Resta la UI del wizard (Fase 5).
5. ~~**Flusso pubblico** (blocchi 1/4-4/4)~~ ✅ **Fatto — flusso pubblico completo**: blocco 1/4 accreditamento associazione + sub-delega gerarchica (`POST /pubblico/associazioni`, `POST /pubblico/deleghe`, `PUT /backoffice/deleghe/:id/{approva,respingi,revoca}` — design `docs/superpowers/specs/2026-07-30-accreditamento-delega-design.md`); blocco 2/4 domanda + ammissibilità + osservazioni (`POST /pubblico/domande`, `PUT /backoffice/domande/:id/{ammetti,escludi}`, `POST /pubblico/domande/:id/osservazioni` — design `docs/superpowers/specs/2026-08-01-domanda-osservazioni-design.md`); blocco 3/4 pubblicazione proposta + concertazione B.23-28 (`POST /backoffice/stagioni/:id/pubblica-proposta`, `POST /pubblico/stagioni/:id/concertazione/proposte`, `PUT /backoffice/concertazione/proposte/:id/{valida,rigetta}` — design `docs/superpowers/specs/2026-08-03-concertazione-pubblicazione-design.md`); blocco 4/4 riassegnazione finale + settimana tipo definitiva B.29-31 (`POST /backoffice/stagioni/:id/{riassegnazione-residua,approva-definitiva}`, `PUT /backoffice/convenzioni/:id/conferma`, `GET /pubblico/stagioni/:id/settimana-tipo-definitiva` — design `docs/superpowers/specs/2026-08-04-riassegnazione-settimana-definitiva-design.md`). UI (Fase 5) non ancora collegata.
6. **Orchestrazione procedimento**: macchina a stati della procedura per stagione — implementata in modo minimale riusando direttamente `stagioni_sportive.stato` (nessuna tabella dedicata a 16 fasi esplicite, decisione presa in sviluppo per restare scoped), non l'approccio più granulare originariamente ipotizzato. Copre tutte le transizioni necessarie al flusso pubblico chiuso sopra.
7. ~~**Concertazione** (B.24–B.28)~~ ✅ **Fatto** — vedi punto 5, blocco 3/4. Riassegnazione finale (B.29) — vedi punto 5, blocco 4/4.
8. **Gestione stagionale** (B.32–B.36, Fase 15): ~~indisponibilità sopravvenute (B.33) + variazioni ordinarie tra associazioni (B.32: liberazione/recupero/scambio_temporaneo/utilizzo_occasionale)~~ ✅ **Fatto** — migration `000013`/`000014` (tabella `variazioni_ordinarie` + indice unico su destinazione), repository `indisponibilita.ts`/`variazioni.ts`, route `POST /backoffice/slot/:id/indisponibilita`, `GET /pubblico/associazioni/:id/indisponibilita`, `POST /pubblico/variazioni{,/:id/accetta,/:id/annulla}`, `GET /backoffice/stagioni/:id/variazioni` (sola lettura backoffice — nessuna coda di validazione attiva, istruzione esplicita del committente). Lock avviso per-occorrenza (`pg_advisory_xact_lock`) + indice unico parziale sulla destinazione contro race concorrenti; verifica esplicita di `indisponibile_permanente`/`indisponibilita_sopravvenute` e dello stato stagione (`STATI_STAGIONE_CON_DEFINITIVA`) prima di accettare una variazione. Design: `docs/superpowers/plans/2026-08-05-variazioni-ordinarie-indisponibilita.md`. Residuo: rilevazione utilizzi, escalation giustificazione→diffida→decadenza (soglie 🔧), effetti su CAA stagione successiva (B.34-36) — **prossimo blocco da pianificare**.
9. **Job housekeeping**: pulizia `oidc_stato_pkce` scadute non consumate, sessioni scadute, retention `log_operazioni` (30gg 🔧) — mai su verbali/assegnazioni/settimana tipo (retention legale fissa). ✅ **Fatto**: `src/housekeeping/` (vedi CLAUDE.md sezione Backend Node).
10. **Hardening rimandato**: CORS + helmet (insieme al design del reverse proxy), `app.set('trust proxy', ...)` quando c'è il proxy (senza, `req.ip` e il rate limiting per IP vedono l'IP del proxy), lockout per-account (migration dedicata).

### Fase 5 — Frontend (❌ da avviare)
Due app React 19.2 + TS 7 in pnpm workspace (da creare `pnpm-workspace.yaml`; oggi `backend-node` è un pacchetto singolo).
- **Pubblico**: login SPID/CIE (redirect flow già pronto lato backend), onboarding associazione/delega, domanda, preferenze slot, dashboard esiti/ISF, concertazione, calendario.
- **Backoffice**: wizard primo avvio, login locale, gestione per ruolo (admin: impostazioni+parametri+utenti; operatore: deleghe, CRUD impianti/slot, istruttoria, avvio elaborazioni, monitoraggio).
- Requisiti PA: accessibilità (AGID/WCAG), i18n non richiesta (solo italiano).

### Fase 6 — Infrastruttura e CI/CD (🔶 parziale)
Fatto: compose prod/dev verificati con bring-up reale, CI (test Go+Node contro Postgres 18 reale, typecheck, gofmt/vet, validazione compose) e release (build+push GHCR, job migrate) verdi su GitHub.
Da fare:
- Reverse proxy (Caddy/Traefik/nginx — da decidere) davanti a backend+frontend: TLS, security headers, insieme a CORS/helmet.
- Secret `PRODUCTION_DATABASE_URL` + decisione raggiungibilità DB di produzione dal runner (self-hosted vs endpoint con allowlist).
- Deploy effettivo (target infrastrutturale dell'Ente non ancora noto).
- **Backup/restore Postgres**: strategia non ancora definita (pg_dump schedulato? volume snapshot?) — obbligatoria prima del go-live, i verbali hanno valore legale.

### Fase 7 — Collaudo e taratura (❌ da pianificare)
- **Dataset realistico**: generatore di dati di test (N associazioni, impianti reali della provincia, domande verosimili) per simulazioni end-to-end.
- **Taratura CSD** (art. A.11): iterazioni sul dataset verificando assenza di incentivi a dichiarazioni strategiche (FD gonfiato).
- **Verifica OIDC contro il vero pa-sso-proxy** con credenziali reali (client_id/secret/issuer/redirect_uri) — mai testato, solo mock protocol-faithful. Include conferma di come il proxy segnala SPID vs CIE vs eIDAS nei claim (oggi `OIDC_PROVIDER_DEFAULT='spid'` placeholder).
- **Validazione parametri 🔺 con l'Ente** → produzione dell'allegato parametrico ufficiale → nuova versione in `parametrico_versioni`.
- **Riproducibilità da terzi**: esercizio pratico — ricalcolo di un sorteggio e di un'elaborazione completa da parte di un verificatore esterno con soli dati pubblicati.
- Security review complessiva + test di carico sulla concertazione (unico punto con concorrenza reale).

### Fase 8 — Go-live ed esercizio (❌ da pianificare)
Runbook operativo (deploy, rollback, restore), formazione operatori, migrazione/inserimento dati primo anno (impianti, slot, istituzioni), apertura prima stagione. Primo anno = valori neutri (incremento squadre 0, CAA 1,00 — art. A.4/A.7).

## 5. Contratto API (superficie prevista)

Convenzioni: JSON, `camelCase` in uscita, zod su ogni input, errori `{errore, dettagli?}`, Bearer JWT (audience `backoffice` o `pubblico`), 401 generici (no enumeration).

Esistenti: `GET /healthz`, `GET /stagioni`, `GET /auth/bootstrap/stato`, `POST /auth/bootstrap/primo-admin|verifica`, `POST /auth/login|refresh|logout`, `GET /auth/me`, `GET /auth/oidc/start`, `POST /auth/oidc/callback`, `POST /auth/pubblico/refresh|logout`, `GET /auth/pubblico/me`, `POST /backoffice/stagioni`, `POST /backoffice/discipline`, `GET /backoffice/discipline`, `PUT /backoffice/discipline/:codice`, `POST /backoffice/istituzioni`, `GET /backoffice/istituzioni`, `GET /backoffice/istituzioni/:id`, `PUT /backoffice/istituzioni/:id`, `POST /backoffice/impianti`, `GET /backoffice/impianti`, `GET /backoffice/impianti/:id`, `PUT /backoffice/impianti/:id`, `POST /backoffice/impianti/:impiantoId/spazi`, `GET /backoffice/impianti/:impiantoId/spazi`, `GET /backoffice/spazi/:id`, `PUT /backoffice/spazi/:id`, `POST /backoffice/stagioni/:stagioneId/slot`, `GET /backoffice/stagioni/:stagioneId/slot`, `GET /backoffice/slot/:id`, `PUT /backoffice/slot/:id`, `POST /pubblico/associazioni`, `POST /pubblico/associazioni/:id/documenti`, `POST /pubblico/deleghe`, `PUT /backoffice/deleghe/:id/approva|respingi|revoca`, `GET/PUT /backoffice/impostazioni/oidc` (solo admin), `POST /backoffice/utenti` (solo admin), `GET /backoffice/utenti` (solo admin), `GET /backoffice/utenti/:id` (solo admin), `PUT /backoffice/utenti/:id` (solo admin), `PUT /backoffice/utenti/:id/stato` (solo admin), `POST /backoffice/utenti/:id/reset-password` (solo admin), `POST /backoffice/utenti/accetta-invito` (pubblico, nessuna auth), `GET /backoffice/parametrico` (solo admin), `GET /backoffice/parametrico/versioni` (solo admin), `GET /backoffice/parametrico/versioni/:id` (solo admin), `POST /backoffice/parametrico` (solo admin, nuova versione, mai update in place). Motore (interno): `GET /healthz`, `POST /stagioni/{id}/istruttoria`, `POST /stagioni/{id}/blocchi-gara`, `POST /stagioni/{id}/prima-assegnazione`.

Previste (nomi indicativi, da consolidare in fase di implementazione):
- Backoffice: `/backoffice/domande/{id}/ammetti|escludi`, `/backoffice/stagioni/{id}/procedura/*` (transizioni di fase, avvio elaborazioni, pubblicazioni), `/backoffice/monitoraggio/*`. (`/backoffice/impostazioni/smtp` permanentemente fuori scope, vedi Fase 4 sopra.)
- Pubblico: `/pubblico/domande` (+fabbisogni, preferenze, blocchi, giornate gara), `/pubblico/osservazioni`, `/pubblico/esiti`, `/pubblico/concertazione/*`, `/pubblico/calendario`.
- Motore (da aggiungere): `POST /stagioni/{id}/riassegnazione-finale`.

## 6. Sicurezza — stato e piano

Fatto: scrypt self-describing, JWT HS256 pinnato + audience separate, refresh rotation con hash SHA-256, rate limit login/OIDC-start, no user enumeration, PKCE S256 + state one-shot, verifica id_token via JWKS, client_secret cifrato AES-256-GCM at rest (chiave derivata con context label), protezione login-CSRF (cookie firmato + timingSafeEqual), `tentativi_login_backoffice` per il monitoraggio.

Da fare: autorizzazione per ruolo, audit log applicativo, CORS/helmet/trust-proxy (col reverse proxy), lockout per-account, autenticazione o segregazione di rete formale verso il motore Go (oggi: fiducia nella rete interna compose — accettabile, da rivedere col reverse proxy), gestione rotazione `JWT_SECRET` documentata (invalida sessioni E rende irrecuperabile il client_secret OIDC cifrato — va reinserito da UI).

## 7. Lacune rilevate dall'audit (2026-07-25)

Risolte subito:
- **CI non eseguiva 2 file di test** (`server.test.ts` — incluso il regression test login-CSRF — e `stagioni.test.ts`): bash senza globstar espande `src/**/*.test.ts` come `src/*/*.test.ts`. Fix: pattern quotato (lo risolve il test runner Node) in `ci.yml` e `package.json`.

Da pianificare (tracciate nelle fasi sopra):
| Lacuna | Gravità | Dove |
|---|---|---|
| ~~`log_operazioni` mai scritta (art. B.39)~~ | ~~Alta~~ **Risolta**: helper `registraOperazione` + wiring su login/logout (entrambi i mondi) e bootstrap; da estendere a ogni CRUD futuro | Fase 4.2 ✅ |
| ~~Nessun modo di creare il primo admin senza SQL a mano~~ | ~~Alta~~ **Risolta**: wizard bootstrap (SMTP da `.env`, email con link di attivazione, token one-shot 24h) — endpoint `/auth/bootstrap/*`, migration 000005 | Fase 4.4 ✅ |
| ~~Blocchi gara non orchestrati (B.12–B.14) + VA iniziale (B.15)~~ | ~~Alta~~ **Risolta**: `internal/gara` (blocco = 2 slot consecutivi, catena CRS→CP→sorteggio B.14), orchestrazione Postgres, endpoint `/stagioni/{id}/blocchi-gara`, VA e stato di concentrazione iniziali nel round-robin. Assunzione da confermare: blocco minimo di 2 slot, requisiti tecnici non modellati | Fase 3 ✅ |
| Tutela nuove associazioni (art. 12) non modellata | Media — **decisa e pianificata**, design in §7-bis.1 | §7-bis |
| ~~Retention/housekeeping non implementati (GDPR art. 23)~~ | ~~Media~~ **Risolta**: `backend-node/src/housekeeping/` (pulizia + scheduler interno giornaliero) | §7-bis ✅ |
| ~~Backup/restore non definiti~~ | ~~Media~~ **Risolta**: servizio `backup` nel compose, ciclo backup→drop→restore verificato reale, `docs/RUNBOOK-backup.md` | §7-bis ✅ |
| `pnpm-workspace.yaml` assente | Bassa — serve con i frontend | Fase 5 |
| Righe `oidc_stato_pkce` scadute mai ripulite | Bassa | Fase 4.9 |
| `isf_al_momento` sempre NULL | Bassa | Fase 3 residuo |

## 7-bis. Lacune a media priorità — ✅ tutte e tre implementate (decise il 2026-07-25, chiuse il 2026-07-27)

### 1. Quota nuove associazioni (art. 12 Doc Principale) — ✅ implementata
**Decisione**: si implementa subito come parametro 🔧 con **default 0 = disattivata** — l'Ente la attiva da UI cambiando il valore, senza migrazione futura.
- Migration `000006`: colonna `quota_nuove_associazioni_pct NUMERIC(6,4) NOT NULL DEFAULT 0` in `parametrico_versioni` (stesso pattern degli altri parametri, versionata).
- **Meccanismo (assunzione da documentare, il testo non lo specifica)**: precedenza dinamica, non riserva statica di fasce specifiche. `N = floor(pct × numero fasce disponibili)`. Durante il round-robin, finché il totale di fasce assegnate ad associazioni `prima_stagione` è `< N`, su ogni fascia contesa il pool di candidati si restringe alle sole prima-stagione **se almeno una è candidata** (altrimenti la fascia va al pool generale: la quota non spreca fasce che nessuna nuova richiede). Poi catena B.20 normale sul pool ristretto.
- Motore: campo `PrimaStagione bool` su `roundrobin.Associazione` (il dato c'è già: `coefficienti_associazione.prima_stagione`), parametro `QuotaNuoveAssociazioniPct` in `InputEsecuzione`, contatore fasce assegnate a nuove (un blocco allenamento conta per tutte le sue fasce). Loader in `internal/postgres/parametrico.go`.
- Gli altri due punti dell'art. 12 sono già coperti: coefficienti neutri prima stagione (istruttoria, fatto), verifica utilizzo effettivo (Fase 15, futuro).

### 2. Job housekeeping / retention GDPR (art. 23 Doc Principale) — ✅ implementata
Nel backend Node: funzioni di pulizia pure e testabili + scheduler interno (intervallo giornaliero, partenza al boot, skippabile via env nei test).
- `oidc_stato_pkce`: DELETE righe scadute mai consumate (i flussi abbandonati oggi si accumulano per sempre).
- `sessioni_backoffice` / `sessioni_persona_fisica`: DELETE righe scadute o revocate da oltre N giorni (tenerle un minimo per audit di sicurezza).
- `log_operazioni`: DELETE righe più vecchie di `retention_log_operazioni_giorni` (**parametro già esistente** in `parametrico_versioni`, default 30 🔧).
- **Mai toccare**: verbali di sorteggio, assegnazioni, settimana tipo — retention legale = intera stagione + termine impugnazione (fisso, non derogabile).
- TDD contro Postgres reale (fixture con date artificiali nel passato).

### 3. Backup Postgres nel compose di produzione — ✅ implementata
**Decisione**: container dedicato nel `docker-compose.yml` (non solo runbook).
- Servizio `backup`: `pg_dump` schedulato giornaliero, output compresso su volume named dedicato (`postgres_backups`), rotazione (default: 7 giornalieri + 4 settimanali), nessun bind mount (coerente col vincolo prod).
- Candidato: immagine `prodrigestivill/postgres-backup-local` (schedulazione+rotazione built-in) — da verificare versione/manutenzione al momento dell'implementazione, altrimenti sidecar `postgres:18-alpine` + cron con script nostro.
- Runbook `docs/RUNBOOK-backup.md`: procedura di restore passo-passo, **verificata davvero** con un ciclo completo backup→drop→restore su container reale prima di dichiararla chiusa.
- Nota: al deploy reale valutare anche backup a livello infrastruttura (VM/storage snapshot) come secondo livello — non sostituisce il dump logico.

## 8. Decisioni aperte (bloccanti per le fasi indicate)

Richiedono l'Ente/stakeholder:
1. **FD = fabbisogno ottimale o minimo?** (art. 5 Doc Principale vs "FD" unico di Allegato A) — implementato ottimale, da confermare. [Fase 7]
2. ~~Quota nuove associazioni (art. 12)~~ **Decisa** (2026-07-25): parametro con default 0, vedi §7-bis. Resta all'Ente solo la scelta del valore.
3. **Allegato parametrico ufficiale**: tutti i valori 🔺 (moltiplicatore peso→minuti 60, peso fasce pregiate 1,25, limiti concentrazione 600/4/2/1, CSD, soglie mancato utilizzo 1/2/3, scostamento 20%, soglia compensazione ISF 0,20). [prima del go-live, non blocca lo sviluppo]
4. **Credenziali pa-sso-proxy** per la verifica OIDC reale. [Fase 7]
5. **Infrastruttura di produzione** (dove gira, come il runner CI raggiunge il DB). [Fase 6]

Tecniche (si decidono in sviluppo):
6. Scelta reverse proxy e design rete container (con CORS/helmet/trust-proxy).
7. Formato ed esposizione pubblica dei verbali di sorteggio (pagina di verifica per terzi?).
8. Modellazione della macchina a stati della procedura (tabella `procedure_stagione` dedicata o stato su `stagioni_sportive`).

---

*Aggiornare questo documento alla chiusura di ogni fase o decisione aperta. Lo stato operativo fine-grained resta in `CLAUDE.md`.*
