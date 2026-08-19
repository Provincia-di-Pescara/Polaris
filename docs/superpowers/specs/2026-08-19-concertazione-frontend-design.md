# ConcertazioneView: collegamento API reali — Design

## Contesto

`ConcertazioneView` (frontend pubblico) è ancora su mock: tabella proposte finte con accetta/rifiuta diretto, form di scambio semplificato a due associazioni. Il backend reale (Fase 11, art. B.23-B.28) è molto più ricco: bollettino pubblico della proposta provvisoria (art. B.23), sistema di proposte di concertazione multi-tipo/multi-parte (art. B.24-26) con accettazione per-associazione, validazione FIFO finale lato backoffice (art. B.27-28) — non un accetta/rifiuta diretto tra pubblici come nel mock.

## Gap reali trovati durante l'analisi

- **6 tipi di proposta** (`scambio_bilaterale`, `scambio_multilaterale`, `cessione`, `utilizzo_slot_libero`, `accorpamento`, `ampliamento`) condividono lo stesso schema strutturale (`slot: {slotId, associazioneCedenteId?, associazioneRiceventeId}[]`) — l'unica differenza strutturale imposta da zod è che `associazioneCedenteId` deve essere assente per `utilizzo_slot_libero` e presente per tutti gli altri. Un'unica UI generica (select tipo + righe slot dinamiche) copre tutti e 6 i tipi, non serve un form per tipo.
- **Il flusso reale non è accetta/rifiuta diretto**: una proposta ha stato `in_attesa_accettazione` → (ogni parte coinvolta accetta individualmente) → `accettata_da_tutti` → (solo allora il backoffice valida o rigetta, art. B.27-28). Il pubblico può solo creare, accettare (la propria parte) o annullare (solo il proponente) — mai rifiutare direttamente né validare.
- **`GET /pubblico/stagioni/:id/proposta` (`trovaPropostaProvvisoria`, bollettino pubblico non scoped per associazione, stesso pattern del bollettino esiti) restituisce solo id grezzi**: `slotId`/`associazioneId`, nessuna denominazione associazione né dettaglio slot leggibile (impianto/spazio/giorno/orario). Necessaria per costruire sia la tabella del bollettino sia per arricchire (lookup) le proposte, che a loro volta portano solo `slotId`/`associazioneId` nei propri dati.
- Nessun altro endpoint backend mancante: creazione/lista/dettaglio/accetta/annulla proposte esistono già, tutti correttamente ownership-scoped (`trovaAbilitazioneAttiva`, verificato leggendo il codice — inclusa la correzione già presente per l'annullamento, dove non basta essere il proponente originale se la sua abilitazione è stata nel frattempo revocata).

## Architettura

### Backend — 1 query estesa

`GET /pubblico/stagioni/:id/proposta` (`trovaPropostaProvvisoria` in `backend-node/src/propostaProvvisoria.ts`): la query SQL viene estesa con `JOIN associazioni`/`spazi_sportivi`/`impianti` per aggiungere `associazioneDenominazione` e i dettagli slot (`impiantoDenominazione`, `spazioDenominazione`, `giornoSettimana`, `orarioInizio`/`orarioFine` in formato `HH:MM` via `to_char` — **non** `::text`, che produrrebbe `HH:MM:SS`, stesso bug già corretto in un blocco precedente — `durataMinuti`, `pregiata`). Nessuna modifica alla route, nessun nuovo scoping (resta bollettino pubblico per stagione, art. B.23).

### Frontend — `ConcertazioneView` riscritta

Props: `{ entities: EntitaRappresentata[]; stagioneId: string | null; activeEntity: EntitaRappresentata | null }`.

- **Guardia**: `!stagioneId`/`!activeEntity` → messaggio inline. `trovaPropostaProvvisoria` risponde 409 se la stagione non è ancora in fase `concertazione`/`definitiva` → messaggio "la fase di concertazione non è ancora aperta per questa stagione" invece della vista.
- **Bollettino provvisorio**: tabella di tutte le voci (`slotId`/`associazioneId`/`valoreMinutiAssegnato`/`fabbisognoRiconosciutoMinuti`/`isf`), un fetch unico condiviso da tutte le sezioni della view (stesso pattern "un solo fetch" già stabilito nel blocco EsitiIsfView). Riga propria evidenziata. Da questo fetch si costruiscono due mappe di lookup (slot→dettaglio, associazioneId→denominazione) usate anche dalle sezioni sotto.
- **Le mie proposte**: `GET /pubblico/stagioni/:id/concertazione/proposte` (già esistente, filtra automaticamente sulle associazioni con abilitazione approvata del chiamante), arricchita con le mappe di lookup sopra per mostrare denominazioni/slot leggibili invece di UUID. Badge stato, elenco parti con chi ha già accettato. Bottone **Accetta** (`POST /pubblico/concertazione/proposte/:id/accetta` con `associazioneId` — solo se la propria associazione è tra le parti e non ha ancora accettato) e **Annulla** (`POST .../annulla` — solo se la propria associazione è la proponente, il backend verifica comunque l'abilitazione attiva).
- **Form nuova proposta**: select tipo (6 opzioni) → righe slot dinamiche (aggiungi/rimuovi riga), ogni riga: slot da cedere (dalle proprie voci nel bollettino — select vuota/nascosta se tipo = `utilizzo_slot_libero`, per rispecchiare esattamente il refine zod) + associazione ricevente (dalle associazioni presenti nel bollettino) + slot ricevuto (dalle voci del bollettino della ricevente). Simulazione ISF puramente informativa e client-side: VA attuale ± delta minuti dei slot coinvolti nella proposta, mai inviato al backend, etichettata esplicitamente come stima non autoritativa (il valore reale dipende dai controlli server-side — compatibilità disciplina, limiti di concentrazione — mai duplicati client-side).

## Testing

- Backend: query estesa testata con denominazione/dettagli slot presenti, formato orario `HH:MM` verificato esplicitamente (stesso controllo già aggiunto nel blocco precedente per lo stesso bug).
- Frontend: `ConcertazioneView.test.tsx` (mock api — guardia stagione non aperta, bollettino, lista proposte con azioni condizionali accetta/annulla, form nuova proposta per `scambio_bilaterale` e `utilizzo_slot_libero`, gli unici due tipi con una differenza strutturale reale). `App.concertazione.realBackend.test.tsx` (smoke e2e: due associazioni di fixture con domande ammesse e assegnazioni reali, una propone uno scambio bilaterale attraverso l'intera UI, l'altra (sessione separata) accetta, verifica che lo stato transiti a `accettata_da_tutti`).

## Fuori scope

- Validazione/rigetto backoffice delle proposte (già esistente lato backend, art. B.27-28) — nessuna UI backoffice richiesta qui.
- Replica client-side dei controlli di dominio server-side (compatibilità disciplina, limiti di concentrazione, FIFO) — solo il backend decide, il client mostra l'errore ricevuto.
- `CalendarioDefinitivoView` — resta mock, blocco futuro.
