# WizardDomandaView: collegamento API reali Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collegare `WizardDomandaView` (frontend pubblico) al vero flusso di presentazione domanda (`POST /pubblico/domande`, già completo lato backend), sostituendo i campi mock con quelli reali (discipline/classe attività/numeri/blocchi gara multipli/selettore slot per preferenze), e aggiungere un'anteprima FR live che chiama il vero motore Go invece di duplicare la formula in TypeScript.

**Architecture:** Tre livelli, in quest'ordine di dipendenza: (1) motore Go — nuovo endpoint stateless `POST /anteprima-fabbisogno` che espone `istruttoria.Calcola` (esistente, puro); (2) backend Node — 4 nuove rotte pubbliche (`GET /discipline`, `GET /classi-attivita`, `GET /pubblico/stagioni/:id/slot`, `POST /pubblico/domande/anteprima-fabbisogno` come proxy verso il motore); (3) frontend pubblico — `WizardDomandaView` riscritta sui campi reali. Nessuna modifica a `POST /pubblico/domande` (già completo).

## Global Constraints

- **Nessuna duplicazione della formula FR/coefficienti in TypeScript**: l'anteprima chiama sempre il motore Go via il nuovo endpoint — vincolo esplicito già in `CLAUDE.md` ("Riusa le regole di business del motore Go via RPC — non duplicare logica di calcolo in Node").
- **`primaStagione`/`anniAttivita` per l'anteprima**: calcolati lato Go con la STESSA query già in uso in `caricaDomandeAmmesse` (`engine-go/internal/postgres/istruttoria.go`), adattata per un singolo `associazioneId`+`stagioneId` invece di iterare su domande esistenti — non reinventare la logica, replicarla fedelmente (stesso confronto `data_inizio` tra stagioni, stesso calcolo anni attività).
- **Decimal-come-stringa**: `fdMinuti` viaggia come stringa in tutta la catena (frontend→Node→Go→risposta), mai un binding numerico diretto — stesso vincolo di tutto il resto del progetto.
- **`POST /pubblico/domande` non viene toccato** — schema, route, validazioni restano esattamente come sono (già completi, già testati). Questo blocco tocca solo endpoint di lettura/anteprima nuovi + il frontend.
- **`GET /pubblico/stagioni/:id/slot` richiede `richiedeAutenticazionePubblico`** (coerente con gli altri endpoint `/pubblico/*` che leggono dati scoped a una sessione autenticata), mentre `GET /discipline`/`GET /classi-attivita` sono pubblici non autenticati (dati di riferimento, stesso livello di `GET /stagioni`/`GET /organismi-sportivi`).
- Italiano per nomi funzione/variabile/commenti, sia in Go (`nomiFunzione` → in Go si usa `PascalCase`/`camelCase` idiomatico, non italiano forzato dove romperebbe le convenzioni Go standard — usare nomi italiani per concetti di dominio, es. `CaricaAnteprimaFabbisogno`, non per pattern strutturali Go standard) sia in TypeScript, coerente col resto del repo.

---

### Task 1: Motore Go — endpoint `POST /anteprima-fabbisogno`

**Files:**
- Modify: `engine-go/internal/postgres/istruttoria.go`
- Modify: `engine-go/internal/httpapi/httpapi.go`
- Modify: `engine-go/cmd/service/main.go`
- Test: `engine-go/internal/postgres/istruttoria_test.go` (estensione, se esiste — verifica il nome esatto del file)
- Test: `engine-go/internal/httpapi/httpapi_test.go` (estensione)

**Interfaces:**
- Produces (usate da Task 3): `POST /anteprima-fabbisogno` — request JSON `{associazione_id, stagione_id, classe_attivita_codice, livello_campionato, numero_squadre_federali, fd_minuti}` (`livello_campionato` opzionale/nullable), response `{peso_base, incremento_squadre, fr_calcolato_minuti, fr_finale_minuti, crs, caa, csd, cp}` (tutti i decimal come stringa).

- [ ] **Step 1: `CaricaAnteprimaFabbisogno` in `engine-go/internal/postgres/istruttoria.go`**

Aggiungi in fondo al file (dopo `EseguiIstruttoria`):

```go
// DatiAnteprimaFabbisogno raccoglie l'input grezzo per un'anteprima FR/coefficienti,
// prima che la domanda esista davvero (usato dal wizard di presentazione domanda).
type DatiAnteprimaFabbisogno struct {
	AssociazioneID        string
	StagioneID            string
	ClasseAttivitaCodice  string
	LivelloCampionato     *string
	NumeroSquadreFederali int
	FDMinuti              string
}

// caricaContestoAnteprima replica la stessa query di caricaDomandeAmmesse (prima_stagione,
// anni_attivita) ma per una coppia associazione/stagione che non ha ancora una domanda —
// confronta contro la data_inizio della stagione TARGET, non quella di una domanda esistente.
func caricaContestoAnteprima(ctx context.Context, pool *pgxpool.Pool, associazioneID, stagioneID string) (anniAttivita decimal.Decimal, primaStagione bool, err error) {
	var anniAttivitaTxt *string
	err = pool.QueryRow(ctx, `
		SELECT
			CASE WHEN a.data_costituzione IS NULL THEN NULL
			     ELSE ((s.data_inizio - a.data_costituzione)::numeric / 365.25)::text
			END,
			NOT EXISTS (
				SELECT 1 FROM domande d2
				JOIN stagioni_sportive s2 ON s2.id = d2.stagione_id
				WHERE d2.associazione_id = a.id
				  AND d2.stato = 'ammessa'
				  AND s2.data_inizio < s.data_inizio
			)
		FROM associazioni a, stagioni_sportive s
		WHERE a.id = $1 AND s.id = $2
	`, associazioneID, stagioneID).Scan(&anniAttivitaTxt, &primaStagione)
	if err != nil {
		return decimal.Decimal{}, false, fmt.Errorf("caricamento contesto anteprima: %w", err)
	}

	if primaStagione {
		return decimal.Zero, true, nil
	}
	if anniAttivitaTxt == nil {
		return decimal.Decimal{}, false, fmt.Errorf("associazione senza data_costituzione, impossibile calcolare CAA (non è prima stagione)")
	}
	anniAttivita, err = decimalDaTesto(*anniAttivitaTxt)
	if err != nil {
		return decimal.Decimal{}, false, err
	}
	return anniAttivita, false, nil
}

// CaricaAnteprimaFabbisogno calcola un'anteprima FR/coefficienti per una domanda non
// ancora presentata (wizard di compilazione) — stessa formula di EseguiIstruttoria, nessuna
// scrittura, nessuna persistenza. La versione parametrico usata è sempre quella attiva
// al momento della chiamata (nessuna cache, l'anteprima deve riflettere il valore corrente).
func CaricaAnteprimaFabbisogno(ctx context.Context, pool *pgxpool.Pool, dati DatiAnteprimaFabbisogno) (istruttoria.Fabbisogno, istruttoria.Coefficienti, error) {
	parametrico, err := CaricaParametricoAttivo(ctx, pool)
	if err != nil {
		return istruttoria.Fabbisogno{}, istruttoria.Coefficienti{}, err
	}

	anniAttivita, primaStagione, err := caricaContestoAnteprima(ctx, pool, dati.AssociazioneID, dati.StagioneID)
	if err != nil {
		return istruttoria.Fabbisogno{}, istruttoria.Coefficienti{}, err
	}

	fd, err := decimalDaTesto(dati.FDMinuti)
	if err != nil {
		return istruttoria.Fabbisogno{}, istruttoria.Coefficienti{}, err
	}

	return istruttoria.Calcola(istruttoria.DatiDomanda{
		ClasseAttivitaCodice:  dati.ClasseAttivitaCodice,
		LivelloCampionato:     dati.LivelloCampionato,
		NumeroSquadreFederali: dati.NumeroSquadreFederali,
		AnniAttivita:          anniAttivita,
		PrimaStagione:         primaStagione,
		FDMinuti:              fd,
	}, parametrico.Istruttoria)
}
```

- [ ] **Step 2: Handler HTTP in `engine-go/internal/httpapi/httpapi.go`**

Aggiungi al campo `Server` (dopo `GeneraSeme`):

```go
	AnteprimaFabbisogno func(ctx context.Context, dati AnteprimaFabbisognoRequest) (istruttoria.Fabbisogno, istruttoria.Coefficienti, error)
```

Aggiungi l'import `"github.com/provincia/palestre-engine/internal/istruttoria"` in cima al file (accanto a `gara`/`roundrobin`).

Aggiungi la route in `Routes()`:

```go
	mux.HandleFunc("POST /anteprima-fabbisogno", s.handleAnteprimaFabbisogno)
```

Aggiungi il tipo request e l'handler (dopo `handleRiassegnazioneResidua`, prima di `scriviJSON`):

```go
// AnteprimaFabbisognoRequest è il body JSON del wizard di presentazione domanda —
// primo endpoint del motore che legge un body invece di soli path param.
type AnteprimaFabbisognoRequest struct {
	AssociazioneID        string  `json:"associazione_id"`
	StagioneID            string  `json:"stagione_id"`
	ClasseAttivitaCodice  string  `json:"classe_attivita_codice"`
	LivelloCampionato     *string `json:"livello_campionato"`
	NumeroSquadreFederali int     `json:"numero_squadre_federali"`
	FDMinuti              string  `json:"fd_minuti"`
}

func (s *Server) handleAnteprimaFabbisogno(w http.ResponseWriter, r *http.Request) {
	var req AnteprimaFabbisognoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		scriviJSON(w, http.StatusBadRequest, map[string]any{"errore": "corpo della richiesta non valido: " + err.Error()})
		return
	}

	fabbisogno, coeff, err := s.AnteprimaFabbisogno(r.Context(), req)
	if err != nil {
		scriviErrore(w, err)
		return
	}

	scriviJSON(w, http.StatusOK, map[string]any{
		"peso_base":           fabbisogno.PesoBase,
		"incremento_squadre":  fabbisogno.IncrementoSquadre,
		"fr_calcolato_minuti": fabbisogno.FRCalcolato.String(),
		"fr_finale_minuti":    fabbisogno.FRFinale.String(),
		"crs":                 coeff.CRS.String(),
		"caa":                 coeff.CAA.String(),
		"csd":                 coeff.CSD.String(),
		"cp":                  coeff.CP.String(),
	})
}
```

- [ ] **Step 3: Wiring in `engine-go/cmd/service/main.go`**

Aggiungi al literal `&httpapi.Server{...}` (dopo `EseguiRiassegnazioneResidua`):

```go
		AnteprimaFabbisogno: func(ctx context.Context, dati httpapi.AnteprimaFabbisognoRequest) (istruttoria.Fabbisogno, istruttoria.Coefficienti, error) {
			return postgres.CaricaAnteprimaFabbisogno(ctx, pool, postgres.DatiAnteprimaFabbisogno{
				AssociazioneID:        dati.AssociazioneID,
				StagioneID:            dati.StagioneID,
				ClasseAttivitaCodice:  dati.ClasseAttivitaCodice,
				LivelloCampionato:     dati.LivelloCampionato,
				NumeroSquadreFederali: dati.NumeroSquadreFederali,
				FDMinuti:              dati.FDMinuti,
			})
		},
```

Aggiungi l'import `"github.com/provincia/palestre-engine/internal/istruttoria"` in cima al file.

- [ ] **Step 4: Test unitario `CaricaAnteprimaFabbisogno` (Postgres reale)**

Nel file di test di `istruttoria.go` in `internal/postgres` (verifica il nome esatto: cerca il file che testa `EseguiIstruttoria`, es. `istruttoria_test.go`), aggiungi un test che: crea una stagione+associazione di test (con `data_costituzione` valorizzata), chiama `CaricaAnteprimaFabbisogno` con una classe/numero squadre/FD noti, verifica che `FRFinale`/`PesoBase` combacino col calcolo atteso a mano (stesso pattern di verifica già usato nei test esistenti di `EseguiIstruttoria` — leggili prima di scrivere il nuovo test). Aggiungi anche un caso "prima stagione" (nessuna domanda ammessa precedente per l'associazione): verifica `PrimaStagione=true`/`CAA=CAANeutro` implicito nel risultato (coefficiente CAA torna il valore neutro del parametrico attivo).

- [ ] **Step 5: Test HTTP handler (`httpapi_test.go`, mock — nessun Postgres)**

Segui lo stesso pattern di `TestIstruttoria_Successo` (dependency iniettata come funzione fittizia, nessun DB reale):

```go
func TestAnteprimaFabbisogno_Successo(t *testing.T) {
	var richiestaRicevuta AnteprimaFabbisognoRequest
	s := &Server{
		AnteprimaFabbisogno: func(ctx context.Context, dati AnteprimaFabbisognoRequest) (istruttoria.Fabbisogno, istruttoria.Coefficienti, error) {
			richiestaRicevuta = dati
			return istruttoria.Fabbisogno{PesoBase: 2, IncrementoSquadre: 1, FRCalcolato: decimal.NewFromInt(180), FRFinale: decimal.NewFromInt(180)},
				istruttoria.Coefficienti{CRS: decimal.NewFromFloat(1.1), CAA: decimal.NewFromInt(1), CSD: decimal.NewFromInt(1), CP: decimal.NewFromFloat(1.1)},
				nil
		},
	}

	corpo := `{"associazione_id":"ass-1","stagione_id":"stag-1","classe_attivita_codice":"B","numero_squadre_federali":3,"fd_minuti":"200"}`
	req := httptest.NewRequest(http.MethodPost, "/anteprima-fabbisogno", strings.NewReader(corpo))
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200, body: %s", rec.Code, rec.Body.String())
	}
	if richiestaRicevuta.AssociazioneID != "ass-1" || richiestaRicevuta.ClasseAttivitaCodice != "B" {
		t.Errorf("richiesta non deserializzata correttamente: %+v", richiestaRicevuta)
	}

	var body struct {
		FRFinaleMinuti string `json:"fr_finale_minuti"`
		CRS            string `json:"crs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal risposta: %v", err)
	}
	if body.FRFinaleMinuti != "180" {
		t.Errorf("fr_finale_minuti = %s, atteso 180", body.FRFinaleMinuti)
	}
}

func TestAnteprimaFabbisogno_CorpoMalformato(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/anteprima-fabbisogno", strings.NewReader("{non è json"))
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, atteso 400", rec.Code)
	}
}
```

Aggiungi l'import `"github.com/provincia/palestre-engine/internal/istruttoria"` e `"github.com/shopspring/decimal"` in cima al file di test se non già presenti.

- [ ] **Step 6: Esegui i test**

Run: `cd engine-go && go test ./...`
Expected: PASS (verifica sia i test nuovi sia che nessun test esistente si sia rotto — il campo nuovo `AnteprimaFabbisogno` su `Server` è opzionale/nullable per gli altri test che non lo settano, come già avviene per `GeneraSeme`).

- [ ] **Step 7: Build + vet + commit**

Run: `cd engine-go && go build ./... && go vet ./... && gofmt -l .` (l'ultimo deve stampare vuoto — nessun file mal formattato)

```bash
git add engine-go/internal/postgres/istruttoria.go engine-go/internal/httpapi/httpapi.go engine-go/internal/httpapi/httpapi_test.go engine-go/cmd/service/main.go engine-go/internal/postgres/istruttoria_test.go
git commit -m "feat(engine-go): aggiunge endpoint stateless POST /anteprima-fabbisogno"
```

---

### Task 2: Backend Node — endpoint di lettura (`/discipline`, `/classi-attivita`, slot)

**Files:**
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/classiAttivita.ts`
- Test: `backend-node/src/classiAttivita.test.ts`
- Test: `backend-node/src/server.pubblico.test.ts` (estensione)

**Interfaces:**
- Produces (usate da Task 4): `GET /discipline` → `Disciplina[]` (riusa `listaDiscipline` esistente, nessuna funzione nuova); `GET /classi-attivita` → `ClasseAttivita[]`; `GET /pubblico/stagioni/:id/slot?disciplinaCodice=` → lista slot.

- [ ] **Step 1: `backend-node/src/classiAttivita.ts` (nuovo)**

```typescript
import type { Db } from './db.ts';

export interface ClasseAttivita {
  codice: string;
  descrizione: string;
  pesoBase: number;
}

export async function listaClassiAttivita(db: Db): Promise<ClasseAttivita[]> {
  const r = await db.query<{ codice: string; descrizione: string; peso_base: number }>(
    `SELECT codice, descrizione, peso_base FROM classi_attivita ORDER BY codice`,
  );
  return r.rows.map((row) => ({ codice: row.codice, descrizione: row.descrizione, pesoBase: row.peso_base }));
}
```

- [ ] **Step 2: `classiAttivita.test.ts`**

Stesso pattern di `organismiSportivi.test.ts` (`creaDatabaseDedicato`, verifica che l'elenco seedato — 5 classi A-E, art. A.4 — sia presente e ordinato).

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { listaClassiAttivita } from './classiAttivita.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'listaClassiAttivita restituisce le 5 classi seedate (A-E), ordinate per codice',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const lista = await listaClassiAttivita(pool);
    assert.equal(lista.length, 5);
    assert.deepEqual(lista.map((c) => c.codice), ['A', 'B', 'C', 'D', 'E']);
    assert.equal(lista[0]!.pesoBase, 1);
  },
);
```

- [ ] **Step 3: Rotta `GET /discipline` in `server.ts`**

Subito dopo la rotta `GET /stagioni` esistente, aggiungi (riusa `listaDiscipline`, già importata):

```typescript
  app.get('/discipline', async (_req, res) => {
    try {
      res.status(200).json(await listaDiscipline(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });
```

- [ ] **Step 4: Rotta `GET /classi-attivita`**

Subito dopo, stesso stile:

```typescript
  app.get('/classi-attivita', async (_req, res) => {
    try {
      res.status(200).json(await listaClassiAttivita(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });
```

Aggiungi `import { listaClassiAttivita } from './classiAttivita.ts';` in cima al file.

- [ ] **Step 5: Rotta `GET /pubblico/stagioni/:id/slot`**

Cerca il blocco `// --- Pubblico:` più vicino alle altre rotte `/pubblico/stagioni/:id/...` esistenti (es. vicino a `GET /pubblico/stagioni/:id/settimana-tipo-definitiva`) e aggiungi:

```typescript
  app.get(
    '/pubblico/stagioni/:id/slot',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const disciplinaCodice = typeof req.query.disciplinaCodice === 'string' ? req.query.disciplinaCodice : undefined;
      try {
        const condizioneDisciplina = disciplinaCodice
          ? `AND EXISTS (
               SELECT 1 FROM spazio_disciplina_compatibile sdc
               WHERE sdc.spazio_id = sp.id AND sdc.disciplina_codice = $2
             )`
          : '';
        const parametri = disciplinaCodice ? [stagioneId, disciplinaCodice] : [stagioneId];
        const r = await pool.query(
          `SELECT s.id, i.denominazione AS impianto_denominazione, sp.denominazione AS spazio_denominazione,
                  s.giorno_settimana, s.orario_inizio::text, s.orario_fine::text, s.durata_minuti, s.pregiata
           FROM slot_settimana_tipo s
           JOIN spazi_sportivi sp ON sp.id = s.spazio_id
           JOIN impianti i ON i.id = sp.impianto_id
           WHERE s.stagione_id = $1 AND s.indisponibile_permanente = false
           ${condizioneDisciplina}
           ORDER BY i.denominazione, sp.denominazione, s.giorno_settimana, s.orario_inizio`,
          parametri,
        );
        res.status(200).json(
          r.rows.map((row) => ({
            id: row.id,
            impiantoDenominazione: row.impianto_denominazione,
            spazioDenominazione: row.spazio_denominazione,
            giornoSettimana: row.giorno_settimana,
            orarioInizio: row.orario_inizio,
            orarioFine: row.orario_fine,
            durataMinuti: row.durata_minuti,
            pregiata: row.pregiata,
          })),
        );
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 6: Test — estendi `server.pubblico.test.ts`**

Aggiungi scenari (riusa `creaPersonaFisicaTest`/`creaStagioneTest`/`avviaServerTest` già nel file):
- `GET /discipline`: 200, array (nessuna autenticazione).
- `GET /classi-attivita`: 200, 5 elementi (nessuna autenticazione).
- `GET /pubblico/stagioni/:id/slot`: crea impianto+spazio+slot di test via query dirette (stesso pattern SQL già usato altrove nel file per fixture), verifica che lo slot compaia; senza token → 401; con `?disciplinaCodice=` che non combacia con nessuna disciplina compatibile dello spazio → lista vuota; con `?disciplinaCodice=` che combacia → lo slot compare.

- [ ] **Step 7: Esegui i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione node --test src/classiAttivita.test.ts src/server.pubblico.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

Run: `cd backend-node && pnpm exec tsc`

```bash
git add backend-node/src/classiAttivita.ts backend-node/src/classiAttivita.test.ts backend-node/src/server.ts backend-node/src/server.pubblico.test.ts
git commit -m "feat(backend-node): aggiunge GET /discipline, GET /classi-attivita, GET /pubblico/stagioni/:id/slot"
```

---

### Task 3: Backend Node — proxy `POST /pubblico/domande/anteprima-fabbisogno`

**Files:**
- Modify: `backend-node/src/engine/client.ts`
- Modify: `backend-node/src/pubblicoSchema.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.pubblico.test.ts` (estensione)

**Interfaces:**
- Consumes: `POST /anteprima-fabbisogno` (Task 1, motore Go).
- Produces (usate da Task 5): `POST /pubblico/domande/anteprima-fabbisogno` → `{pesoBase, incrementoSquadre, frCalcolatoMinuti, frFinaleMinuti, crs, caa, csd, cp}`.

- [ ] **Step 1: Estendi `chiamaMotore` per accettare un body opzionale**

In `backend-node/src/engine/client.ts`, sostituisci la firma e il corpo di `chiamaMotore`:

```typescript
async function chiamaMotore(baseUrl: string, timeoutMs: number, path: string, corpo?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      ...(corpo !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ErroreMotoreIrraggiungibile(`motore non raggiungibile: ${baseUrl}${path}`);
  }
  // ... resto invariato (mapping errore non-2xx)
```

(mantieni invariato il resto della funzione — solo la firma e la chiamata `fetch` cambiano; i 4 call site esistenti in `creaClientMotore` non passano `corpo`, restano compatibili senza modifiche).

- [ ] **Step 2: Aggiungi `anteprimaFabbisogno` a `ClientMotore`**

In `backend-node/src/engine/client.ts`, aggiungi all'interfaccia:

```typescript
export interface DatiAnteprimaFabbisogno {
  associazioneId: string;
  stagioneId: string;
  classeAttivitaCodice: string;
  livelloCampionato?: string | undefined;
  numeroSquadreFederali: number;
  fdMinuti: string;
}

export interface RisultatoAnteprimaFabbisogno {
  pesoBase: number;
  incrementoSquadre: number;
  frCalcolatoMinuti: string;
  frFinaleMinuti: string;
  crs: string;
  caa: string;
  csd: string;
  cp: string;
}
```

Aggiungi `anteprimaFabbisogno(dati: DatiAnteprimaFabbisogno): Promise<RisultatoAnteprimaFabbisogno>;` a `ClientMotore`, e l'implementazione in `creaClientMotore`:

```typescript
    async anteprimaFabbisogno(dati) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, '/anteprima-fabbisogno', {
        associazione_id: dati.associazioneId,
        stagione_id: dati.stagioneId,
        classe_attivita_codice: dati.classeAttivitaCodice,
        livello_campionato: dati.livelloCampionato ?? null,
        numero_squadre_federali: dati.numeroSquadreFederali,
        fd_minuti: dati.fdMinuti,
      })) as {
        peso_base: number;
        incremento_squadre: number;
        fr_calcolato_minuti: string;
        fr_finale_minuti: string;
        crs: string;
        caa: string;
        csd: string;
        cp: string;
      };
      return {
        pesoBase: body.peso_base,
        incrementoSquadre: body.incremento_squadre,
        frCalcolatoMinuti: body.fr_calcolato_minuti,
        frFinaleMinuti: body.fr_finale_minuti,
        crs: body.crs,
        caa: body.caa,
        csd: body.csd,
        cp: body.cp,
      };
    },
```

- [ ] **Step 3: Schema zod in `pubblicoSchema.ts`**

Aggiungi (vicino a `schemaCreaDomanda`, riusa `REGEX_MINUTI` già definita nel file):

```typescript
export const schemaAnteprimaFabbisogno = z.object({
  associazioneId: z.string().uuid(),
  stagioneId: z.string().uuid(),
  classeAttivitaCodice: z.string().min(1),
  livelloCampionato: z.enum(['provinciale', 'regionale', 'interregionale', 'nazionale']).optional(),
  numeroSquadreFederali: z.number().int().min(0),
  fdMinuti: z.string().regex(REGEX_MINUTI),
});
export type AnteprimaFabbisognoRequest = z.infer<typeof schemaAnteprimaFabbisogno>;
```

- [ ] **Step 4: Rotta `POST /pubblico/domande/anteprima-fabbisogno`**

Vicino alla rotta `POST /pubblico/domande` esistente in `server.ts`, aggiungi (stesso pattern `if (!clientMotore)` già usato dalle altre 4 rotte motore, nessun lock — è un'operazione di sola lettura non scoped a una stagione intera):

```typescript
  app.post(
    '/pubblico/domande/anteprima-fabbisogno',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      if (!clientMotore) {
        res.status(503).json({ errore: 'motore di calcolo non configurato' });
        return;
      }
      const parsed = schemaAnteprimaFabbisogno.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const risultato = await clientMotore.anteprimaFabbisogno(parsed.data);
        res.status(200).json(risultato);
      } catch (err) {
        if (err instanceof ErroreMotoreIrraggiungibile) {
          res.status(502).json({ errore: 'motore di calcolo non raggiungibile' });
          return;
        }
        if (err instanceof ErroreMotoreDominio) {
          res.status(400).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

Aggiungi `schemaAnteprimaFabbisogno` all'import esistente da `./pubblicoSchema.ts`.

- [ ] **Step 5: Test — estendi `server.pubblico.test.ts`**

Segui il pattern già in uso per le altre rotte motore (`clientMotore` fittizio iniettato via `DipendenzeApp`, MAI un mock di `fetch`):
- Con `clientMotore` fittizio che risponde un risultato noto: 200, corpo combacia.
- Senza `clientMotore` (nessun `ENGINE_URL`): 503.
- Body non valido (es. `fdMinuti` non numerico): 400.
- `clientMotore.anteprimaFabbisogno` che lancia `ErroreMotoreIrraggiungibile`: 502.

- [ ] **Step 6: Esegui i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione node --test src/server.pubblico.test.ts src/engine/client.test.ts` (se `engine/client.test.ts` non esiste, verifica come sono testate le altre 4 funzioni di `creaClientMotore` — probabilmente solo indirettamente via `server.pubblico.test.ts`/altri test delle rotte motore, in tal caso questo file non serve).
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `cd backend-node && pnpm exec tsc`

```bash
git add backend-node/src/engine/client.ts backend-node/src/pubblicoSchema.ts backend-node/src/server.ts backend-node/src/server.pubblico.test.ts
git commit -m "feat(backend-node): POST /pubblico/domande/anteprima-fabbisogno, proxy verso il motore Go"
```

---

### Task 4: Frontend — livello API

**Files:**
- Create: `frontend-pubblico/src/api/discipline.ts`
- Create: `frontend-pubblico/src/api/classiAttivita.ts`
- Create: `frontend-pubblico/src/api/slot.ts`
- Create: `frontend-pubblico/src/api/domande.ts`
- Test: `frontend-pubblico/src/api/discipline.test.ts`
- Test: `frontend-pubblico/src/api/classiAttivita.test.ts`
- Test: `frontend-pubblico/src/api/slot.test.ts`
- Test: `frontend-pubblico/src/api/domande.test.ts`

**Interfaces:**
- Produces (usate da Task 5): `listaDiscipline()`, `listaClassiAttivita()`, `listaSlot(stagioneId, disciplinaCodice?)`, `creaDomanda(dati)`, `listaDomandePerAssociazione(associazioneId)`, `anteprimaFabbisogno(dati)`.

- [ ] **Step 1: `src/api/discipline.ts`**

```typescript
import { richiedi } from './client.ts';

export interface Disciplina {
  codice: string;
  denominazione: string;
}

export function listaDiscipline(): Promise<Disciplina[]> {
  return richiedi('/discipline');
}
```

- [ ] **Step 2: `src/api/classiAttivita.ts`**

```typescript
import { richiedi } from './client.ts';

export interface ClasseAttivita {
  codice: string;
  descrizione: string;
  pesoBase: number;
}

export function listaClassiAttivita(): Promise<ClasseAttivita[]> {
  return richiedi('/classi-attivita');
}
```

- [ ] **Step 3: `src/api/slot.ts`**

```typescript
import { richiedi } from './client.ts';

export interface SlotDisponibile {
  id: string;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

export function listaSlot(stagioneId: string, disciplinaCodice?: string): Promise<SlotDisponibile[]> {
  const query = disciplinaCodice ? `?disciplinaCodice=${encodeURIComponent(disciplinaCodice)}` : '';
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/slot${query}`);
}
```

- [ ] **Step 4: `src/api/domande.ts`**

```typescript
import { richiedi } from './client.ts';

export interface RichiestaGiornataGara {
  federazione: string;
  campionato: string;
  categoria: string;
  requisitiTecnici?: string | undefined;
  necessitaImpiantoOmologato: boolean;
}

export type LivelloCampionato = 'provinciale' | 'regionale' | 'interregionale' | 'nazionale';

export interface DatiCreaDomanda {
  associazioneId: string;
  stagioneId: string;
  disciplineCodici: string[];
  classeAttivitaCodice?: string | undefined;
  livelloCampionato?: LivelloCampionato | undefined;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  numeroSquadreFederaliStagionePrecedente: number;
  attivitaGiovanile: boolean;
  attivitaAgonistica: boolean;
  attivitaParalimpicaInclusiva: boolean;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
  preferenze: string[];
  blocchiAllenamento: string[][];
  richiedeGiornataGara: boolean;
  richiesteGiornataGara: RichiestaGiornataGara[];
}

export interface Domanda {
  id: string;
  numeroProtocollo: string;
  associazioneId: string;
  stagioneId: string;
  stato: 'presentata' | 'ammessa' | 'esclusa';
  presentataIl: string;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
}

export function creaDomanda(dati: DatiCreaDomanda): Promise<Domanda> {
  return richiedi('/pubblico/domande', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

export function listaDomandePerAssociazione(associazioneId: string): Promise<Domanda[]> {
  return richiedi(`/pubblico/associazioni/${encodeURIComponent(associazioneId)}/domande`);
}

export interface DatiAnteprimaFabbisogno {
  associazioneId: string;
  stagioneId: string;
  classeAttivitaCodice: string;
  livelloCampionato?: LivelloCampionato | undefined;
  numeroSquadreFederali: number;
  fdMinuti: string;
}

export interface AnteprimaFabbisogno {
  pesoBase: number;
  incrementoSquadre: number;
  frCalcolatoMinuti: string;
  frFinaleMinuti: string;
  crs: string;
  caa: string;
  csd: string;
  cp: string;
}

export function anteprimaFabbisogno(dati: DatiAnteprimaFabbisogno): Promise<AnteprimaFabbisogno> {
  return richiedi('/pubblico/domande/anteprima-fabbisogno', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}
```

L'implementatore verifichi il campo `Domanda`/`domande.ts` (backend) esatto per `numeroTesserati`/ecc. prima di finalizzare — leggi `backend-node/src/domande.ts`'s `Domanda` interface come fonte di verità, l'elenco sopra è indicativo dei campi principali usati dal wizard, non necessariamente esaustivo di tutti quelli che il backend restituisce (campi aggiuntivi non usati dal frontend possono essere omessi dal tipo TS senza errore, `richiedi<T>` non valida la forma a runtime).

- [ ] **Step 5: Test dei 4 nuovi file**

Stesso pattern già stabilito (`avviaBackendReale`/`creaPersonaTest`, real backend, no mock):
- `discipline.test.ts`/`classiAttivita.test.ts`: nessuna autenticazione richiesta, verifica elenco non vuoto (stesso stile di `stagioni.test.ts`/`organismiSportivi.test.ts`).
- `slot.test.ts`: richiede un token (usa `creaPersonaTest`), verifica che senza dati non vada in errore (array vuoto va bene, il test non ha bisogno di creare slot reali — quello è coperto dal test backend Task 2; qui basta verificare che la chiamata funzioni end-to-end).
- `domande.test.ts`: `creaDomanda` con fixture minime (richiede una stagione+associazione di test — stesso pattern `creaStagioneTest` già usato in `associazioni.test.ts`/`deleghe.test.ts`, e un'associazione creata via `creaAssociazione` — reindirizza al corpo completo richiesto da quell'endpoint, vedi blocco precedente), verifica 201 e che `numeroProtocollo` sia presente; `listaDomandePerAssociazione` dopo la creazione la trova; `anteprimaFabbisogno` con un `clientMotore` — **nota**: questo test chiama il vero motore Go, che deve essere raggiungibile (verifica se l'ambiente di test ha `ENGINE_URL` impostata; se non c'è un motore Go in esecuzione nell'ambiente di test di questo pacchetto, questo scenario specifico va marcato `skip` con lo stesso pattern `{skip: ... ? false : 'motivo'}` già in uso, condizionato su una env var che segnali la disponibilità del motore — verifica come i test backend che usano `clientMotore` reale (se esistono) gestiscono questo, altrimenti testa `anteprimaFabbisogno` solo per la forma della richiesta/errore 400/503, non per un 200 con motore reale).

- [ ] **Step 6: Esegui i test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/api/discipline.ts frontend-pubblico/src/api/classiAttivita.ts frontend-pubblico/src/api/slot.ts frontend-pubblico/src/api/domande.ts frontend-pubblico/src/api/discipline.test.ts frontend-pubblico/src/api/classiAttivita.test.ts frontend-pubblico/src/api/slot.test.ts frontend-pubblico/src/api/domande.test.ts
git commit -m "feat(frontend-pubblico): aggiunge livello API discipline/classi-attivita/slot/domande"
```

---

### Task 5: Frontend — `WizardDomandaView` riscritta sui campi reali

**Files:**
- Modify: `frontend-pubblico/src/components/WizardDomandaView.tsx` (riscrittura sostanziale)
- Modify: `frontend-pubblico/src/types.ts`
- Modify: `frontend-pubblico/src/App.tsx`
- Test: `frontend-pubblico/src/components/WizardDomandaView.test.tsx` (nuovo)

**Interfaces:**
- Consumes: tutto il livello API del Task 4, `EntitaRappresentata`/`AuthContext` (blocchi precedenti).
- Produces: `WizardDomandaView` con props `{ entities: EntitaRappresentata[]; stagioneId: string | null }` (nessun `onRicarica` necessario — una domanda presentata non richiede refresh di `entities`, a differenza dell'accreditamento).

- [ ] **Step 1: Rimuovi `ApplicationWizardState` da `types.ts`**

Verifica prima (grep) che nessun altro file la importi oltre a `WizardDomandaView.tsx` (che questo task riscrive) — stesso giudizio già applicato per `RepresentedEntity` nel blocco precedente.

- [ ] **Step 2: Riscrivi `WizardDomandaView.tsx`**

Struttura a 4 step (stesso stepper visivo del mock, `currentStep` state), con questi campi per step — segui lo stile di form già stabilito nel progetto (`form-group`/`form-label`/`form-control`, griglie 2 colonne per campi corti, pattern già visto in `AccreditamentoDelegaView.tsx`):

**Step 1 — Dati Attività & Squadre:**
- Multi-select discipline (checkbox list o `<select multiple>`, tua scelta — deve produrre `string[]` di codici), popolato da `listaDiscipline()` al mount.
- Select classe attività, popolato da `listaClassiAttivita()` al mount, opzioni `{c.codice} — {c.descrizione} (Peso Base: {c.pesoBase})`.
- Select livello campionato (opzionale, 4 valori `LivelloCampionato`) — mostralo sempre (non condizionalmente, lo schema lo rende opzionale per ogni classe, non solo C nonostante quanto suggerisce un vecchio commento nel mock).
- Input numero tesserati, numero atleti partecipanti, numero squadre, numero squadre federali stagione precedente (tutti `type="number" min="0"`).
- 3 checkbox: attività giovanile, attività agonistica, attività paralimpica/inclusiva.

**Step 2 — Fabbisogno:**
- Input FD minimo/ottimale minuti (stesso stile del mock).
- Anteprima FR: bottone esplicito "Calcola Anteprima" (non live-su-ogni-keystroke, per non spammare il motore Go ad ogni digitazione — chiama `anteprimaFabbisogno` con `associazioneId` dell'entità attiva, `stagioneId`, i campi già raccolti allo step 1-2) che mostra il risultato (`frFinaleMinuti` in evidenza, resto dei coefficienti in piccolo) o un errore leggibile (`ErroreRichiestaApi`, incluso il caso 503 "motore non configurato" con un messaggio comprensibile). Etichetta chiara: "Anteprima — il valore definitivo sarà confermato dalla Provincia in fase di istruttoria".

**Step 3 — Blocchi Gara:**
- Checkbox "Richiedi blocco/i giornata gara" (`richiedeGiornataGara`).
- Se attivo: lista di richieste aggiungibili/rimovibili, ognuna con `federazione`/`campionato`/`categoria`/`requisitiTecnici` (opzionale)/`necessitaImpiantoOmologato` (checkbox, default `true`) — bottone "Aggiungi richiesta giornata gara", ogni riga ha un bottone "Rimuovi". Almeno una richiesta obbligatoria se il checkbox principale è attivo (blocca l'avanzamento allo step successivo con un messaggio, mirror della regola zod `richiedeGiornataGara ⇒ richiesteGiornataGara.length > 0`).

**Step 4 — Preferenze & Blocchi Allenamento:**
- Carica `listaSlot(stagioneId, disciplinaCodice)` per la PRIMA disciplina selezionata allo step 1 (se le discipline sono più di una, mostra un selettore per scegliere quale disciplina usare per filtrare la lista — non serve unire i risultati di più chiamate per la prima versione di questa view).
- Lista slot con checkbox "aggiungi a preferenze" — gli slot selezionati appaiono in una lista ordinata separata (drag-and-drop opzionale, va bene anche una coppia di bottoni su/giù per riordinare, più semplice da implementare e testare).
- Tra gli slot già in preferenza, un meccanismo per selezionarne un sottoinsieme (minimo 2) e "raggruppali in un blocco allenamento" — produce un elemento di `blocchiAllenamento: string[][]`, con la possibilità di rimuovere un blocco già creato (torna alla lista preferenze non raggruppata, non sparisce dalle preferenze).

**Guardia "già presentata"** (prima di renderizzare il wizard): `useEffect` al mount che chiama `listaDomandePerAssociazione(activeEntity.associazioneId)` (l'entità attiva va passata come prop o letta da un hook — verifica come `AccreditamentoDelegaView`/`App.tsx` gestiscono l'entità attiva oggi e riusa lo stesso meccanismo, non introdurne uno nuovo) filtrata per `stagioneId` corrente; se esiste già una domanda, mostra un riepilogo di sola lettura (numero protocollo, stato, fabbisogno dichiarato) invece del wizard.

Submit finale (step 4, sostituisce l'`alert()` del mock): `creaDomanda(dati)` con tutti i campi raccolti, gestione errore (`ErroreRichiestaApi`) con messaggio visibile, su successo mostra la stessa vista di sola lettura "già presentata" sopra (nessun redirect necessario, resta sulla stessa view).

- [ ] **Step 3: Aggiorna `App.tsx`**

Sostituisci `{activeTab === 'domanda-wizard' && <WizardDomandaView />}` con `{activeTab === 'domanda-wizard' && <WizardDomandaView entities={entities} stagioneId={stagioneId} />}` (stessi state già presenti in `AppAutenticata` per l'altro blocco).

- [ ] **Step 4: `WizardDomandaView.test.tsx`**

Mock di tutte le funzioni `api/*` coinvolte (`vi.spyOn`), copertura minima:
- Nessuna domanda esistente → mostra il wizard, step 1 di default.
- Domanda già esistente per l'associazione/stagione → mostra il riepilogo, non il wizard.
- Navigazione tra i 4 step (avanti/indietro).
- Step 3: checkbox "richiedi giornata gara" senza nessuna richiesta aggiunta → blocca l'avanzamento con messaggio; con almeno una richiesta → avanza.
- Step 4: selezione di 2+ slot raggruppati in un blocco → il submit finale chiama `creaDomanda` con `blocchiAllenamento` contenente quel gruppo.
- Anteprima FR: bottone "Calcola Anteprima" chiama `anteprimaFabbisogno` con i campi correnti, mostra il risultato; se la chiamata fallisce (mock `mockRejectedValue`), mostra un errore leggibile invece di un crash.
- Submit finale riuscito: chiama `creaDomanda` con il payload atteso (denominazione dei campi esatta), poi mostra il riepilogo di sola lettura.

- [ ] **Step 5: Esegui i test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS, incluso l'intero pacchetto (verifica che il rewiring in `App.tsx`/`types.ts` non abbia rotto nulla).

- [ ] **Step 6: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/components/WizardDomandaView.tsx frontend-pubblico/src/types.ts frontend-pubblico/src/App.tsx frontend-pubblico/src/components/WizardDomandaView.test.tsx
git commit -m "feat(frontend-pubblico): WizardDomandaView collegata alle API reali (motore Go incluso per l'anteprima fabbisogno)"
```

---

### Task 6: Smoke test end-to-end + aggiornamento documentazione

**Files:**
- Test: `frontend-pubblico/src/App.domanda.realBackend.test.tsx`
- Modify: `CLAUDE.md`
- Modify: `docs/claude/backend-node.md`
- Modify: `docs/claude/motore-go.md`

**Interfaces:** nessuna nuova.

- [ ] **Step 1: Smoke test end-to-end**

Stesso pattern già stabilito (`App.accreditamento.realBackend.test.tsx` del blocco precedente): crea una persona di test, un'associazione (via API reale, stesso corpo completo richiesto oggi), una stagione, uno spazio/impianto/slot minimo per popolare lo step 4, presenta una domanda reale attraverso l'intera UI (`userEvent`), verifica che al remount la view mostri lo stato "già presentata" con lo stesso `numeroProtocollo`. **Nota**: questo test NON richiede il motore Go reale (l'anteprima FR è opzionale/non bloccante per il submit finale — se il motore non è configurato nell'ambiente di test, lo step 2 si limita a non mostrare l'anteprima, il submit di `POST /pubblico/domande` allo step 4 non dipende dal motore).

- [ ] **Step 2: Esegui il test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS.

- [ ] **Step 3: Aggiorna documentazione**

`CLAUDE.md`: aggiorna il paragrafo di stato (WizardDomandaView collegata, resta solo 3 view mock: EsitiIsfView/ConcertazioneView/CalendarioDefinitivoView).
`docs/claude/backend-node.md`: nuova voce "Fatto —" per questo blocco (4 nuovi endpoint Node, endpoint motore Go, pattern riusabile "anteprima" — nessuna scrittura, nessun lock, per esporre un calcolo esistente senza duplicarlo).
`docs/claude/motore-go.md`: documenta il nuovo endpoint `POST /anteprima-fabbisogno` accanto agli altri 4 (stesso stile delle voci esistenti in quel file).

- [ ] **Step 4: Commit**

```bash
git add frontend-pubblico/src/App.domanda.realBackend.test.tsx CLAUDE.md docs/claude/backend-node.md docs/claude/motore-go.md
git commit -m "test(frontend-pubblico): smoke test end-to-end presentazione domanda; aggiorna documentazione"
```
