# EsitiIsfView: collegamento API reali — Design

## Contesto

`EsitiIsfView` (frontend pubblico) è ancora su mock: KPI (FR/coefficienti/ISF) e tabella slot assegnati con dati finti per un'unica associazione fittizia ("ASD Pescara Volley"). Questo blocco la collega al backend reale (esiti istruttoria art. B.10 già pubblicati dal blocco 2/4, osservazioni/riesame art. B.11 anch'esse già presenti lato backend).

## Gap reali trovati durante l'analisi

- **`GET /pubblico/stagioni/:stagioneId/domande/esiti` esiste già** (`elencoEsitiPubblicati`, pubblicazione esiti art. B.10, nessuno scoping per associazione — è un bollettino pubblico per design, tutte le domande `stato <> 'presentata'` della stagione) ma non restituisce la denominazione dell'associazione, necessaria per un tabellone leggibile.
- **Nessun endpoint pubblico per gli slot effettivamente assegnati**: solo rotte `backoffice/assegnazioni/:id/...` esistono. La tabella "Slot Provvisori Assegnati" del mock non ha alcuna API reale da cui leggere.
- **Nessun endpoint pubblico per leggere le osservazioni presentate**: `POST /pubblico/domande/:id/osservazioni` esiste (con ownership check via `trovaAbilitazioneAttiva`, pattern corretto), ma non c'è modo per l'associazione di rivedere lo stato delle proprie osservazioni già presentate (`in_esame`/`accolta`/`respinta`).
- L'ISF (Indice di Soddisfazione Fabbisogno) non è mai persistito: va calcolato client-side come `VA totale (somma valore_minuti delle assegnazioni attive) / FR`, mai ricalcolato lato server — coerente con B.36 (storico interrogabile, nessun nuovo calcolo qui).

## Architettura

### Backend — 1 query estesa + 2 endpoint pubblici nuovi

- **`GET /pubblico/stagioni/:stagioneId/domande/esiti`** (esistente, `elencoEsitiPubblicati` in `domande.ts`): la query SQL viene estesa con `JOIN associazioni a ON a.id = d.associazione_id` per aggiungere `associazioneDenominazione` al risultato. Nessuna modifica alla route, nessun nuovo scoping (resta bollettino pubblico per stagione).
- **`GET /pubblico/associazioni/:associazioneId/assegnazioni?stagioneId=`** (nuovo): lista `assegnazioni` per l'associazione+stagione, join `slot_settimana_tipo`/`spazi_sportivi`/`impianti` per i dettagli di visualizzazione (impianto/spazio/giorno/orario/durata), più `tipo` (`singola`/`blocco_gara`/`blocco_allenamento`), `stato` (`provvisoria`/`validata`/`decaduta`/`sostituita`), `valoreMinuti`. **Ownership check obbligatorio** via `trovaAbilitazioneAttiva(pool, req.persona!.sub, associazioneId, stagioneId)` → 403 se assente — stesso pattern già corretto nel blocco precedente (finding critico della review finale su `anteprima-fabbisogno`).
- **`GET /pubblico/domande/:id/osservazioni`** (nuovo): lista osservazioni per una domanda. Nuova funzione `listaOsservazioniPerDomanda(db, domandaId)` in `osservazioni.ts` (stesso stile di `trovaOsservazionePerId`, solo che restituisce l'array ordinato per `presentata_il`). **Ownership check obbligatorio**: la route carica la domanda (`trovaDomandaPerId`), poi verifica `trovaAbilitazioneAttiva(pool, req.persona!.sub, domanda.associazioneId, domanda.stagioneId)` → 403 se assente — stesso identico pattern già usato dalla `POST /pubblico/domande/:id/osservazioni` esistente (righe 3226-3235 di `server.ts`), da copiare non da reinventare.

### Frontend — `EsitiIsfView` riscritta sui dati reali

Props: `{ entities: EntitaRappresentata[]; stagioneId: string | null; activeEntity: EntitaRappresentata | null }` (stesso pattern di `WizardDomandaView`/`AccreditamentoDelegaView`).

- **Guardia iniziale**: se `!stagioneId`/`!activeEntity`/`!associazioneId`, messaggio inline (stesso pattern già stabilito). Se nessuna domanda presentata per l'associazione/stagione attiva (`GET /pubblico/associazioni/:associazioneId/domande`, endpoint già esistente), messaggio "nessuna domanda presentata per questa stagione" invece della vista.
- **Sezione "La mia domanda"**: se la domanda ha `stato === 'presentata'` (istruttoria non ancora eseguita), messaggio "esito non ancora pubblicato". Altrimenti: KPI cards (FR finale, coefficienti CRS/CAA/CSD/CP, ISF calcolato client-side da VA/FR — VA = somma `valoreMinuti` delle assegnazioni con `stato` in `provvisoria`/`validata`), tabella slot assegnati reali (da `GET /pubblico/associazioni/:associazioneId/assegnazioni`), badge stato domanda (`ammessa`/`esclusa`) e stato riesame (`riesameStato`, già presente su `Domanda`) se non `'nessuno'`.
- **Sezione osservazioni**: se `domanda.stato === 'esclusa'` (o comunque la domanda ha una motivazione) e `riesameStato !== 'deciso'`, form per presentare una nuova osservazione (`POST /pubblico/domande/:id/osservazioni`, endpoint esistente — validazione minima lato client, il backend rifiuta già stati non osservabili/riesame già deciso con messaggi propri). Lista delle osservazioni già presentate (`GET /pubblico/domande/:id/osservazioni`, nuovo) con stato/testo/decisione se presente.
- **Sezione "Tabellone pubblico"**: tabella con tutte le domande della stagione dal `GET /pubblico/stagioni/:id/domande/esiti` esteso (denominazione associazione, stato, FR, ISF calcolato per riga) — sempre visibile indipendentemente dalla propria domanda, ordinata come restituita dal backend (per `presentata_il`).

## Testing

- Backend: `elencoEsitiPubblicati` esteso testato con denominazione presente; nuovi endpoint `assegnazioni`/`osservazioni` testati contro Postgres reale con scenario ownership positivo (200, dati corretti) e negativo (403, persona senza abilitazione attiva su quell'associazione/stagione) — stesso schema di test già usato per `anteprima-fabbisogno`.
- Frontend: `EsitiIsfView.test.tsx` (mock delle funzioni `api/*`, tutte le sezioni: nessuna domanda → messaggio, domanda `presentata` → "esito non pubblicato", domanda con esito → KPI+tabella slot, domanda esclusa → form osservazione + lista, tabellone pubblico sempre presente). `App.esiti.realBackend.test.tsx` (smoke end-to-end, stesso pattern stabilito: crea persona+associazione+abilitazione approvata+stagione+domanda ammessa con un'assegnazione reale di fixture via pg diretto, verifica che la view mostri i dati reali; presenta un'osservazione reale attraverso l'UI e verifica che compaia nella lista al remount).

## Fuori scope

- Decisione backoffice sulle osservazioni (accogli/respingi, già esistente lato backend `POST /backoffice/osservazioni/:id/accogli|respingi`) — nessuna UI backoffice per questo, non richiesto da questo blocco.
- Ricalcolo/persistenza dell'ISF lato server — resta calcolato client-side da dati già pubblicati, mai un nuovo storico (B.36 già chiuso solo come storico interrogabile).
- `ConcertazioneView`, `CalendarioDefinitivoView` — restano mock, blocchi futuri.
