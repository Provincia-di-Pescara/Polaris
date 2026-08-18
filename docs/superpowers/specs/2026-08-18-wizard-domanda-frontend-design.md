# WizardDomandaView: collegamento API reali — Design

## Contesto

`WizardDomandaView` (frontend pubblico) è ancora su mock: 4 step con campi finti (`ApplicationWizardState`) che non corrispondono al vero schema `POST /pubblico/domande` (`schemaCreaDomanda`, backend già completo — blocco 2/4 del flusso pubblico, chiuso da tempo). Questo blocco collega la view al backend reale.

Vincolo di dominio: `domande_associazione_stagione_uq` — una sola domanda per associazione per stagione, mai modificabile dopo la presentazione (nessun endpoint PUT/PATCH esiste). Il wizard è quindi un flusso "compila una volta, invia, poi sola lettura" — se una domanda esiste già per l'associazione/stagione corrente, la view mostra lo stato invece del form.

## Gap reali trovati durante l'analisi

- **Campi del mock non corrispondono allo schema reale**: il mock ha `bloccoGaraGiorno`/`bloccoGaraImpiantoId` (giorno+impianto) mentre il vero `richiesteGiornataGara` (array) ha campi completamente diversi — `federazione`/`campionato`/`categoria`/`requisitiTecnici`(opz.)/`necessitaImpiantoOmologato` (art. B.12-15, richiesta di riconoscimento di una giornata gara per una federazione/categoria specifica, non prenotazione diretta di un giorno/impianto). Il mock manca completamente di `disciplineCodici`, `numeroTesserati`, `numeroAtletiPartecipanti`, `numeroSquadre`, `numeroSquadreFederaliStagionePrecedente`, i tre flag attività (giovanile/agonistica/paralimpica), `livelloCampionato`.
- **`preferenze`/`blocchiAllenamento` sono UUID di slot reali** (`slot_settimana_tipo.id`), non stringhe libere come nel mock ("Palestra Liceo Galilei..."). Serve un vero selettore di slot — nessun endpoint pubblico li elenca oggi.
- **Nessun endpoint pubblico per discipline/classi di attività**: il form deve popolare due select (discipline multi-select, classe attività A-E) da dati reali (`discipline_sportive`, `classi_attivita`), oggi leggibili solo da rotte `backoffice`-scoped.
- **L'anteprima FR live del mock duplicava la formula in TS** (`peso*60`), violando il vincolo esplicito del progetto ("Riusa le regole di business del motore Go via RPC — non duplicare logica di calcolo in Node", `CLAUDE.md`). Il vero FR non è nemmeno salvato su `domande` — è calcolato dal motore Go in fase di istruttoria (fase successiva alla presentazione) via `istruttoria.Calcola` (funzione pura già esistente e testata in `engine-go/internal/istruttoria/istruttoria.go`).

## Architettura

### Motore Go — nuovo endpoint stateless `POST /anteprima-fabbisogno`

Espone `istruttoria.Calcola` (esistente, puro, nessuna scrittura) via HTTP, per un'anteprima FR/coefficienti live e sempre allineata alla versione parametrico attiva — chiude il gap sopra senza duplicare la formula in Node/TS.

- **Request**: `{classeAttivitaCodice, livelloCampionato?, numeroSquadreFederali, fdMinuti, associazioneId}`.
- **`primaStagione`/`anniAttivita`** (richiesti da `DatiDomanda` ma non forniti dal form): determinati server-side dall'handler leggendo lo storico domande/abilitazioni dell'`associazioneId` (stessa logica già usata per popolare `DatiDomanda` nella vera istruttoria — riusare la query esistente in `internal/postgres`, non reinventarla; se la query vive oggi solo lato Node/orchestrazione, va replicata in Go per questo endpoint, verificare in fase di piano dove esattamente vive oggi).
- **Response**: `Fabbisogno` (`pesoBase`, `incrementoSquadre`, `frCalcolato`, `frFinale`) + `Coefficienti` (`crs`, `caa`, `csd`, `cp`) — stessa struct già restituita da `istruttoria.Calcola`, serializzata JSON.
- Nessun lock, nessuna scrittura, nessuno stato — sicuro da chiamare ripetutamente mentre l'utente compila il form (debounce lato frontend per non spammare il motore ad ogni keystroke).
- Registrato in `Server.Routes()` (`engine-go/internal/httpapi/httpapi.go`) accanto agli altri 4 endpoint, stesso stile (`mux.HandleFunc`, dipendenza iniettata in `Server` struct, wiring in `cmd/service/main.go`).

### Backend Node — 4 nuovi endpoint pubblici

- `GET /discipline` (pubblico, non autenticato, stesso livello di `GET /stagioni`): lista `{codice, denominazione}` da `discipline_sportive`.
- `GET /classi-attivita` (pubblico, non autenticato): lista `{codice, descrizione, pesoBase}` da `classi_attivita` — `pesoBase` esposto solo per trasparenza informativa (non usato per calcoli lato frontend, quello resta esclusivamente al motore Go).
- `GET /pubblico/stagioni/:id/slot` (`richiedeAutenticazionePubblico`, filtro opzionale `?disciplinaCodice=`): lista slot della stagione, filtrati per compatibilità disciplina se il parametro è presente (join `spazio_disciplina_compatibile`), esclusi `indisponibile_permanente`. Ogni riga: `{id, impiantoDenominazione, spazioDenominazione, giornoSettimana, orarioInizio, orarioFine, durataMinuti, pregiata}` — sufficiente per il selettore preferenze/blocchi, senza esporre dati sensibili (è la griglia di disponibilità, già pubblica per costruzione).
- `POST /pubblico/domande/anteprima-fabbisogno` (`richiedeAutenticazionePubblico`): valida il body con un nuovo schema zod leggero, proxa verso il motore Go (estensione di `engine/client.ts`, che oggi supporta solo POST-senza-body — va esteso per accettare un body JSON e restituire il payload parsato, non solo un conteggio), rilancia `ErroreMotoreIrraggiungibile`/`ErroreMotoreDominio` con lo stesso mapping HTTP già in uso per le altre rotte motore (502/500).

### Frontend — `WizardDomandaView` riscritta sui campi reali

- **Step 1 (Dati Attività)**: discipline multi-select (da `GET /discipline`), classe attività select (da `GET /classi-attivita`), livello campionato (select condizionale, solo se rilevante), numero tesserati/atleti/squadre/squadre federali stagione precedente, tre checkbox attività.
- **Step 2 (Fabbisogno)**: FD minimo/ottimale (minuti), anteprima FR live da `POST /pubblico/domande/anteprima-fabbisogno` (debounced, richiede `associazioneId` dell'entità attiva + i campi già compilati allo step 1) — mostra FR calcolato/finale come nel mock ma con dati reali, marcata chiaramente come "anteprima, il valore definitivo sarà confermato in istruttoria".
- **Step 3 (Blocchi Gara)**: `richiedeGiornataGara` (checkbox) sblocca una lista di richieste aggiungibili/rimovibili (`federazione`/`campionato`/`categoria`/`requisitiTecnici` opzionale/`necessitaImpiantoOmologato`), non un singolo blocco fisso come nel mock.
- **Step 4 (Preferenze & Blocchi Allenamento)**: selettore slot reale (da `GET /pubblico/stagioni/:id/slot`, filtrato per le discipline scelte allo step 1) — l'utente costruisce una lista ordinata di preferenze (drag o pulsanti su/giù) e può raggruppare un sottoinsieme di slot già in preferenza in uno o più "blocchi allenamento" (minimo 2 slot per blocco, vincolo già presente nello schema zod: `z.array(z.array(z.string().uuid()).min(2))`).
- **Guardia "già presentata"**: al mount, verifica se esiste già una domanda per l'associazione/stagione attiva (`GET /pubblico/associazioni/:associazioneId/domande`, endpoint già esistente) — se sì, la view mostra un riepilogo di sola lettura (numero protocollo, stato, dati principali) invece del wizard.
- Submit: `POST /pubblico/domande` (schema/endpoint già esistenti, nessuna modifica lato route — solo il frontend cambia).

## Testing

- Go: `istruttoria_test.go`/`httpapi` — nuovo test per l'handler `anteprima-fabbisogno` (200 con parametrico reale, 400 su classe inesistente, verifica che risponda senza toccare `domande`/`fabbisogni_riconosciuti`).
- Node: nuovi endpoint testati contro Postgres reale (`discipline.test.ts` o simile, `classiAttivita.test.ts`, estensione `server.pubblico.test.ts` per slot + anteprima-fabbisogno, con `clientMotore` fittizio iniettato come già fatto per le altre rotte motore).
- Frontend: `WizardDomandaView.test.tsx` (mock api, tutti gli step, selettore slot, blocchi gara multipli), un `.realBackend.test.tsx` end-to-end (pattern già stabilito: crea persona+associazione di test, compila e presenta una domanda reale, verifica che appaia come "già presentata" al remount).

## Fuori scope

- Modifica dei campi/route esistenti di `POST /pubblico/domande` — restano invariati, solo il frontend collegato.
- Editing di una domanda già presentata (non esiste nel backend, non lo aggiungiamo qui — nessun articolo lo prevede).
- `EsitiIsfView`, `ConcertazioneView`, `CalendarioDefinitivoView` — restano mock, blocchi futuri.
