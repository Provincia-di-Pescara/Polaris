# Coda verso il motore Go — design

**Data**: 2026-08-02
**Stato**: approvato (sessione interattiva)

## Obiettivo

Il backend Node deve poter innescare le tre elaborazioni esposte da `engine-go/internal/httpapi` (istruttoria, blocchi gara, prima assegnazione) da route backoffice autenticate, sostituendo `curl` manuale. Sblocca Fase 4 "Calcolo dei parametri" e Fase 10 "Pubblicazione proposta provvisoria" lato procedimento.

Vincoli fissi da CLAUDE.md: il motore Go resta puro calcolo, nessuna auth/CRUD propria; il backend Node è l'unico gatekeeper e il motore non è mai esposto fuori dalla rete interna dei container; nessuna logica di calcolo duplicata in Node — si orchestra via HTTP interno (`ENGINE_URL`).

## Contratto motore Go (riferimento, non modificato da questo blocco)

`engine-go/internal/httpapi/httpapi.go`:

- `POST /stagioni/{id}/istruttoria` → `{"domande_calcolate": N}`
- `POST /stagioni/{id}/blocchi-gara` → `{"elaborazione_id","numero_assegnazioni","richieste_non_assegnate"}`
- `POST /stagioni/{id}/prima-assegnazione` → `{"elaborazione_id","numero_assegnazioni","round_eseguiti"}`
- Qualunque errore (dominio o interno) → HTTP 500, body `{"errore": "..."}`. Nessuna differenziazione di status per tipo di errore.

`elaborazioni.tipo` (`db/migrations/000001_init.up.sql`) CHECK `IN ('blocchi_gara','prima_assegnazione','riassegnazione_residue')` — **non include `'istruttoria'`**. `EseguiIstruttoria` non scrive mai una riga in `elaborazioni`, solo in `fabbisogni_riconosciuti`/`coefficienti_associazione`. Conseguenza accettata: lo storico elaborazioni di questo blocco non mostrerà mai un'esecuzione di istruttoria.

## Modulo `backend-node/src/engine/client.ts`

Transport-agnostic (nessuna dipendenza da Express), stesso stile dei repository esistenti.

```ts
export interface RisultatoIstruttoria { domandeCalcolate: number }
export interface RisultatoBlocchiGara { elaborazioneId: string; numeroAssegnazioni: number; richiesteNonAssegnate: number }
export interface RisultatoPrimaAssegnazione { elaborazioneId: string; numeroAssegnazioni: number; roundEseguiti: number }

export class ErroreMotoreIrraggiungibile extends Error {}
export class ErroreMotoreDominio extends Error {} // messaggio = campo "errore" della risposta del motore

export interface ClientMotore {
  eseguiIstruttoria(stagioneId: string): Promise<RisultatoIstruttoria>;
  eseguiBlocchiGara(stagioneId: string): Promise<RisultatoBlocchiGara>;
  eseguiPrimaAssegnazione(stagioneId: string): Promise<RisultatoPrimaAssegnazione>;
}

export function creaClientMotore(baseUrl: string, timeoutMs: number): ClientMotore
```

Ogni funzione: `fetch(`${baseUrl}/stagioni/${stagioneId}/<path>`, {method:'POST', signal: AbortSignal.timeout(timeoutMs)})`.

- `fetch` rigetta (network error, connessione rifiutata, abort da timeout) → `ErroreMotoreIrraggiungibile`.
- Risposta ricevuta con `!res.ok` → legge il body JSON `{errore}`, rilancia `ErroreMotoreDominio(errore)`. Se il body non è JSON valido, usa lo status text come messaggio.
- Risposta `ok` → mappa snake_case→camelCase (stesso pattern di `GET /stagioni`), ritorna l'oggetto tipizzato.

## Configurazione

`ENGINE_URL` e `ENGINE_TIMEOUT_MS` (default `300000`, 5 minuti) letti da env — coerenti con la regola "solo bootstrap in env" (stesso livello di `DATABASE_URL`/`PORT`, non è configurazione di business). `DipendenzeApp` (già esistente in `server.ts`) guadagna un campo opzionale `clientMotore?: ClientMotore` per l'iniezione nei test, con fallback a `creaClientMotore(process.env.ENGINE_URL!, ...)` costruito in `creaApp`. Se `ENGINE_URL` non è impostata, le tre route POST rispondono 500 esplicito (`{errore:'motore non configurato'}`) invece di tentare una chiamata che fallirebbe in modo meno leggibile.

## Route

Tutte sotto `richiedeAutenticazione`:

```
POST /backoffice/stagioni/:id/istruttoria         richiedeRuolo('admin')
POST /backoffice/stagioni/:id/blocchi-gara        richiedeRuolo('admin')
POST /backoffice/stagioni/:id/prima-assegnazione  richiedeRuolo('admin')
GET  /backoffice/stagioni/:id/elaborazioni         richiedeRuolo('admin','operatore')
```

Solo admin sulle POST: innescano calcoli irreversibili su una stagione intera (scrivono assegnazioni/sorteggi), coerente col trattamento già riservato a `parametrico`/impostazioni OIDC/utenti backoffice.

### Guardrail concorrenza e ordine fasi (le tre POST)

Dentro `eseguiInTransazione`:

1. `SELECT pg_advisory_xact_lock(hashtext($1))` con `$1 = stagioneId` — stesso pattern per-riga di `osservazioni.ts::lockDomanda`, qui per-stagione. Rilasciato automaticamente a COMMIT/ROLLBACK.
2. Per `blocchi-gara` e `prima-assegnazione`: verifica che l'istruttoria sia già stata eseguita per la stagione — `SELECT EXISTS(SELECT 1 FROM fabbisogni_riconosciuti fr JOIN domande d ON d.id = fr.domanda_id WHERE d.stagione_id = $1)`. Se falsa → `ErroreOrdineFasiNonRispettato` → HTTP 409 `{errore:'istruttoria non ancora eseguita per questa stagione'}`. `istruttoria` stessa non ha questa verifica (è la prima fase).
3. Chiamata al client motore (funzione corrispondente).
4. Esito:
   - `ErroreMotoreIrraggiungibile` → HTTP 502 `{errore:'motore non raggiungibile'}`.
   - `ErroreMotoreDominio(msg)` → HTTP 500 `{errore: msg}` (passthrough letterale del messaggio del motore).
   - Successo → `registraOperazione` (azione `esegui_istruttoria`/`esegui_blocchi_gara`/`esegui_prima_assegnazione`, `entitaTipo:'stagioni_sportive'`, `entitaId: stagioneId`, `dettaglio`: il risultato tipizzato) nella stessa transazione, poi COMMIT, poi risposta 200 col risultato.

Errori (409/502/500) non scrivono audit log — principio consolidato "solo operazioni di scrittura riuscite".

Il lock resta preso per tutta la durata della chiamata HTTP al motore (che può arrivare al timeout configurato) — un secondo tentativo sulla stessa stagione (stesso tipo o diverso) si accoda sul lock invece di partire in concorrenza. Se il timeout Node scatta, la transazione va in ROLLBACK (nessun audit log, nessun record di successo) ma il motore Go, se ancora in esecuzione, non viene interrotto: l'esito reale è verificabile dall'admin via `GET .../elaborazioni` una volta completato.

### `GET /backoffice/stagioni/:id/elaborazioni`

Nessun lock, nessuna scrittura. `SELECT * FROM elaborazioni WHERE stagione_id = $1 ORDER BY creata_il DESC`, mappata camelCase. Mostra solo i tipi presenti nel CHECK (`blocchi_gara`/`prima_assegnazione`/`riassegnazione_residue`) — non mostrerà mai un'esecuzione di istruttoria, per il limite di schema descritto sopra (non risolto da questo blocco, fuori scope).

### Mapping errori comuni

`22P02` (stagioneId malformato nel path) → 400 su tutte e 4 le route, stesso `comeErroreRiferimentoNonValido` già in uso.

## Errori di dominio nuovi

In `erroriDominio.ts`: `ErroreOrdineFasiNonRispettato` (409). In `engine/client.ts`: `ErroreMotoreIrraggiungibile`, `ErroreMotoreDominio` (mappate a HTTP nella route, non nel modulo — restano trasporto-generiche, non legate a Express).

## Testing

- `backend-node/src/engine/client.test.ts`: `http.createServer` reale in-process (porta 0), nessun mock di `fetch`. Scenari: risposta 200 valida per ciascuna delle tre funzioni; risposta 500 con `{errore}` → `ErroreMotoreDominio` col messaggio corretto; porta chiusa/connessione rifiutata → `ErroreMotoreIrraggiungibile`; handler che ritarda oltre un timeout breve iniettato nel test → `ErroreMotoreIrraggiungibile` (via abort).
- `backend-node/src/server.motoreGo.test.ts`: Postgres reale (`TEST_DATABASE_URL`) + `creaApp(pool, {clientMotore: <fittizio con risultati/errori controllati>})`. Scenari: 403 su operatore (tutte e 4), 409 ordine-fasi (blocchi-gara/prima-assegnazione senza istruttoria pregressa), 502 su `ErroreMotoreIrraggiungibile`, 500 passthrough su `ErroreMotoreDominio`, 200 + verifica riga in `log_operazioni`, GET storico con più righe ordinate, 400 su stagioneId malformato.
- Nessun test end-to-end contro il binario Go reale in questo blocco (resta manuale/smoke-test separato, stesso pattern già documentato per `cmd/service`).

## Fuori scope

- Modifiche allo schema `elaborazioni` per includere `'istruttoria'` come tipo (limite noto, non bloccante per questo blocco).
- Riassegnazione finale (`riassegnazione_residue`) — il motore Go non la espone ancora via HTTP (residuo già noto in CLAUDE.md), quindi nessuna quarta route POST.
- Cancellazione/kill di un'elaborazione motore in corso oltre il timeout Node.
