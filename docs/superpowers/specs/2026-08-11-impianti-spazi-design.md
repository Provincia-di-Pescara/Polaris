# Backoffice — Impianti & Spazi Sportivi, collegamento API reali — design

**Data**: 2026-08-11

## Obiettivo

Collegare `frontend-backoffice/src/components/ImpiantiSpaziView.tsx` (oggi su `mockData.ts` statico) alle API CRUD reali del backend Node già complete. Sotto-blocco di "UI Fase 5", consuma le fondamenta appena chiuse (auth reale, `apiFetch`, routing) — non le ricostruisce.

## Contesto rilevante del backend

Endpoint disponibili (tutti `richiedeAutenticazione` + `richiedeRuolo('admin','operatore')` salvo dove indicato):

- `POST/GET/PUT /backoffice/discipline` (+`/:codice` per update) — `Disciplina{codice,denominazione}`.
- `POST/GET/GET:id/PUT /backoffice/istituzioni` — `Istituzione{id,denominazione,codiceMeccanografico,indirizzo}`.
- `POST/GET/GET:id/PUT /backoffice/impianti` (GET lista con filtro opzionale `?istituzioneScolasticaId=`) — `Impianto{id,denominazione,istituzioneScolasticaId,indirizzo}`.
- `POST/GET /backoffice/impianti/:impiantoId/spazi`, `GET/PUT /backoffice/spazi/:id` — `SpazioSportivo{id,impiantoId,denominazione,omologazioni,note,disciplineCompatibili}` (join-table, replace-all semantics sulle discipline in update).
- `POST/GET /backoffice/stagioni/:stagioneId/slot` (GET con filtro opzionale `?spazioId=`), `GET/PUT /backoffice/slot/:id` — `Slot{id,stagioneId,spazioId,giornoSettimana:number(1-7),orarioInizio,orarioFine,durataMinuti,pregiata,indisponibilePermanente,note}`.
- `GET /stagioni` (pubblico, nessuna auth richiesta) — `Stagione{id,nome,dataInizio,dataFine,stato}`.

Nessun campo `codice`/`comune`/`copertura`/`fondo`/`spaziCount` su Impianto/Spazio, nessun `moltiplicatore`/`assegnatoA`/`tipoAssegnazione` su Slot, nessun `faseCorrenteNum` su Stagione — questi esistono solo nel mock (`types.ts`), non nel backend. Nessun endpoint backoffice-side espone lo stato di assegnazione di uno slot indipendentemente dalla fase della stagione (verificato: `GET /backoffice/stagioni/:id/elaborazioni` è un riepilogo di esecuzioni, non un dettaglio per-slot; le uniche viste con stato-assegnazione sono `pubblico` e valide solo in specifiche fasi).

## Decisioni di scope

1. **Assegnazioni**: fuori scope. La griglia mostra solo la definizione degli slot (orario, pregiata, indisponibile, note) — nessuno stato di assegnazione, nessun colore "assegnato". Un blocco futuro dedicato (Control Room / elaborazioni) affronterà l'aggiunta di un endpoint dedicato.
2. **Campi non supportati dal backend**: rimossi dalla UI (non tenuti come placeholder statici). Impianti/Spazi mostrano solo `denominazione`/`indirizzo`/`istituzioneScolasticaId` (risolto a nome via lookup istituzioni)/`omologazioni`/`note`/`disciplineCompatibili`. Il badge "Fase X di 16" nell'Header sparisce (nessun campo backend equivalente); resta il badge stato stagione già presente.
3. **Discipline e Istituzioni**: CRUD completo in questo blocco (non solo dropdown di sola lettura) — entrambe le entità di supporto vengono chiuse insieme a Impianti/Spazi/Slot.
4. **Season scoping**: la griglia slot è scoped alla stagione selezionata nell'Header. L'Header/`BackofficeLayout` smette di usare `mockSeasons`, chiama `GET /stagioni` reale (nessuna autenticazione richiesta da quell'endpoint, ma la chiamata passa comunque da `apiFetch` per coerenza — un token assente/scaduto non la blocca).
5. **`giornoSettimana` numerico**: assunzione **1=Lunedì...7=Domenica** (ISO 8601). Nessuna convenzione esplicitamente documentata nello schema DB/codice backend — verificato che nessun test/commento la contraddice. Da confermare con l'Ente se possibile, non bloccante per lo sviluppo (impatto: solo l'etichetta del giorno mostrata in UI, non la logica di dominio).
6. **UX creazione/modifica slot**: form esplicito (giorno, ora inizio/fine, pregiata, indisponibile, note) dietro un bottone "Nuovo slot"; click su uno slot esistente nella griglia apre lo stesso form in modalità modifica (PUT). La griglia resta sola-lettura per la visualizzazione, non click-to-create diretto su cella (il backend supporta orari arbitrari, non fasce fisse).

## Componenti

### `src/api/impiantiSpazi.ts` (nuovo)

Funzioni tipate su `apiFetch`, una per operazione, mapping 1:1 con gli endpoint sopra. Tipi TS che rispecchiano esattamente le interfacce backend (elencate sopra), non i tipi di `types.ts` esistenti (che restano per le viste non ancora collegate — `Facility`/`Space`/`Slot` di `types.ts` NON vengono toccati da questo blocco, `ImpiantiSpaziView` userà i nuovi tipi locali).

### `src/api/stagioni.ts` (nuovo, piccolo)

`listaStagioni(): Promise<Stagione[]>` su `GET /stagioni`. Consumato da `BackofficeLayout.tsx` al posto di `mockSeasons`.

### `ImpiantiSpaziView.tsx` (riscritta)

Stato locale con `useState`/`useEffect` (nessuna libreria di data-fetching aggiuntiva, coerente con lo stile già stabilito nel blocco fondamenta). Layout invariato nella struttura visiva (colonna impianti a sinistra, dettaglio+griglia a destra) — cambia solo la fonte dati e i campi mostrati (vedi decisione 2). Caricamento iniziale: discipline + istituzioni (usate anche dai form), impianti. Selezione impianto → carica spazi nested. Selezione spazio → carica slot filtrati per spazio e stagione corrente (da contesto `BackofficeLayout`/Header).

### Form nuovi

`DisciplinaForm`, `IstituzioneForm`, `ImpiantoForm`, `SpazioForm`, `SlotForm` — componenti dedicati, stile coerente coi CSS custom properties e classi (`.btn`, `.form-control`) già in uso. Validazione client minima (campi obbligatori, regex orario) che rispecchia i vincoli zod visibili lato backend; per il resto si affida al 400/409 del backend, mostrato come messaggio inline (stesso pattern di `LoginView`).

## Errori

401/refresh-fallito: gestito globalmente da `apiFetch`/`AuthContext`, nessuna gestione ad hoc in questi componenti. 400 (validazione)/409 (duplicati, es. codice disciplina già esistente): messaggio inline nel form specifico.

## Testing

Vitest + Testing Library, backend reale (riuso di `avviaBackendReale` dal blocco fondamenta). Fixture create via chiamate dirette all'API in test (non serve un helper `creaXTest` per-entità: sono le stesse funzioni di `src/api/impiantiSpazi.ts` a fare da fixture-builder nei test, dopo un login reale con `creaUtenteTest` già esistente). Copertura: lista/creazione/modifica per ciascuna delle 5 entità, errore di validazione visibile, filtro `disciplineCompatibili` nel form spazio, filtro stagione+spazio sulla griglia slot.

## Fuori scope esplicito

- Assegnazioni/stato slot (vedi decisione 1).
- CRUD stagioni (solo lettura, `POST /backoffice/stagioni` esiste ma non è toccato da questa vista).
- Qualunque altra vista backoffice (`ControlRoomView`, `DelegheAccreditamentiView`, ecc.).
- Frontend pubblico.
