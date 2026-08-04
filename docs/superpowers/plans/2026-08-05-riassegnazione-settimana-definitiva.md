# Riassegnazione finale + settimana tipo definitiva Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare riassegnazione finale delle fasce residue (art. B.29, riuso del round-robin esistente) e approvazione/lettura della settimana tipo definitiva con gestione convenzioni (art. B.30-31), chiudendo il flusso pubblico (blocco 4/4).

**Architettura:** Motore Go: nessuna nuova logica algoritmica, solo parametrizzazione di `elaborazioni.tipo` in `PersistiEsitoRoundRobin` + un quarto endpoint HTTP che riusa `roundrobin.Esegui`/`CaricaSnapshotRoundRobin` già esistenti. Backend Node: un quarto metodo nel client verso il motore (stesso pattern coda-motore-Go), due nuove route di transizione stato/orchestrazione, un repository nuovo per le convenzioni, un repository esteso per la vista pubblica della settimana tipo definitiva (stessa shape di `propostaProvvisoria.ts`, con l'aggiunta di accordi-concertazione/efficacia/fasce-libere).

**Tech Stack:** Go 1.26 (motore), Node.js 24 + TypeScript 7 (backend, `.ts` nativo, `pg` diretto), `node --test`/`go test` contro Postgres reale.

## Global Constraints

- Nessuna modifica di schema: `convenzioni` esiste già dalla Fase 1 (`db/migrations/000001_init.up.sql:535`), `elaborazioni.tipo` ha già `'riassegnazione_residue'` nel CHECK constraint, mai usato finora.
- Ogni valore NUMERIC letto da Postgres sempre con `::text`, mai binding numerico diretto (coerente col resto del progetto e col motore Go).
- Ogni scrittura Node passa da `registraOperazione` (art. B.39) dentro `eseguiInTransazione`.
- Route Node nuove mappano `ErroreNonTrovato`→404, `ErroreStatoNonValidoPerTransizione`→409, `ErroreElaborazioneInCorso`/`ErroreOrdineFasiNonRispettato`→409, `ErroreMotoreIrraggiungibile`→502, `ErroreMotoreDominio`→500, `comeErroreRiferimentoNonValido`→400 — stesso `gestisciEsecuzioneMotore` già esistente in `server.ts` per le 3 route di coda motore Go esistenti, riusato as-is per la nuova quarta.
- Test Go: `TEST_DATABASE_URL` via `connessioneTest(t)` (skip pulito se assente). Test Node: `TEST_DATABASE_URL` via pattern esistente (skip pulito), fixture con suffissi `randomUUID()`/`suffissoCasuale(t)` per unicità su Postgres persistente condiviso.
- Nessuna modifica alla UI (Fase 5, non esiste ancora).
- Nessun endpoint pubblico di conferma convenzione lato associazione in questo blocco (istituzioni scolastiche senza accesso diretto — residuo noto, iter delega scuole mai implementato).

---

## File Structure

- **Modify** `engine-go/internal/postgres/assegnazione.go` — `PersistiEsitoRoundRobin` accetta `tipo` come parametro.
- **Modify** `engine-go/internal/postgres/orchestrazione.go` — `EseguiRoundRobin` invariata nella firma (thin wrapper), nuova `EseguiRiassegnazioneResidua` esportata.
- **Modify** `engine-go/internal/postgres/integration_test.go` — nuovo test di integrazione per la riassegnazione residua.
- **Modify** `engine-go/internal/httpapi/httpapi.go` — nuovo campo `Server.EseguiRiassegnazioneResidua`, nuova route, nuovo handler.
- **Modify** `engine-go/internal/httpapi/httpapi_test.go` — nuovi test HTTP per l'handler.
- **Modify** `engine-go/cmd/service/main.go` — wiring del nuovo campo.
- **Modify** `backend-node/src/engine/client.ts` — nuovo metodo `eseguiRiassegnazioneResidua` su `ClientMotore`.
- **Modify** `backend-node/src/engine/client.test.ts` — nuovo test per il metodo.
- **Modify** `backend-node/src/server.motoreGo.test.ts` — `clientMotoreFittizio` deve fornire un default per il nuovo metodo (altrimenti l'interfaccia `ClientMotore` estesa rompe il typecheck di questo file esistente).
- **Modify** `backend-node/src/server.ts` — nuova route `POST /backoffice/stagioni/:id/riassegnazione-residua` (coda motore Go), nuova route `POST /backoffice/stagioni/:id/approva-definitiva`, nuove route convenzioni, nuova route pubblica settimana tipo definitiva.
- **Create** `backend-node/src/server.riassegnazione.test.ts` — test HTTP per la coda riassegnazione-residua.
- **Create** `backend-node/src/settimanaTipoDefinitiva.ts` — repository: `approvaSettimanaTipoDefinitiva` (B.30, transizione stato + creazione convenzioni) e `trovaSettimanaTipoDefinitiva` (B.30-31, vista pubblica).
- **Create** `backend-node/src/settimanaTipoDefinitiva.test.ts` — test repository.
- **Create** `backend-node/src/convenzioni.ts` — repository: `confermaConvenzione`, `listaConvenzioniPerStagione`.
- **Create** `backend-node/src/convenzioni.test.ts` — test repository.
- **Create** `backend-node/src/server.settimanaTipoDefinitiva.test.ts` — test HTTP end-to-end (approva-definitiva → convenzioni create → conferma → lettura pubblica con efficacia).

---

### Task 1: Motore Go — parametrizza `tipo` e nuova `EseguiRiassegnazioneResidua`

**Files:**
- Modify: `engine-go/internal/postgres/assegnazione.go:243` (`PersistiEsitoRoundRobin`)
- Modify: `engine-go/internal/postgres/orchestrazione.go`
- Modify: `engine-go/internal/postgres/integration_test.go`

**Interfaces:**
- Consumes: `roundrobin.Esegui`, `CaricaSnapshotRoundRobin`, `CaricaParametricoAttivo` (già esistenti, invariate).
- Produces: `func PersistiEsitoRoundRobin(ctx context.Context, pool *pgxpool.Pool, stagioneID, parametricoVersioneID, tipo string, snapshot SnapshotRoundRobin, esito roundrobin.Esito) (elaborazioneID string, err error)` (firma cambiata, `tipo` nuovo 5° parametro dopo `parametricoVersioneID`); `func EseguiRoundRobin(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex string) (roundrobin.Esito, string, error)` (**firma invariata**, comportamento invariato — thin wrapper su tipo="prima_assegnazione"); nuova `func EseguiRiassegnazioneResidua(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex string) (roundrobin.Esito, string, error)`. Consumati da Task 2 (`httpapi.go`).

- [ ] **Step 1: Scrivi il test di integrazione per la riassegnazione residua**

In `engine-go/internal/postgres/integration_test.go`, aggiungi in fondo al file (dopo `TestIntegrazione_IstruttoriaERoundRobin`), riusando esattamente la stessa fixture a 2 associazioni/2 slot già presente in quel test (stessa forma di `must`, `sfx := suffissoCasuale(t)`):

```go
func TestIntegrazione_RiassegnazioneResidua(t *testing.T) {
	pool := connessioneTest(t)
	ctx := context.Background()

	must := func(query string, args ...any) string {
		var id string
		if err := pool.QueryRow(ctx, query+" RETURNING id", args...).Scan(&id); err != nil {
			t.Fatalf("setup fixture (%s): %v", query, err)
		}
		return id
	}

	sfx := suffissoCasuale(t)
	stagioneID := must(`INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, $2, $3)`,
		"2027/2028 - test riassegnazione "+sfx, "2027-09-01", "2028-06-30")
	impiantoID := must(`INSERT INTO impianti (denominazione) VALUES ($1)`, "Palestra Riassegnazione")
	spazioID := must(`INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, $2)`, impiantoID, "Campo")
	slot1ID := must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 1, '16:30', '18:00')`,
		stagioneID, spazioID)
	slot2ID := must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 1, '18:00', '19:30')`,
		stagioneID, spazioID)
	personaID := must(`INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Riassegnazione', $2, 'spid')`,
		"TSTRSS-"+sfx, "sub-riassegnazione-"+sfx)
	assoc1ID := must(`INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2)`, "ASD Riassegnazione Uno "+sfx, "91"+sfx+"001")
	assoc2ID := must(`INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2)`, "ASD Riassegnazione Due "+sfx, "91"+sfx+"002")

	domanda1ID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'A', 60, 500, 'ammessa')`,
		"PROT-RSS-"+sfx+"-1", assoc1ID, stagioneID, personaID)
	domanda2ID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'A', 60, 500, 'ammessa')`,
		"PROT-RSS-"+sfx+"-2", assoc2ID, stagioneID, personaID)

	for _, d := range []string{domanda1ID, domanda2ID} {
		if _, err := pool.Exec(ctx, `INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, 1)`, d, slot1ID); err != nil {
			t.Fatalf("setup preferenza slot1: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, 2)`, d, slot2ID); err != nil {
			t.Fatalf("setup preferenza slot2: %v", err)
		}
	}

	if _, err := EseguiIstruttoria(ctx, pool, stagioneID); err != nil {
		t.Fatalf("EseguiIstruttoria: %v", err)
	}

	// Prima esecuzione: 2 associazioni, 2 slot -> entrambi assegnati, nessuna fascia residua.
	esitoPrimo, _, err := EseguiRoundRobin(ctx, pool, stagioneID, semeIntegrationTest)
	if err != nil {
		t.Fatalf("EseguiRoundRobin: %v", err)
	}
	if len(esitoPrimo.Assegnazioni) != 2 {
		t.Fatalf("prima esecuzione: %d assegnazioni, attese 2", len(esitoPrimo.Assegnazioni))
	}

	// Riassegnazione residua sulla STESSA stagione: nessuno slot libero rimasto, deve
	// produrre 0 nuove assegnazioni e un'elaborazione tipo='riassegnazione_residue'
	// distinta da quella di prima_assegnazione, senza toccare le 2 assegnazioni esistenti.
	esitoResiduo, elaborazioneResiduoID, err := EseguiRiassegnazioneResidua(ctx, pool, stagioneID, semeIntegrationTest)
	if err != nil {
		t.Fatalf("EseguiRiassegnazioneResidua: %v", err)
	}
	if len(esitoResiduo.Assegnazioni) != 0 {
		t.Fatalf("riassegnazione residua: %d assegnazioni, attese 0 (nessuno slot libero)", len(esitoResiduo.Assegnazioni))
	}

	var tipoPersistito string
	if err := pool.QueryRow(ctx, `SELECT tipo FROM elaborazioni WHERE id = $1`, elaborazioneResiduoID).Scan(&tipoPersistito); err != nil {
		t.Fatalf("lettura tipo elaborazione: %v", err)
	}
	if tipoPersistito != "riassegnazione_residue" {
		t.Errorf("tipo elaborazione = %q, atteso riassegnazione_residue", tipoPersistito)
	}

	var numAssegnazioniTotali int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM assegnazioni a JOIN slot_settimana_tipo st ON st.id = a.slot_id
		WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')`, stagioneID).Scan(&numAssegnazioniTotali); err != nil {
		t.Fatalf("conteggio assegnazioni totali: %v", err)
	}
	if numAssegnazioniTotali != 2 {
		t.Errorf("assegnazioni attive totali dopo riassegnazione = %d, attese 2 (invariate)", numAssegnazioniTotali)
	}
}
```

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `MSYS_NO_PATHCONV=1 docker run --rm --network palestre-it-net -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -e TEST_DATABASE_URL="postgres://postgres:test@pg-palestre-dev:5432/palestre?sslmode=disable" -w /app golang:1.26-alpine go test ./internal/postgres/... -run TestIntegrazione_RiassegnazioneResidua -v`
Expected: FAIL — `undefined: EseguiRiassegnazioneResidua` (errore di compilazione, RED valido per Go come da convenzione TDD del progetto).

- [ ] **Step 3: Parametrizza `tipo` in `PersistiEsitoRoundRobin`**

In `engine-go/internal/postgres/assegnazione.go`, cambia la firma (riga 243):

```go
func PersistiEsitoRoundRobin(ctx context.Context, pool *pgxpool.Pool, stagioneID, parametricoVersioneID, tipo string, snapshot SnapshotRoundRobin, esito roundrobin.Esito) (elaborazioneID string, err error) {
```

e la INSERT (righe 250-254), sostituendo il letterale `'prima_assegnazione'` con il parametro:

```go
	err = tx.QueryRow(ctx, `
		INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, conclusa_il, stato, numero_round_eseguiti)
		VALUES ($1, $2, $3, now(), 'completata', $4)
		RETURNING id
	`, stagioneID, tipo, parametricoVersioneID, esito.RoundEseguiti).Scan(&elaborazioneID)
```

- [ ] **Step 4: Aggiorna `orchestrazione.go` — thin wrapper + nuova funzione**

In `engine-go/internal/postgres/orchestrazione.go`, sostituisci l'intero contenuto con:

```go
package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/provincia/palestre-engine/internal/roundrobin"
)

func eseguiRoundRobinConTipo(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex, tipo string) (roundrobin.Esito, string, error) {
	parametrico, err := CaricaParametricoAttivo(ctx, pool)
	if err != nil {
		return roundrobin.Esito{}, "", err
	}

	snapshot, err := CaricaSnapshotRoundRobin(ctx, pool, stagioneID, parametrico, semeHex)
	if err != nil {
		return roundrobin.Esito{}, "", err
	}

	esito, err := roundrobin.Esegui(snapshot.Input)
	if err != nil {
		return roundrobin.Esito{}, "", fmt.Errorf("esecuzione round-robin: %w", err)
	}

	elaborazioneID, err := PersistiEsitoRoundRobin(ctx, pool, stagioneID, parametrico.VersioneID, tipo, snapshot, esito)
	if err != nil {
		return roundrobin.Esito{}, "", err
	}

	return esito, elaborazioneID, nil
}

// EseguiRoundRobin implementa la Fase 8 completa end-to-end (art. B.17-22): carica il
// parametrico attivo e lo snapshot della stagione, esegue il round-robin e persiste il
// risultato in transazione con tipo='prima_assegnazione'. Richiede che EseguiIstruttoria
// sia già stato eseguito.
func EseguiRoundRobin(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
	return eseguiRoundRobinConTipo(ctx, pool, stagioneID, semeHex, "prima_assegnazione")
}

// EseguiRiassegnazioneResidua implementa l'art. B.29: riapplica le regole delle Fasi 8-9
// alle sole fasce ancora libere dopo la concertazione. Nessuna logica nuova rispetto a
// EseguiRoundRobin — il filtro slot-candidati (caricaFasce) esclude già qualsiasi
// assegnazione attiva (non solo blocchi gara) e caricaStatoIniziale somma già
// correttamente lo stato post-concertazione (VA/concentrazione, inclusi gli scambi
// validati). Unica differenza: tipo='riassegnazione_residue' persistito in elaborazioni,
// per distinguerla nello storico da una prima esecuzione.
func EseguiRiassegnazioneResidua(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
	return eseguiRoundRobinConTipo(ctx, pool, stagioneID, semeHex, "riassegnazione_residue")
}
```

- [ ] **Step 5: Esegui il test, verifica che passi**

Run: `MSYS_NO_PATHCONV=1 docker run --rm --network palestre-it-net -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -e TEST_DATABASE_URL="postgres://postgres:test@pg-palestre-dev:5432/palestre?sslmode=disable" -w /app golang:1.26-alpine go test ./internal/postgres/... -v`
Expected: PASS, inclusi tutti i test di integrazione preesistenti (nessuna regressione — `gara_integration_test.go` e `quota_integration_test.go` chiamano `EseguiRoundRobin` con la stessa firma invariata).

- [ ] **Step 6: gofmt + vet**

Run: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -w /app golang:1.26-alpine sh -c "gofmt -w . && go vet ./..."`
Expected: nessun output (pulito).

- [ ] **Step 7: Commit**

```bash
git add engine-go/internal/postgres/assegnazione.go engine-go/internal/postgres/orchestrazione.go engine-go/internal/postgres/integration_test.go
git commit -m "feat(engine): parametrizza tipo elaborazione, aggiungi EseguiRiassegnazioneResidua (art. B.29)"
```

---

### Task 2: Motore Go — endpoint HTTP `/stagioni/{id}/riassegnazione-residua`

**Files:**
- Modify: `engine-go/internal/httpapi/httpapi.go`
- Modify: `engine-go/internal/httpapi/httpapi_test.go`
- Modify: `engine-go/cmd/service/main.go`

**Interfaces:**
- Consumes: `postgres.EseguiRiassegnazioneResidua` (Task 1).
- Produces: `Server.EseguiRiassegnazioneResidua func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error)` (nuovo campo su `httpapi.Server`); route `POST /stagioni/{id}/riassegnazione-residua`, risposta `{"elaborazione_id", "numero_assegnazioni", "round_eseguiti"}` (stessa forma di `prima-assegnazione`). Consumato da Task 3 (client Node).

- [ ] **Step 1: Scrivi i test HTTP falliti**

In `engine-go/internal/httpapi/httpapi_test.go`, aggiungi in fondo al file (dopo `TestPrimaAssegnazione_ErroreGenerazioneSeme`):

```go
func TestRiassegnazioneResidua_Successo(t *testing.T) {
	var semeUsato, stagioneRicevuta string
	s := &Server{
		GeneraSeme: func() (string, error) { return "seme-di-test", nil },
		EseguiRiassegnazioneResidua: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			stagioneRicevuta = stagioneID
			semeUsato = semeHex
			return roundrobin.Esito{
				Assegnazioni:  []roundrobin.Assegnazione{{FasciaID: "f1"}},
				RoundEseguiti: 1,
			}, "elab-residuo-1", nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/stagione-9/riassegnazione-residua", nil)
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200, body: %s", rec.Code, rec.Body.String())
	}
	if stagioneRicevuta != "stagione-9" {
		t.Errorf("stagione_id passato = %s, atteso stagione-9", stagioneRicevuta)
	}
	if semeUsato != "seme-di-test" {
		t.Errorf("seme passato a EseguiRiassegnazioneResidua = %s, atteso quello di GeneraSeme", semeUsato)
	}

	var body struct {
		ElaborazioneID     string `json:"elaborazione_id"`
		NumeroAssegnazioni int    `json:"numero_assegnazioni"`
		RoundEseguiti      int    `json:"round_eseguiti"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("risposta non JSON valido: %v", err)
	}
	if body.ElaborazioneID != "elab-residuo-1" || body.NumeroAssegnazioni != 1 || body.RoundEseguiti != 1 {
		t.Errorf("body = %+v, atteso elaborazione_id=elab-residuo-1 numero_assegnazioni=1 round_eseguiti=1", body)
	}
}

func TestRiassegnazioneResidua_ErroreGenerazioneSeme(t *testing.T) {
	s := &Server{
		GeneraSeme: func() (string, error) { return "", errors.New("csprng non disponibile") },
		EseguiRiassegnazioneResidua: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			t.Fatal("EseguiRiassegnazioneResidua non dovrebbe essere chiamato se la generazione del seme fallisce")
			return roundrobin.Esito{}, "", nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/x/riassegnazione-residua", nil)
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, atteso 500", rec.Code)
	}
}
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -w /app golang:1.26-alpine go test ./internal/httpapi/... -v`
Expected: FAIL — `unknown field EseguiRiassegnazioneResidua in struct literal` (errore di compilazione).

- [ ] **Step 3: Aggiungi il campo, la route e l'handler**

In `engine-go/internal/httpapi/httpapi.go`, aggiungi il campo alla struct `Server` (dopo `EseguiRoundRobin`, riga 23):

```go
	EseguiRiassegnazioneResidua func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error)
```

Aggiungi la route in `Routes()` (dopo la riga `prima-assegnazione`, riga 43):

```go
	mux.HandleFunc("POST /stagioni/{id}/riassegnazione-residua", s.handleRiassegnazioneResidua)
```

Aggiungi l'handler (dopo `handlePrimaAssegnazione`, riga 118):

```go
// handleRiassegnazioneResidua esegue l'art. B.29: come le altre elaborazioni, il seme
// del sorteggio è generato QUI, prima dell'elaborazione (art. B.38) — anche una
// riassegnazione residua può richiedere sorteggi (B.21) tra i candidati rimasti.
func (s *Server) handleRiassegnazioneResidua(w http.ResponseWriter, r *http.Request) {
	stagioneID := r.PathValue("id")

	generaSeme := s.GeneraSeme
	if generaSeme == nil {
		generaSeme = GeneraSemeCSPRNG
	}
	seme, err := generaSeme()
	if err != nil {
		scriviErrore(w, err)
		return
	}

	esito, elaborazioneID, err := s.EseguiRiassegnazioneResidua(r.Context(), stagioneID, seme)
	if err != nil {
		scriviErrore(w, err)
		return
	}

	scriviJSON(w, http.StatusOK, map[string]any{
		"elaborazione_id":     elaborazioneID,
		"numero_assegnazioni": len(esito.Assegnazioni),
		"round_eseguiti":      esito.RoundEseguiti,
	})
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -w /app golang:1.26-alpine go test ./internal/httpapi/... -v`
Expected: PASS, tutti i test del pacchetto (nuovi + preesistenti).

- [ ] **Step 5: Wire `cmd/service/main.go`**

In `engine-go/cmd/service/main.go`, aggiungi al literal `&httpapi.Server{...}` (dopo il campo `EseguiRoundRobin`, riga ~46):

```go
		EseguiRiassegnazioneResidua: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			return postgres.EseguiRiassegnazioneResidua(ctx, pool, stagioneID, semeHex)
		},
```

- [ ] **Step 6: Build completo del modulo**

Run: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -w /app golang:1.26-alpine go build ./...`
Expected: nessun errore (verifica che `cmd/service/main.go` compili con la nuova struct literal).

- [ ] **Step 7: gofmt + vet + test completo**

Run: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/engine-go:/app" -v palestre-go-mod-cache:/go/pkg/mod -w /app golang:1.26-alpine sh -c "gofmt -w . && go vet ./... && go test ./..."`
Expected: pulito, test non di integrazione passano (quelli di integrazione skippano senza `TEST_DATABASE_URL`, atteso in questo ambiente).

- [ ] **Step 8: Commit**

```bash
git add engine-go/internal/httpapi/httpapi.go engine-go/internal/httpapi/httpapi_test.go engine-go/cmd/service/main.go
git commit -m "feat(engine): endpoint HTTP POST /stagioni/{id}/riassegnazione-residua (art. B.29)"
```

---

### Task 3: Node — quarto metodo del client verso il motore

**Files:**
- Modify: `backend-node/src/engine/client.ts`
- Modify: `backend-node/src/engine/client.test.ts`
- Modify: `backend-node/src/server.motoreGo.test.ts`

**Interfaces:**
- Produces: `interface RisultatoRiassegnazioneResidua { elaborazioneId: string; numeroAssegnazioni: number; roundEseguiti: number }`; `ClientMotore.eseguiRiassegnazioneResidua(stagioneId: string): Promise<RisultatoRiassegnazioneResidua>`. Consumato da Task 4 (route Node).

- [ ] **Step 1: Scrivi il test per il nuovo metodo**

Aggiungi in fondo a `backend-node/src/engine/client.test.ts` (dopo il test `eseguiPrimaAssegnazione`):

```ts
test('eseguiRiassegnazioneResidua: risposta 200 valida mappata in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.url, '/stagioni/stagione-4/riassegnazione-residua');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ elaborazione_id: 'elab-3', numero_assegnazioni: 1, round_eseguiti: 1 }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.eseguiRiassegnazioneResidua('stagione-4');
    assert.deepEqual(risultato, { elaborazioneId: 'elab-3', numeroAssegnazioni: 1, roundEseguiti: 1 });
  } finally {
    await chiudi();
  }
});
```

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `cd backend-node && node --test src/engine/client.test.ts`
Expected: FAIL — `client.eseguiRiassegnazioneResidua is not a function`.

- [ ] **Step 3: Aggiungi il metodo in `client.ts`**

In `backend-node/src/engine/client.ts`, aggiungi l'interfaccia risultato (dopo `RisultatoPrimaAssegnazione`):

```ts
export interface RisultatoRiassegnazioneResidua {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  roundEseguiti: number;
}
```

Aggiungi il metodo all'interfaccia `ClientMotore` (dopo `eseguiPrimaAssegnazione`):

```ts
  eseguiRiassegnazioneResidua(stagioneId: string): Promise<RisultatoRiassegnazioneResidua>;
```

Aggiungi l'implementazione nell'oggetto ritornato da `creaClientMotore` (dopo `eseguiPrimaAssegnazione`):

```ts
    async eseguiRiassegnazioneResidua(stagioneId) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, `/stagioni/${stagioneId}/riassegnazione-residua`)) as {
        elaborazione_id: string;
        numero_assegnazioni: number;
        round_eseguiti: number;
      };
      return {
        elaborazioneId: body.elaborazione_id,
        numeroAssegnazioni: body.numero_assegnazioni,
        roundEseguiti: body.round_eseguiti,
      };
    },
```

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `cd backend-node && node --test src/engine/client.test.ts`
Expected: PASS (tutti i test del file).

- [ ] **Step 5: Aggiorna il fixture `clientMotoreFittizio` in `server.motoreGo.test.ts`**

L'interfaccia `ClientMotore` ha ora 4 metodi: senza questo aggiornamento `pnpm exec tsc` fallisce su questo file esistente (l'oggetto ritornato da `clientMotoreFittizio` non soddisfa più il tipo). In `backend-node/src/server.motoreGo.test.ts`, nell'oggetto ritornato da `clientMotoreFittizio` (dopo `eseguiPrimaAssegnazione`), aggiungi:

```ts
      eseguiRiassegnazioneResidua:
        overrides.eseguiRiassegnazioneResidua ??
        (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
```

- [ ] **Step 6: Verifica il typecheck e l'intera suite Node**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test "src/**/*.test.ts"` (quotato)
Expected: tutti i test passano, nessuna regressione su `server.motoreGo.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/engine/client.ts backend-node/src/engine/client.test.ts backend-node/src/server.motoreGo.test.ts
git commit -m "feat(backend): quarto metodo ClientMotore per la riassegnazione residua (art. B.29)"
```

---

### Task 4: Node — route `POST /backoffice/stagioni/:id/riassegnazione-residua`

**Files:**
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.riassegnazione.test.ts`

**Interfaces:**
- Consumes: `ClientMotore.eseguiRiassegnazioneResidua` (Task 3); `verificaStagioneEsiste`, `gestisciEsecuzioneMotore`, `validaStagioneIdUuid`, `limitatoreEsecuzioneMotore`, `eseguiInTransazione`, `registraOperazione`, `ErroreElaborazioneInCorso`, `ErroreStatoNonValidoPerTransizione` (tutti già esistenti in `server.ts`).
- Produces: `POST /backoffice/stagioni/:id/riassegnazione-residua`.

- [ ] **Step 1: Scrivi il test HTTP fallito**

Crea `backend-node/src/server.riassegnazione.test.ts`, riusando l'harness `avviaServerTest`/`creaUtenteBackofficeTest` del pattern già visto in `server.concertazione.publish.test.ts` (stessa struttura, adatta i prefissi random):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import type { ClientMotore } from './engine/client.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool, clientMotore?: ClientMotore) {
  const app = creaApp(pool, clientMotore ? { clientMotore } : {});
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaAdmin(pool: Pool): Promise<{ id: string; token: string }> {
  const email = `riassegnazione-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaStagioneInConcertazione(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-riassegnazione-${randomUUID()}`],
  );
  return r.rows[0]!.id;
}

function clientMotoreFittizio(overrides: Partial<ClientMotore>): ClientMotore {
  return {
    eseguiIstruttoria: overrides.eseguiIstruttoria ?? (async () => ({ domandeCalcolate: 0 })),
    eseguiBlocchiGara: overrides.eseguiBlocchiGara ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, richiesteNonAssegnate: 0 })),
    eseguiPrimaAssegnazione: overrides.eseguiPrimaAssegnazione ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
    eseguiRiassegnazioneResidua:
      overrides.eseguiRiassegnazioneResidua ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
  };
}

test('POST .../riassegnazione-residua: 200, chiama il motore, audit log', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  let chiamataConStagione: string | undefined;
  const client = clientMotoreFittizio({
    eseguiRiassegnazioneResidua: async (stagioneId) => {
      chiamataConStagione = stagioneId;
      return { elaborazioneId: 'elab-test', numeroAssegnazioni: 0, roundEseguiti: 0 };
    },
  });
  const { base, chiudi } = await avviaServerTest(pool, client);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const stagioneId = await creaStagioneInConcertazione(pool);

  const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/riassegnazione-residua`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 200);
  assert.equal(chiamataConStagione, stagioneId);

  const log = await pool.query(`SELECT azione FROM log_operazioni WHERE entita_id = $1 AND azione = 'riassegnazione_residua'`, [stagioneId]);
  assert.equal(log.rowCount, 1);
});

test('POST .../riassegnazione-residua: 409 se esiste proposta accettata_da_tutti pendente', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, clientMotoreFittizio({}));
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const stagioneId = await creaStagioneInConcertazione(pool);
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Riass', $2, 'spid') RETURNING id`,
    [`TSTRAS${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD riass ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO concertazione_proposte (stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id, stato)
     VALUES ($1, 'utilizzo_slot_libero', $2, $3, 'accettata_da_tutti')`,
    [stagioneId, persona.rows[0]!.id, associazione.rows[0]!.id],
  );

  const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/riassegnazione-residua`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 409);
});

test('POST .../riassegnazione-residua: annulla in blocco le proposte in_attesa_accettazione', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, clientMotoreFittizio({}));
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const stagioneId = await creaStagioneInConcertazione(pool);
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Riass', $2, 'spid') RETURNING id`,
    [`TSTRAS${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD riass pend ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const proposta = await pool.query<{ id: string }>(
    `INSERT INTO concertazione_proposte (stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id, stato)
     VALUES ($1, 'scambio_bilaterale', $2, $3, 'in_attesa_accettazione') RETURNING id`,
    [stagioneId, persona.rows[0]!.id, associazione.rows[0]!.id],
  );

  const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/riassegnazione-residua`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 200);

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM concertazione_proposte WHERE id = $1`, [proposta.rows[0]!.id]);
  assert.equal(stato.rows[0]!.stato, 'annullata');
});

test('POST .../riassegnazione-residua: 409 se la stagione non è in stato concertazione', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, clientMotoreFittizio({}));
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'prima_assegnazione') RETURNING id`,
    [`stagione-riassegnazione-stato-${randomUUID()}`],
  );

  const r = await fetch(`${base}/backoffice/stagioni/${stagione.rows[0]!.id}/riassegnazione-residua`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 409);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.riassegnazione.test.ts`
Expected: FAIL — 404 sulla route non ancora esistente.

- [ ] **Step 3: Aggiungi la route in `server.ts`**

Aggiungi subito dopo la route `POST /backoffice/stagioni/:id/prima-assegnazione` esistente (dopo la riga 1919, prima di `GET /backoffice/stagioni/:id/elaborazioni`):

```ts
  app.post(
    '/backoffice/stagioni/:id/riassegnazione-residua',
    limitatoreEsecuzioneMotore,
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!clientMotore) {
        res.status(500).json({ errore: 'motore non configurato' });
        return;
      }
      try {
        validaStagioneIdUuid(stagioneId);
        const risultato = await eseguiInTransazione(pool, async (client) => {
          const lock = await client.query<{ pg_try_advisory_xact_lock: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1))', [
            stagioneId,
          ]);
          if (!lock.rows[0]!.pg_try_advisory_xact_lock) {
            throw new ErroreElaborazioneInCorso('elaborazione già in corso per questa stagione');
          }
          await verificaStagioneEsiste(client, stagioneId);
          const stagione = await client.query<{ stato: string }>('SELECT stato FROM stagioni_sportive WHERE id = $1', [stagioneId]);
          if (stagione.rows[0]!.stato !== 'concertazione') {
            throw new ErroreStatoNonValidoPerTransizione('la stagione non è in fase di concertazione');
          }
          // art. B.24: la finestra di concertazione ha una fine — le proposte già accettate
          // da tutte le parti ma non ancora decise dal backoffice (B.27-28) devono essere
          // validate/rigettate ESPLICITAMENTE prima di chiudere, per non far scavalcare uno
          // scambio già consensuale tra associazioni dalla riassegnazione algoritmica.
          const pendenti = await client.query(
            `SELECT 1 FROM concertazione_proposte WHERE stagione_id = $1 AND stato = 'accettata_da_tutti' LIMIT 1`,
            [stagioneId],
          );
          if ((pendenti.rowCount ?? 0) > 0) {
            throw new ErroreStatoNonValidoPerTransizione(
              'esistono proposte di concertazione accettate da tutte le parti non ancora validate o rigettate',
            );
          }
          // Le proposte mai arrivate a piena accettazione decadono automaticamente alla
          // chiusura della finestra (nessuna parte ha ancora un interesse consolidato).
          await client.query(
            `UPDATE concertazione_proposte SET stato = 'annullata' WHERE stagione_id = $1 AND stato = 'in_attesa_accettazione'`,
            [stagioneId],
          );
          const r = await clientMotore.eseguiRiassegnazioneResidua(stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'riassegnazione_residua',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: r as unknown as Record<string, unknown>,
          });
          return r;
        });
        res.status(200).json(risultato);
      } catch (err) {
        gestisciEsecuzioneMotore(err, res);
      }
    },
  );
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.riassegnazione.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.riassegnazione.test.ts
git commit -m "feat(backend): route riassegnazione residua — chiusura concertazione + coda motore (art. B.29)"
```

---

### Task 5: Node — `settimanaTipoDefinitiva.ts` (approvazione, B.30) + route

**Files:**
- Create: `backend-node/src/settimanaTipoDefinitiva.ts`
- Create: `backend-node/src/settimanaTipoDefinitiva.test.ts`
- Modify: `backend-node/src/server.ts`

**Interfaces:**
- Consumes: `Db`, `ErroreNonTrovato`, `ErroreStatoNonValidoPerTransizione` (già esistenti).
- Produces: `approvaSettimanaTipoDefinitiva(db: Db, stagioneId: string): Promise<{ convenzioniCreate: number }>`. Consumato dalla route `POST /backoffice/stagioni/:id/approva-definitiva` in questo stesso task, e da Task 7 (che estenderà lo stesso file con `trovaSettimanaTipoDefinitiva`).

- [ ] **Step 1: Scrivi il test repository**

Crea `backend-node/src/settimanaTipoDefinitiva.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { approvaSettimanaTipoDefinitiva } from './settimanaTipoDefinitiva.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `HOCKEY-${randomUUID().slice(0, 8)}`, denominazione: 'Hockey' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto stt ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra stt', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo stt', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-stt-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD stt ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Stt', $2, 'spid') RETURNING id`,
    [`TSTSTT${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id, stagioneId, disciplineCodici: [disciplina.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slot.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  return { stagioneId };
}

test('approvaSettimanaTipoDefinitiva transiziona stato e crea una convenzione per assegnazione attiva', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const esito = await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);
  assert.equal(esito.convenzioniCreate, 1);

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [fx.stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'definitiva');

  const convenzioni = await pool.query(`SELECT stato FROM convenzioni c JOIN assegnazioni a ON a.id = c.assegnazione_id JOIN slot_settimana_tipo st ON st.id = a.slot_id WHERE st.stagione_id = $1`, [fx.stagioneId]);
  assert.equal(convenzioni.rowCount, 1);
  assert.equal(convenzioni.rows[0]!.stato, 'in_attesa');
});

test('approvaSettimanaTipoDefinitiva non duplica convenzioni già esistenti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);

  // Riporta artificialmente la stagione a 'concertazione' per testare l'idempotenza sulle
  // convenzioni se approva-definitiva venisse richiamata (scenario di test, non un flusso reale).
  await pool.query(`UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1`, [fx.stagioneId]);
  const secondaEsito = await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);
  assert.equal(secondaEsito.convenzioniCreate, 0);
});

test('approvaSettimanaTipoDefinitiva rifiuta se la stagione non è in concertazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'prima_assegnazione') RETURNING id`,
    [`stagione-stt-stato-${randomUUID()}`],
  );
  await assert.rejects(() => approvaSettimanaTipoDefinitiva(pool, stagione.rows[0]!.id), ErroreStatoNonValidoPerTransizione);
});

test('approvaSettimanaTipoDefinitiva lancia ErroreNonTrovato su stagione inesistente', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  await assert.rejects(() => approvaSettimanaTipoDefinitiva(pool, randomUUID()), ErroreNonTrovato);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/settimanaTipoDefinitiva.test.ts`
Expected: FAIL — `Cannot find module './settimanaTipoDefinitiva.ts'`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `backend-node/src/settimanaTipoDefinitiva.ts`:

```ts
import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

// art. B.30: approva il quadro definitivo. Nessuna precondizione oltre lo stato — la
// riassegnazione residua (art. B.29) è un'azione discrezionale separata, non un
// prerequisito rigido (l'admin può approvare anche senza rieseguirla se non restano
// fasce libere da assegnare).
export async function approvaSettimanaTipoDefinitiva(db: Db, stagioneId: string): Promise<{ convenzioniCreate: number }> {
  const r = await db.query(
    `UPDATE stagioni_sportive SET stato = 'definitiva' WHERE id = $1 AND stato = 'concertazione' RETURNING id`,
    [stagioneId],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('stagione non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la stagione non è in fase di concertazione');
  }

  // art. B.31: l'efficacia di ciascuna assegnazione presso una palestra scolastica è
  // subordinata al perfezionamento della convenzione — una riga 'in_attesa' per ogni
  // assegnazione attiva che non ne ha già una (copre singola/blocco_allenamento/
  // blocco_gara, B.31 non distingue per tipo). NOT EXISTS la rende idempotente: una
  // riapprovazione non duplica le convenzioni già create.
  const convenzioni = await db.query(
    `INSERT INTO convenzioni (assegnazione_id, istituzione_scolastica_id)
     SELECT a.id, i.id
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = st.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
       AND NOT EXISTS (SELECT 1 FROM convenzioni c WHERE c.assegnazione_id = a.id)
     RETURNING id`,
    [stagioneId],
  );
  return { convenzioniCreate: convenzioni.rowCount ?? 0 };
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/settimanaTipoDefinitiva.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Aggiungi la route in `server.ts`**

Aggiungi l'import in cima a `server.ts`:

```ts
import { approvaSettimanaTipoDefinitiva } from './settimanaTipoDefinitiva.ts';
```

Aggiungi la route, subito dopo il blocco "coda motore Go" (dopo la route `GET /backoffice/stagioni/:id/elaborazioni`):

```ts
  // --- Approvazione settimana tipo definitiva (art. B.30) ---

  app.post(
    '/backoffice/stagioni/:id/approva-definitiva',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const esito = await eseguiInTransazione(pool, async (client) => {
          const e = await approvaSettimanaTipoDefinitiva(client, stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'approva_settimana_tipo_definitiva',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: { convenzioniCreate: e.convenzioniCreate },
          });
          return e;
        });
        res.status(200).json(esito);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 6: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/settimanaTipoDefinitiva.ts backend-node/src/settimanaTipoDefinitiva.test.ts backend-node/src/server.ts
git commit -m "feat(backend): approvazione settimana tipo definitiva — transizione stato + creazione convenzioni (art. B.30)"
```

---

### Task 6: Node — `convenzioni.ts` (conferma, B.31) + route

**Files:**
- Create: `backend-node/src/convenzioni.ts`
- Create: `backend-node/src/convenzioni.test.ts`
- Modify: `backend-node/src/server.ts`

**Interfaces:**
- Consumes: `Db`, `ErroreNonTrovato`, `ErroreStatoNonValidoPerTransizione`.
- Produces: `interface Convenzione { id, assegnazioneId, istituzioneScolasticaId, stato, confermataIl, confermataDaUtenteBackofficeId, confermataDaPersonaFisicaId }`; `confermaConvenzione(db: Db, id: string, confermataDa: string): Promise<Convenzione>`; `listaConvenzioniPerStagione(db: Db, stagioneId: string, stato?: 'in_attesa' | 'perfezionata'): Promise<Convenzione[]>`. Consumati dalle route in questo stesso task.

- [ ] **Step 1: Scrivi il test repository**

Crea `backend-node/src/convenzioni.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { confermaConvenzione, listaConvenzioniPerStagione } from './convenzioni.ts';
import { approvaSettimanaTipoDefinitiva } from './settimanaTipoDefinitiva.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixtureConConvenzione(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `SCHERMA-${randomUUID().slice(0, 8)}`, denominazione: 'Scherma' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto conv ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra conv', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Sala conv', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-conv-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD conv ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Conv', $2, 'spid') RETURNING id`,
    [`TSTCNV${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id, stagioneId, disciplineCodici: [disciplina.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slot.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  await approvaSettimanaTipoDefinitiva(pool, stagioneId);
  const convenzione = await pool.query<{ id: string }>(
    `SELECT c.id FROM convenzioni c JOIN assegnazioni a ON a.id = c.assegnazione_id JOIN slot_settimana_tipo st ON st.id = a.slot_id WHERE st.stagione_id = $1`,
    [stagioneId],
  );
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, 'x', 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [`conv-admin-${randomUUID()}@test.local`],
  );
  return { stagioneId, convenzioneId: convenzione.rows[0]!.id, adminId: admin.rows[0]!.id };
}

test('confermaConvenzione transiziona a perfezionata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConConvenzione(pool);

  const convenzione = await confermaConvenzione(pool, fx.convenzioneId, fx.adminId);
  assert.equal(convenzione.stato, 'perfezionata');
  assert.equal(convenzione.confermataDaUtenteBackofficeId, fx.adminId);
});

test('confermaConvenzione rifiuta doppia conferma', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConConvenzione(pool);
  await confermaConvenzione(pool, fx.convenzioneId, fx.adminId);
  await assert.rejects(() => confermaConvenzione(pool, fx.convenzioneId, fx.adminId), ErroreStatoNonValidoPerTransizione);
});

test('confermaConvenzione lancia ErroreNonTrovato su id inesistente', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, 'x', 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [`conv-admin2-${randomUUID()}@test.local`],
  );
  await assert.rejects(() => confermaConvenzione(pool, randomUUID(), admin.rows[0]!.id), ErroreNonTrovato);
});

test('listaConvenzioniPerStagione filtra per stato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixtureConConvenzione(pool);

  const inAttesa = await listaConvenzioniPerStagione(pool, fx.stagioneId, 'in_attesa');
  assert.equal(inAttesa.length, 1);

  await confermaConvenzione(pool, fx.convenzioneId, fx.adminId);
  const perfezionate = await listaConvenzioniPerStagione(pool, fx.stagioneId, 'perfezionata');
  assert.equal(perfezionate.length, 1);
  const ancoraInAttesa = await listaConvenzioniPerStagione(pool, fx.stagioneId, 'in_attesa');
  assert.equal(ancoraInAttesa.length, 0);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/convenzioni.test.ts`
Expected: FAIL — `Cannot find module './convenzioni.ts'`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `backend-node/src/convenzioni.ts`:

```ts
import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

export interface Convenzione {
  id: string;
  assegnazioneId: string;
  istituzioneScolasticaId: string;
  stato: 'in_attesa' | 'perfezionata';
  confermataIl: string | null;
  confermataDaUtenteBackofficeId: string | null;
  confermataDaPersonaFisicaId: string | null;
}

interface RigaConvenzione {
  id: string;
  assegnazione_id: string;
  istituzione_scolastica_id: string;
  stato: 'in_attesa' | 'perfezionata';
  confermata_il: Date | null;
  confermata_da_utente_backoffice_id: string | null;
  confermata_da_persona_fisica_id: string | null;
}

const COLONNE_SELECT = `id, assegnazione_id, istituzione_scolastica_id, stato, confermata_il,
  confermata_da_utente_backoffice_id, confermata_da_persona_fisica_id`;

function daRiga(r: RigaConvenzione): Convenzione {
  return {
    id: r.id,
    assegnazioneId: r.assegnazione_id,
    istituzioneScolasticaId: r.istituzione_scolastica_id,
    stato: r.stato,
    confermataIl: r.confermata_il ? r.confermata_il.toISOString() : null,
    confermataDaUtenteBackofficeId: r.confermata_da_utente_backoffice_id,
    confermataDaPersonaFisicaId: r.confermata_da_persona_fisica_id,
  };
}

// art. B.31: conferma sempre lato backoffice per conto dell'istituzione scolastica — le
// istituzioni non hanno accesso diretto alla piattaforma (iter delega manuale mai
// implementato, residuo noto). Guardia atomica dentro la WHERE, stesso pattern di
// ammettiDomanda/approvaAbilitazione.
export async function confermaConvenzione(db: Db, id: string, confermataDa: string): Promise<Convenzione> {
  const r = await db.query<RigaConvenzione>(
    `UPDATE convenzioni SET stato = 'perfezionata', confermata_il = now(), confermata_da_utente_backoffice_id = $2
     WHERE id = $1 AND stato = 'in_attesa'
     RETURNING ${COLONNE_SELECT}`,
    [id, confermataDa],
  );
  const riga = r.rows[0];
  if (riga) {
    return daRiga(riga);
  }
  const check = await db.query(`SELECT 1 FROM convenzioni WHERE id = $1`, [id]);
  if ((check.rowCount ?? 0) === 0) {
    throw new ErroreNonTrovato('convenzione non trovata');
  }
  throw new ErroreStatoNonValidoPerTransizione('la convenzione è già perfezionata');
}

const COLONNE_SELECT_C = `c.id, c.assegnazione_id, c.istituzione_scolastica_id, c.stato, c.confermata_il,
  c.confermata_da_utente_backoffice_id, c.confermata_da_persona_fisica_id`;

export async function listaConvenzioniPerStagione(db: Db, stagioneId: string, stato?: 'in_attesa' | 'perfezionata'): Promise<Convenzione[]> {
  const r = stato
    ? await db.query<RigaConvenzione>(
        `SELECT ${COLONNE_SELECT_C}
         FROM convenzioni c
         JOIN assegnazioni a ON a.id = c.assegnazione_id
         JOIN slot_settimana_tipo st ON st.id = a.slot_id
         WHERE st.stagione_id = $1 AND c.stato = $2
         ORDER BY st.giorno_settimana, st.orario_inizio`,
        [stagioneId, stato],
      )
    : await db.query<RigaConvenzione>(
        `SELECT ${COLONNE_SELECT_C}
         FROM convenzioni c
         JOIN assegnazioni a ON a.id = c.assegnazione_id
         JOIN slot_settimana_tipo st ON st.id = a.slot_id
         WHERE st.stagione_id = $1
         ORDER BY st.giorno_settimana, st.orario_inizio`,
        [stagioneId],
      );
  return r.rows.map(daRiga);
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/convenzioni.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Aggiungi le route in `server.ts`**

Aggiungi l'import:

```ts
import { confermaConvenzione, listaConvenzioniPerStagione } from './convenzioni.ts';
```

Aggiungi le route, subito dopo `POST /backoffice/stagioni/:id/approva-definitiva` (Task 5):

```ts
  // --- Convenzioni (art. B.31) ---

  app.get(
    '/backoffice/stagioni/:id/convenzioni',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stato = req.query.stato === 'in_attesa' || req.query.stato === 'perfezionata' ? req.query.stato : undefined;
      try {
        res.status(200).json(await listaConvenzioniPerStagione(pool, stagioneId, stato));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/convenzioni/:id/conferma',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const convenzione = await eseguiInTransazione(pool, async (client) => {
          const c = await confermaConvenzione(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'conferma_convenzione',
            entitaTipo: 'convenzioni',
            entitaId: c.id,
            dettaglio: { stato: c.stato },
          });
          return c;
        });
        res.status(200).json(convenzione);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 6: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/convenzioni.ts backend-node/src/convenzioni.test.ts backend-node/src/server.ts
git commit -m "feat(backend): conferma convenzioni + coda backoffice (art. B.31)"
```

---

### Task 7: Node — vista pubblica settimana tipo definitiva + test end-to-end

**Files:**
- Modify: `backend-node/src/settimanaTipoDefinitiva.ts`
- Modify: `backend-node/src/settimanaTipoDefinitiva.test.ts`
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.settimanaTipoDefinitiva.test.ts`

**Interfaces:**
- Consumes: `approvaSettimanaTipoDefinitiva` (Task 5), `confermaConvenzione` (Task 6).
- Produces: `interface VoceSettimanaTipoDefinitiva extends VocePropostaProvvisoria { concertazioneProposaId: string | null; efficace: boolean }`; `trovaSettimanaTipoDefinitiva(db: Db, stagioneId: string): Promise<{ fasce: VoceSettimanaTipoDefinitiva[]; slotLiberi: string[] }>`; `GET /pubblico/stagioni/:id/settimana-tipo-definitiva`.

- [ ] **Step 1: Scrivi il test repository (aggiungi al file esistente)**

Aggiungi in fondo a `backend-node/src/settimanaTipoDefinitiva.test.ts` (import aggiuntivo in cima: `import { trovaSettimanaTipoDefinitiva } from './settimanaTipoDefinitiva.ts';` e `import { ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';` già presente):

```ts
test('trovaSettimanaTipoDefinitiva rifiuta prima dell\'approvazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await assert.rejects(() => trovaSettimanaTipoDefinitiva(pool, fx.stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('trovaSettimanaTipoDefinitiva: fasce assegnate + slot liberi + efficacia dopo approvazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  // Un secondo slot libero nella stessa stagione, mai assegnato.
  const spazio = await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE stagione_id = $1 LIMIT 1`, [fx.stagioneId]);
  const slotLibero = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 3, '18:00', '19:00') RETURNING id`,
    [fx.stagioneId, spazio.rows[0]!.spazio_id],
  );

  await approvaSettimanaTipoDefinitiva(pool, fx.stagioneId);
  const esito = await trovaSettimanaTipoDefinitiva(pool, fx.stagioneId);

  assert.equal(esito.fasce.length, 1);
  assert.equal(esito.fasce[0]!.efficace, false); // convenzione ancora in_attesa
  assert.deepEqual(esito.slotLiberi, [slotLibero.rows[0]!.id]);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/settimanaTipoDefinitiva.test.ts`
Expected: FAIL — `trovaSettimanaTipoDefinitiva is not a function`.

- [ ] **Step 3: Estendi `settimanaTipoDefinitiva.ts`**

Aggiungi in fondo a `backend-node/src/settimanaTipoDefinitiva.ts`:

```ts
export interface VoceSettimanaTipoDefinitiva {
  slotId: string;
  associazioneId: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
  concertazioneProposaId: string | null;
  efficace: boolean;
}

interface RigaVoceDefinitiva {
  slot_id: string;
  associazione_id: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valore_minuti: string;
  fr_finale_minuti: string | null;
  isf: string | null;
  sorteggio_id: string | null;
  articolo_riferimento: string | null;
  concertazione_proposta_id: string | null;
  efficace: boolean;
}

const STATI_STAGIONE_CON_DEFINITIVA = ['definitiva', 'chiusa'];

// art. B.30-31: stessa query di propostaProvvisoria.ts::trovaPropostaProvvisoria (ISF
// cumulativo via window function, LATERAL su sorteggi per evitare fan-out — vedi i
// commenti lì per il ragionamento completo, non ripetuto qui), estesa con il riferimento
// all'accordo di concertazione (se la fascia deriva da uno scambio validato) e
// l'efficacia (B.31: subordinata al perfezionamento della convenzione).
export async function trovaSettimanaTipoDefinitiva(
  db: Db,
  stagioneId: string,
): Promise<{ fasce: VoceSettimanaTipoDefinitiva[]; slotLiberi: string[] }> {
  const stagione = await db.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  const riga = stagione.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('stagione non trovata');
  }
  if (!STATI_STAGIONE_CON_DEFINITIVA.includes(riga.stato)) {
    throw new ErroreStatoNonValidoPerTransizione('la settimana tipo definitiva non è ancora stata approvata per questa stagione');
  }

  const fasce = await db.query<RigaVoceDefinitiva>(
    `SELECT a.slot_id, a.associazione_id, a.tipo, a.valore_minuti::text AS valore_minuti,
            fr.fr_finale_minuti::text AS fr_finale_minuti,
            (CASE WHEN fr.fr_finale_minuti IS NULL OR fr.fr_finale_minuti = 0 THEN NULL
                  ELSE ROUND(SUM(a.valore_minuti) OVER (PARTITION BY a.associazione_id) / fr.fr_finale_minuti, 3) END)::text AS isf,
            so.id AS sorteggio_id, so.articolo_riferimento,
            a.concertazione_proposta_id,
            COALESCE(c.stato = 'perfezionata', false) AS efficace
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = a.domanda_id
     LEFT JOIN LATERAL (
       SELECT id, articolo_riferimento FROM sorteggi
       WHERE elaborazione_id = a.elaborazione_id AND vincitore_associazione_id = a.associazione_id
       ORDER BY seme_generato_il ASC LIMIT 1
     ) so ON true
     LEFT JOIN convenzioni c ON c.assegnazione_id = a.id
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
     ORDER BY st.giorno_settimana, st.orario_inizio`,
    [stagioneId],
  );

  const slotLiberi = await db.query<{ id: string }>(
    `SELECT st.id FROM slot_settimana_tipo st
     WHERE st.stagione_id = $1 AND st.indisponibile_permanente = false
       AND NOT EXISTS (SELECT 1 FROM assegnazioni a WHERE a.slot_id = st.id AND a.stato IN ('provvisoria', 'validata'))
     ORDER BY st.giorno_settimana, st.orario_inizio`,
    [stagioneId],
  );

  return {
    fasce: fasce.rows.map((v) => ({
      slotId: v.slot_id,
      associazioneId: v.associazione_id,
      tipo: v.tipo,
      valoreMinutiAssegnato: v.valore_minuti,
      fabbisognoRiconosciutoMinuti: v.fr_finale_minuti,
      isf: v.isf,
      sorteggioRiferimento: v.sorteggio_id ? { sorteggioId: v.sorteggio_id, articoloRiferimento: v.articolo_riferimento! } : null,
      concertazioneProposaId: v.concertazione_proposta_id,
      efficace: v.efficace,
    })),
    slotLiberi: slotLiberi.rows.map((r) => r.id),
  };
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/settimanaTipoDefinitiva.test.ts`
Expected: PASS (tutti i test del file, inclusi quelli di Task 5).

- [ ] **Step 5: Scrivi il test HTTP end-to-end**

Crea `backend-node/src/server.settimanaTipoDefinitiva.test.ts`, riusando lo stesso harness/pattern fixture di `server.concertazione.validazione.test.ts` (stagione+associazione+persona+domanda+slot+assegnazione), estendendo con il flusso completo:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { hashPassword } from './auth/password.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaAdmin(pool: Pool): Promise<{ id: string; token: string }> {
  const email = `stt-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaFixtureCompleta(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `JUDO-${randomUUID().slice(0, 8)}`, denominazione: 'Judo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto stt http ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra stt http', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Tatami', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-stt-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD stt http ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTHTT${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Stt', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id, stagioneId, disciplineCodici: [disciplina.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slot.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  const tokenPubblico = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: 'Stt' });
  return { stagioneId, tokenPubblico };
}

test('flusso end-to-end: approva-definitiva → convenzioni in coda → conferma → lettura pubblica con efficacia', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool);

  const rPre = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/settimana-tipo-definitiva`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  assert.equal(rPre.status, 409);

  const rApprova = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/approva-definitiva`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rApprova.status, 200);
  assert.equal((await rApprova.json()).convenzioniCreate, 1);

  const rCoda = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/convenzioni?stato=in_attesa`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  const coda = await rCoda.json();
  assert.equal(coda.length, 1);

  const rDopoApprova = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/settimana-tipo-definitiva`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  assert.equal(rDopoApprova.status, 200);
  const primaConferma = await rDopoApprova.json();
  assert.equal(primaConferma.fasce[0].efficace, false);

  const rConferma = await fetch(`${base}/backoffice/convenzioni/${coda[0].id}/conferma`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rConferma.status, 200);

  const rFinale = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/settimana-tipo-definitiva`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  const finale = await rFinale.json();
  assert.equal(finale.fasce[0].efficace, true);
});

test('PUT conferma: 409 su doppia conferma, 404 su id inesistente', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);

  const r404 = await fetch(`${base}/backoffice/convenzioni/${randomUUID()}/conferma`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r404.status, 404);
});
```

- [ ] **Step 6: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.settimanaTipoDefinitiva.test.ts`
Expected: FAIL — 404 sulla route pubblica non ancora esistente.

- [ ] **Step 7: Aggiungi la route pubblica in `server.ts`**

Aggiungi l'import: `import { trovaSettimanaTipoDefinitiva } from './settimanaTipoDefinitiva.ts';` (unisci con l'import esistente `approvaSettimanaTipoDefinitiva` dallo stesso modulo in un solo import multiplo).

Aggiungi la route, dopo le route convenzioni (Task 6):

```ts
  // --- Pubblico: settimana tipo definitiva (art. B.30-31) ---

  app.get(
    '/pubblico/stagioni/:id/settimana-tipo-definitiva',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        res.status(200).json(await trovaSettimanaTipoDefinitiva(pool, stagioneId));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 8: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.settimanaTipoDefinitiva.test.ts`
Expected: PASS (2/2).

- [ ] **Step 9: Verifica il typecheck e l'intera suite**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test "src/**/*.test.ts"` (quotato)
Expected: tutti i test passano, nessuna regressione sul resto della suite.

- [ ] **Step 10: Commit**

```bash
git add backend-node/src/settimanaTipoDefinitiva.ts backend-node/src/settimanaTipoDefinitiva.test.ts backend-node/src/server.ts backend-node/src/server.settimanaTipoDefinitiva.test.ts
git commit -m "feat(backend): vista pubblica settimana tipo definitiva con efficacia ed accordi concertazione (art. B.30-31)"
```

---

## Self-Review Notes

- **Spec coverage**: B.29 (Task 1, 2, 4) · B.30 (Task 5, 7 — formazione quadro con fasce assegnate/blocchi gara/fasce libere/accordi concertazione) · B.31 (Task 6, 7 — convenzioni, efficacia). Fuori scope confermato dallo spec: conferma pubblica lato associazione, Fase 15 (B.32-36).
- **Placeholder scan**: nessun TBD/TODO; ogni step ha codice completo.
- **Type consistency**: `RisultatoRiassegnazioneResidua` (Task 3) usato identico in Task 4. `VocePropostaProvvisoria` (blocco 3/4, riusato per struttura) esteso in `VoceSettimanaTipoDefinitiva` (Task 7) con gli stessi nomi camelCase. `Convenzione` (Task 6) usato identico nelle route dello stesso task e nei test di Task 7.
