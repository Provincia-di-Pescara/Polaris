# Gestione stagioni: CRUD backoffice + selezione pubblico multi-stagione

Data: 2026-08-24
Stato: design approvato, implementazione in corso (CRUD backend fatto, resto da fare)

## Problema

Segnalato dal committente durante un giro di test sul deploy reale:

1. **CRUD stagioni assente**: solo `POST /backoffice/stagioni` esisteva (creazione). Nessuna modifica, nessuna eliminazione — nemmeno per correggere un errore di battitura o ripulire dati di test. Nessun vincolo di buon senso sulle date (possibile creare N stagioni con range di date che si sovrappongono senza nessun avviso).

2. **Selezione stagione nel pubblico ingenua**: `frontend-pubblico/src/App.tsx` sceglie di default "la prima stagione non chiusa ordinata per `data_inizio` DESC" — corretto solo finché esiste **una sola** stagione non chiusa alla volta. Appena la Provincia inizia il censimento della stagione N+1 mentre la stagione N è ancora `definitiva` (variazioni ordinarie in corso, art. B.32), il cittadino viene automaticamente indirizzato sulla stagione SBAGLIATA (la nuova, dove non può ancora fare nulla) invece di quella su cui ha azioni pendenti.

Il secondo punto ha portato a scoprire che il modello attuale NON gestisce la convivenza di più stagioni "vive" contemporaneamente in fasi diverse — scenario reale e atteso, non un edge case: verso la fine dell'anno scolastico la Provincia deve poter aprire il censimento della stagione successiva mentre quella corrente è ancora in `definitiva` (gli impianti sono ancora in uso, le associazioni possono ancora liberare/scambiare slot).

## Decisioni prese (in ordine di discussione)

1. **Niente vincolo rigido anti-sovrapposizione date** tra stagioni. Due stagioni con range di date che si toccano/sovrappongono sono un caso legittimo (fine-stagione-N / censimento-stagione-N+1), non un errore da bloccare al livello DB.
2. **CRUD stagioni completo**, ma modifica/eliminazione ristrette:
   - Solo se `stato = 'censimento'` (prima che il flusso procedurale sia partito).
   - Solo se non esistono dati "load-bearing" collegati: `slot_settimana_tipo`, `domande`, `elaborazioni`, `concertazione_proposte`.
   - **Deliberatamente ESCLUSE dal controllo**: `abilitazioni` e `associazioni_documenti`. Sono contorno amministrativo per-stagione — un'associazione già accreditata negli anni precedenti **riattiva la propria delega/abilitazione ad ogni nuova stagione** (routine attesa, non un impegno che blocchi una correzione di data/nome). Esempio concreto dal committente: "un'associazione già iscritta deve riattivare le deleghe" ad ogni stagione — se quel riuso bloccasse la modifica, la stagione diventerebbe immodificabile al primo giorno utile.
3. **Pagina dedicata in backoffice** (sotto "Impostazioni", non più un popup nell'Header) per la gestione: lista con stato/date, modifica, eliminazione — coerente con le altre pagine di Impostazioni già esistenti (Backup & Ripristino, Utenti, ecc.).
4. **Frontend pubblico: nessuna selezione automatica.** Il cittadino sceglie sempre esplicitamente la stagione da un selettore che elenca **tutte** le stagioni non-chiuse, ciascuna etichettata col proprio stato — non solo i due estremi "attiva"/"censimento" ma ogni stato intermedio (es. `concertazione`, `pubblicazione_istruttoria`), perché ciascuno ha azioni pubbliche diverse già implementate (`ConcertazioneView`, `EsitiIsfView`, ecc.).
5. **Scoping dei dati concreti resta invariato**: uno slot/occorrenza/domanda ha già il proprio `stagione_id` nel DB — non serve nessuna logica di "trova la stagione per data", è un problema di UX di selezione, non di query.

## Fuori scope per questo giro

- Non c'è alcun automatismo "stagione attiva per il pubblico" da impostare a mano (nessun flag `attiva`): resta vero quanto già documentato in CLAUDE.md, lo stato avanza solo attraverso il flusso procedurale in Control Room.
- Non si introduce nessuna vista che risolva "in quale stagione ricade questa data" — non serve, i dati concreti sono già scoped.

## Design tecnico

### 1. Backend — CRUD stagioni (`backend-node/src/stagioni.ts`, FATTO)

- `aggiornaStagione(db, id, dati)` — `PUT /backoffice/stagioni/:id`, admin-only.
- `eliminaStagione(db, id)` — `DELETE /backoffice/stagioni/:id`, admin-only, 204.
- Entrambe passano da `verificaStagioneModificabile`: 404 se non esiste, 409 (`ErroreStagioneNonModificabile`) se `stato !== 'censimento'` o se esistono righe in una delle 4 tabelle load-bearing.
- `schemaAggiornaStagione` riusa la stessa forma di `schemaCreaStagione` (nome/dataInizio/dataFine, refine `dataInizio < dataFine`).
- Audit log: `aggiorna_stagione` / `elimina_stagione`, stesso pattern delle altre entità CRUD.
- Vincolo UNIQUE su `nome` già esistente (`stagioni_sportive_nome_uq`) — invariato, mappato a 409 `ErroreValoreDuplicato` come prima.

### 2. Frontend backoffice — pagina "Stagioni" (DA FARE)

Nuova `StagioniView.tsx` sotto il gruppo "Impostazioni" della Sidebar (stessa guardia `ProtectedRoute ruoliAmmessi={['admin']}` delle altre voci di quel gruppo):

- Tabella: nome, date, stato (badge), azioni.
- "Nuova stagione": stesso form già esistente nell'Header del backoffice, spostato qui. L'Header perde il form inline — resta solo il selettore (nessuna azione di creazione lì).
- "Modifica"/"Elimina": abilitati solo per righe con `stato === 'censimento'`; altrimenti disabilitati con tooltip che spiega perché (stato attuale, o presenza di dati collegati — quest'ultimo lo sa solo il backend, quindi il tentativo può comunque fallire con 409 anche se il bottone è abilitato lato client: il client non replica la query sui 4 count, si limita a `stato==='censimento'` come euristica veloce, il 409 reale resta l'unica fonte di verità).
- Eliminazione dietro `window.confirm` (stesso pattern di `UtentiView`/`BackupView`).

### 3. Frontend pubblico — selezione esplicita multi-stagione (DA FARE)

- `App.tsx`: rimuovere l'auto-selezione (`nonChiusa?.id ?? s[0]?.id`). `stagioneId` resta `null` finché il cittadino non sceglie esplicitamente.
- `Header.tsx`: il `<select>` stagione aggiunge un'opzione placeholder ("— seleziona una stagione —", value vuoto) quando `stagioneId` è `null`; ogni opzione mostra `nome` **+ badge/etichetta di stato** (es. "2026/2027 — Censimento", "2025/2026 — Definitiva") invece del solo nome. Rimuovere anche la stringa statica hardcoded "Stagione 2026/2027" nel sottotitolo dell'header (bug minore trovato durante l'indagine, mai stata dinamica).
- Le 5 view che dipendono da `stagioneId` (`AccreditamentoDelegaView`, `WizardDomandaView`, `EsitiIsfView`, `ConcertazioneView`, `CalendarioDefinitivoView`) devono gestire esplicitamente `stagioneId === null`: messaggio "Seleziona una stagione dall'intestazione per continuare" invece di un fetch con id vuoto/errore silenzioso. Verificare per ciascuna cosa succede oggi passando `stagioneId=null` (alcune potrebbero già gestirlo per via del guard `if (!stagioneId) return`, altre no).

## Residuo aperto (2026-08-24)

`App.domanda.realBackend.test.tsx` fallisce per timeout (40s dichiarati) dopo questo giro di modifiche, riprodotto due volte in isolamento con processi puliti — non un semplice rallentamento: l'intero processo vitest resta bloccato per ~12 minuti dopo il fallimento del singolo test prima di uscire, sintomo di un hang reale (probabile `afterAll`/chiusura backend o pool bloccata), non ancora isolato con certezza. Gli altri 4 file `App.*.realBackend.test.tsx` e l'intera suite non-realBackend restano verdi. Da investigare con calma prima di considerare chiuso questo blocco.

## Test

- Backend: unit test su `aggiornaStagione`/`eliminaStagione` (già in corso in questa sessione, `stagioni.test.ts`) — copre: modifica ok in censimento, 409 fuori censimento, 409 con dati collegati (una fixture per ciascuna delle 4 tabelle), 409 su nome duplicato, DELETE 204 + verifica riga sparita.
- Backend HTTP: `server.backoffice.test.ts` — ruolo admin-only su PUT/DELETE, stessi scenari sopra a livello HTTP.
- Frontend backoffice: `StagioniView.test.tsx` (mock API) — tabella, bottoni disabilitati quando non modificabile, submit modifica/elimina.
- Frontend pubblico: aggiornare i test esistenti di `App.tsx`/`Header.tsx` che assumevano l'auto-selezione; aggiungere caso "due stagioni non chiuse, nessuna preselezionata, l'utente sceglie".
