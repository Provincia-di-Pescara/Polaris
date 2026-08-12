# Backoffice — collegamento 4 view residue (ControlRoom, Parametri, Deleghe, Audit/Sorteggio) — design

**Data**: 2026-08-12

## Obiettivo

Chiudere "UI Fase 5" per il backoffice: collegare le 4 view rimaste su `mockData.ts` (`ControlRoomView`, `ParametriSistemaView`, `DelegheAccreditamentiView`, `AuditSorteggioView`) alle API reali. A differenza del blocco precedente (Impianti/Spazi), qui il backend NON è completo: mancano 4 gruppi di endpoint GET (di sola lettura, nessuna nuova logica di dominio — tutti i dati esistono già in tabelle esistenti).

## Contesto rilevante del backend (esistente, non toccato)

- Parametrico versionato: `GET/POST /backoffice/parametrico(/versioni(/:id))`, tutte `richiedeRuolo('admin')`. Shape completa in `backend-node/src/repository/parametrico.ts` (`VersioneParametrica`, `DatiCreaVersione`, `ScaglioneCsd`) — molti più campi del mock (`caaNeutro`, `csdNeutro`, `sogliaScostamentoDichiaratoPct`, `sogliaIsfCompensazione`, `retentionLogOperazioniGiorni`, `quotaNuoveAssociazioniPct`, `termineGiustificazioneGiorni`, `csdScaglioni[]`).
- Coda motore Go: `POST /backoffice/stagioni/:id/{istruttoria,blocchi-gara,prima-assegnazione,riassegnazione-residua,approva-definitiva}` (admin), `GET /backoffice/stagioni/:id/elaborazioni` (admin+operatore). Nessun endpoint espone FR/CP/ISF per-domanda in forma tabellare — solo l'elenco delle elaborazioni eseguite (esito riassunto), non un dettaglio riga-per-domanda.
- Deleghe: `PUT /backoffice/deleghe/:id/{approva,respingi,revoca}` esistono (admin+operatore). **Manca un GET di lista.**
- Documenti associazione: `POST /pubblico/associazioni/:id/documenti` (upload) esiste. **Manca un GET per leggere/scaricare** un documento già caricato.
- Audit log (`log_operazioni`) e sorteggi (`sorteggi`+`sorteggio_candidati`): tabelle popolate da ogni blocco precedente. **Nessun endpoint GET esiste per nessuna delle due.**

## Decisioni di scope

1. **4 nuovi gruppi di endpoint backend**, tutti di sola lettura (nessun `registraOperazione`, coerente con "audit registra solo scritture"):
   - `GET /backoffice/deleghe?stato=&stagioneId=` (admin+operatore) — lista `abilitazioni` con join `persone_fisiche`(nome, cognome, CF) + `associazioni`(denominazione, CF/PIVA). Repository `abilitazioni.ts::listaAbilitazioni`.
   - `GET /backoffice/associazioni/:associazioneId/documenti` (lista metadata: id, tipo, caricatoIl — mai `file_path` grezzo) + `GET /backoffice/documenti/:id/scarica` (stream bytes, `content-type: application/pdf`, `Content-Disposition: inline`). Stesso ACL admin+operatore. Repository `associazioni.ts`.
   - `GET /backoffice/log-operazioni?entitaTipo=&azione=&dataDa=&dataA=&limit=&offset=` (admin+operatore, limit default 50 / max 200) — join `utenti_backoffice`/`persone_fisiche` per nome-attore leggibile. Nuovo file `backend-node/src/repository/logOperazioni.ts` aggiunge `listaOperazioni` (il file esiste già solo con `registraOperazione`).
   - `GET /backoffice/stagioni/:id/sorteggi` (lista sintetica, join `elaborazioni` per scoping stagione) + `GET /backoffice/sorteggi/:id` (dettaglio completo incl. `candidati[]` ordinati per `rank`). Nuovo file `sorteggi.ts`. Stesso ACL.

   Mapping errori standard su tutte (400 UUID malformato, 404 non trovato) coerente col resto del CRUD backoffice.

2. **Verifica HMAC reale nel browser**: `AuditSorteggioView` ricalcola `HMAC-SHA256(seme_hex, associazione_id)` per ogni candidato con `SubtleCrypto` (`crypto.subtle.importKey('raw', ...)` + `sign('HMAC', ...)`), confronta il risultato hex col valore salvato, mostra ✅/❌ per candidato — non un timeout finto. Nessuna libreria crypto aggiuntiva (Web Crypto è nativa nei browser moderni, coerente col vincolo "niente dipendenze superflue").

3. **Registro log operazioni con filtri server-side reali**: form filtro (entità/azione/intervallo date) che passa query param al nuovo endpoint; paginazione semplice (bottone "carica altri" con `offset` crescente, non componente di paginazione generico).

4. **ControlRoomView**: stagione dal context Header (stesso pattern già stabilito in `ImpiantiSpaziView`). I 3+2 bottoni azione chiamano davvero le rispettive `POST`; ogni chiamata mostra l'errore reale del backend (409 lock-in-corso, 409 ordine-fasi non rispettato — non testo generico). La tabella "Esiti Istruttoria & Parametri" del mock (FR/CP/ISF per domanda) **non ha un endpoint equivalente** e viene sostituita da: lista `GET .../elaborazioni` (storico esecuzioni con esito/timestamp) + link diretto ai verbali sorteggio prodotti (riusa `AuditSorteggioView`/nuovo endpoint sorteggi, filtrato per la stagione corrente). Lo stepper "16 fasi" diventa una barra di stato derivata da `stagioni_sportive.stato` (poche fasi macro reali: `raccolta_domande → istruttoria → concertazione → definitiva`, valori esatti da leggere nello schema/tipo `stato` — non 16 tessere sintetiche finte).

5. **ParametriSistemaView**: form "nuova versione" copre TUTTI i campi reali di `DatiCreaVersione` (non il sottoinsieme del mock), incluso editor righe `csdScaglioni` (aggiungi/rimuovi scaglione, ciascuno con min/max/coefficiente). Ogni campo decimale è un `<input type="text">` (mai `number`, evita arrotondamento float in JS), validato client-side con la stessa regex del backend (`^\d+(\.\d{1,4})?$`) prima del submit — il 400 del backend resta comunque il fallback reale, non solo difesa client. Storico versioni: da `GET /backoffice/parametrico/versioni` (sintetico) + drill-down `GET .../versioni/:id` per il dettaglio on-demand (non tutte le versioni scaricate per intero in una volta).

6. **DelegheAccreditamentiView**: lista da `GET /backoffice/deleghe`, tab-filtro per `stato` (client-side sul risultato, dataset atteso piccolo — nessuna paginazione qui). Approva/Respingi(+motivazione)/Revoca chiamano le PUT reali già esistenti. Documento: fetch reale via i due nuovi endpoint, mostrato in `<iframe>` (i browser renderizzano PDF nativamente) invece del placeholder statico col nome file finto.

7. **Fuori scope esplicito**: dashboard KPI aggregate senza endpoint dedicato (es. "ISF medio calcolato" del mock — richiederebbe una query di aggregazione nuova, non solo un GET di lista; se serve, blocco futuro dedicato). Frontend pubblico. Qualunque modifica al motore Go o a logica di dominio esistente (blocco è solo lettura + wiring). Retention/cancellazione di `log_operazioni` (già gestita da housekeeping esistente, non toccata).

## Componenti

### Backend

- `backend-node/src/abilitazioni.ts`: + `listaAbilitazioni(db, filtri)`.
- `backend-node/src/associazioni.ts`: + `listaDocumenti(db, associazioneId)`, + `trovaDocumentoPerId(db, id)` (per lo stream).
- `backend-node/src/repository/logOperazioni.ts`: + `listaOperazioni(db, filtri)`.
- `backend-node/src/sorteggi.ts` (nuovo): `listaSorteggiPerStagione(db, stagioneId)`, `trovaSorteggioConCandidati(db, id)`.
- `backend-node/src/server.ts`: le 6 nuove route (4 GET lista/dettaglio + 2 documenti), stesso stile try/catch e mapping errori delle route esistenti.

### Frontend — moduli API nuovi

`src/api/deleghe.ts`, `src/api/documenti.ts`, `src/api/audit.ts` (log-operazioni + sorteggi), `src/api/parametrico.ts`, `src/api/motore.ts` (coda Go + elaborazioni) — stesso pattern `apiFetch` + tipi 1:1 col backend di `src/api/impiantiSpazi.ts`.

### Frontend — view riscritte

`ControlRoomView.tsx`, `ParametriSistemaView.tsx`, `DelegheAccreditamentiView.tsx`, `AuditSorteggioView.tsx` — stesso `useState`/`useEffect` locale senza librerie di data-fetching, stessa struttura visiva esistente dove i dati reali lo consentono (vedi decisioni 4-6 per gli scostamenti obbligati dal mock).

### Form nuovi

`VersioneParametricaForm` (con editor `csdScaglioni`), `FiltriLogOperazioniForm` — stile coerente con `SlotForm`/`SpazioForm` del blocco precedente.

## Errori

401/refresh: gestito globalmente da `apiFetch`/`AuthContext`, invariato. 400/404/409: messaggio inline nel componente specifico, stesso pattern già stabilito.

## Testing

Vitest + Testing Library, backend reale (`avviaBackendReale`, login via `creaUtenteTest`) — stesso pattern del blocco Impianti/Spazi. Backend: `node --test` contro Postgres reale per i 4 nuovi gruppi di endpoint (repository test + `server.*.test.ts`), fixture con suffisso random per-run (gotcha noto). Copertura minima per view: lista+filtro deleghe, approva/respingi/revoca, download documento; creazione versione parametrica con scaglioni + validazione decimale rifiutata; filtri log-operazioni; lista sorteggi per stagione + dettaglio + verifica HMAC reale (candidato genuino → ✅, hmac manomesso in fixture di test → ❌); azioni motore Go in ControlRoomView (mock del client motore esistente, non il binario Go vero — stesso pattern già in uso in `engine/client.test.ts`).

## Fuori scope (ripetuto per chiarezza)

- Qualunque KPI aggregato senza query dedicata già pronta.
- Frontend pubblico.
- Modifiche a logica di dominio/motore Go.
