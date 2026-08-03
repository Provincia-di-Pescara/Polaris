# Design — Pubblicazione proposta provvisoria + concertazione tra associazioni

Data: 2026-08-03. Riferimento: `docs/SPEC.md` Fase 4, punto 5 (Flusso pubblico blocco 3/4, dopo blocco 1/4 accreditamento+delega e blocco 2/4 domanda+osservazioni, entrambi chiusi) e Fase 4 punto 7. Copre Allegato B fasi 10-12: art. B.23 (pubblicazione proposta provvisoria), B.24-B.26 (concertazione tra associazioni — apertura, proposte ammissibili, accettazione), B.27-B.28 (validazione e approvazione delle proposte). Schema già completo dalla Fase 1 (`concertazione_proposte`, `concertazione_proposta_parti`, `concertazione_proposta_slot`) — una sola migration di schema nuova (vedi sotto).

Tutto in `backend-node`: la concertazione è workflow/negoziazione tra parti con verifiche strutturali, non calcolo algoritmico — non tocca il motore Go, coerente con l'architettura a 5 container (Go resta isolato al solo calcolo FR/ISF/CP/round-robin/sorteggio).

## Fuori scope esplicito (blocco 4/4, task successivo)

- **B.29 Riassegnazione finale**: le fasce ancora libere dopo la concertazione vengono riassegnate riapplicando le regole di Fase 8-9 (round-robin) — richiede richiamare `internal/roundrobin` sul residuo, non toccato qui.
- **B.30-B.31 Settimana tipo definitiva**: formazione del quadro definitivo (fasce assegnate, blocchi gara, fasce libere, accordi di concertazione) ed efficacia — richiede la colonna `assegnazioni.concertazione_proposta_id` introdotta da questo blocco, ma la query/endpoint di composizione del quadro definitivo è del prossimo blocco.
- **Fase 15 (B.32) — variazioni ordinarie post-`definitiva`**: il testo normativo riusa esplicitamente "le medesime verifiche di compatibilità di cui all'art. B.27" per gli scambi durante la stagione. Questo blocco gestisce **solo** la finestra di concertazione con `stagione.stato = 'concertazione'`; l'estensione della stessa tabella/logica a `stato = 'definitiva'` con regole di scadenza/reversibilità diverse (temporaneo vs permanente) è un task futuro esplicito, non anticipato qui.
- UI (Fase 5).

## 1. Pubblicazione proposta provvisoria — art. B.23

### `POST /backoffice/stagioni/:id/pubblica-proposta`
`richiedeRuolo('admin')`. Nessun body. Precondizioni: esiste un'elaborazione `tipo='prima_assegnazione'` `stato='completata'` per la stagione (altrimenti 409 — nessuna proposta da pubblicare); `stagione.stato = 'prima_assegnazione'` (altrimenti 409, transizione singola). Nessuna scrittura su `assegnazioni` (già in stato `'provvisoria'` dal round-robin) — solo `UPDATE stagioni_sportive SET stato='concertazione'` + `registraOperazione` (`pubblica_proposta_provvisoria`) in transazione.

### `GET /pubblico/stagioni/:id/proposta`
`richiedeAutenticazionePubblico` (nessuna restrizione alla propria associazione — trasparenza necessaria: un'associazione deve vedere gli slot altrui per proporre scambi/cessioni, stesso principio di trasparenza già applicato in B.10). Disponibile solo se `stagione.stato IN ('concertazione','definitiva')` (409 altrimenti — proposta non ancora pubblicata). Ritorna, per ogni assegnazione attiva (`stato IN ('provvisoria','validata')`) della stagione: `{slotId, associazioneId, tipo, valoreMinutiAssegnato, fabbisognoRiconosciutoMinuti, isf, sorteggioRiferimento?}` (join `fabbisogni_riconosciuti`/`coefficienti_associazione` per FR/ISF se calcolati, join `sorteggi` per `articolo_riferimento`+`id` quando l'assegnazione deriva da un pareggio risolto a sorteggio). Valori NUMERIC sempre stringa (stesso pattern parametrico/motore Go).

## 2. Migration nuova — collegamento assegnazione↔proposta

`000012_concertazione_link_assegnazioni.up/down.sql`: `ALTER TABLE assegnazioni ADD COLUMN concertazione_proposta_id UUID REFERENCES concertazione_proposte(id);` (nullable — solo le assegnazioni nate da uno scambio validato la valorizzano). Serve al blocco 4/4 per comporre "gli accordi intervenuti in fase di concertazione" (B.30) senza dover dedurli a posteriori da timestamp/euristiche.

## 3. Proposte di concertazione — art. B.24-B.26

Riuso integrale dello schema esistente, nessuna tabella nuova. `concertazione_proposta_slot.associazione_cedente_id` è `NULL` per `tipo='utilizzo_slot_libero'` (nessun cedente, lo slot è libero), valorizzato per tutti gli altri tipi (`scambio_bilaterale`, `scambio_multilaterale`, `cessione`, `accorpamento`, `ampliamento`).

### `POST /pubblico/stagioni/:id/concertazione/proposte`
`richiedeAutenticazionePubblico`. Precondizione: `stagione.stato = 'concertazione'` (409 altrimenti — stessa scelta di gate del blocco, vedi sopra). Body (zod `schemaCreaProposta`):

```
tipo: 'scambio_bilaterale'|'scambio_multilaterale'|'cessione'|'utilizzo_slot_libero'|'accorpamento'|'ampliamento',
slot: [{slotId, associazioneCedenteId?: string|null, associazioneRiceventeId: string}] (>=1),
```
`.superRefine`: se `tipo='utilizzo_slot_libero'`, ogni riga deve avere `associazioneCedenteId` assente/null; altrimenti ogni riga deve averlo valorizzato. `associazioniCoinvolte` derivata server-side come unione distinta di cedenti+riceventi (mai accettata dal client, evita incoerenze dichiarate).

Autorizzazione: il chiamante deve avere `trovaAbilitazioneAttiva(pool, req.persona.sub, associazioneId, stagioneId)` per **almeno una** delle associazioni coinvolte (quella per cui agisce da proponente) — stesso helper già in uso per domande/deleghe, nessuna distinzione di ruolo (non c'è privilege escalation qui, a differenza della sub-delega).

Validazioni aggiuntive prima dell'INSERT: ogni `slotId` appartiene alla stagione (stesso controllo anti-cross-stagione già fatto per `POST /pubblico/domande`); ogni associazione coinvolta ha una domanda `ammessa` per la stagione (lookup `domande_associazione_stagione_uq`, necessario per risolvere poi `domanda_id` in validazione).

Transazione: INSERT `concertazione_proposte` (`stato` iniziale `'accettata_da_tutti'` se `associazioniCoinvolte.length <= 1` — solo il proponente, nessun'altra parte deve accettare — altrimenti `'in_attesa_accettazione'`) + INSERT `concertazione_proposta_parti` (una riga per associazione coinvolta; se stato iniziale è già `'accettata_da_tutti'`, la riga del proponente stesso viene inserita già con `accettato_il=now()`) + INSERT `concertazione_proposta_slot` + `registraOperazione` (`crea_proposta_concertazione`).

### `GET /pubblico/stagioni/:id/concertazione/proposte`
`richiedeAutenticazionePubblico`. Lista delle proposte in cui la propria associazione è proponente o parte (join `concertazione_proposta_parti` su una qualunque associazione per cui il chiamante ha un'abilitazione attiva in quella stagione).

### `GET /pubblico/concertazione/proposte/:id`
`richiedeAutenticazionePubblico`. 403 se la propria associazione non è tra le parti/proponente, 404 su id inesistente, 400 su UUID malformato.

### `POST /pubblico/concertazione/proposte/:id/accetta`
`richiedeAutenticazionePubblico`. Il chiamante deve avere abilitazione attiva su una delle associazioni-parte non ancora accettante. Precondizione: `proposta.stato = 'in_attesa_accettazione'` (409 altrimenti — non accettabile se già decisa/annullata, o se già `accettata_da_tutti`). UPDATE ottimistico su `concertazione_proposta_parti` (`accettato_il`, `accettato_da_persona_fisica_id`) con lock riga; poi, nella stessa transazione, se **nessun'altra** parte risulta con `accettato_il IS NULL`, UPDATE `concertazione_proposte SET stato='accettata_da_tutti', versione=versione+1` (il campo `versione` esistente funge da guardia ottimistica contro doppie transizioni concorrenti — `WHERE versione=$attesa`, retry singolo su conflitto). `registraOperazione` (`accetta_proposta_concertazione`).

### `POST /pubblico/concertazione/proposte/:id/annulla`
`richiedeAutenticazionePubblico`, solo il proponente originale. Precondizione: `stato IN ('in_attesa_accettazione','accettata_da_tutti')` (409 se già `validata`/`rigettata`/`annullata`). UPDATE `stato='annullata'` + `registraOperazione` (`annulla_proposta_concertazione`).

## 4. Validazione e approvazione — art. B.27-B.28

### `GET /backoffice/stagioni/:id/concertazione/proposte`
`richiedeRuolo('admin','operatore')`. Filtro `?stato=accettata_da_tutti` per la coda di lavoro, ordinata per `creata_il ASC` (ordine FIFO da rispettare).

### `PUT /backoffice/concertazione/proposte/:id/valida`
`richiedeRuolo('admin','operatore')`. Nessun body. Algoritmo (tutto in una transazione):

1. `SELECT ... FOR UPDATE` sulla proposta. Precondizione: `stato='accettata_da_tutti'` → 409 altrimenti (stato-macchina, non esito di dominio).
2. **Guardia FIFO** (art. B.27, "verifica di compatibilità" letta insieme al vincolo di sistema "sempre FIFO su ordine di submission", vedi CLAUDE.md sezione lock/concorrenza): se esiste un'altra proposta `stato='accettata_da_tutti'` con `creata_il` precedente che condivide almeno uno `slot_id` (query su `concertazione_proposta_slot`) → 409 `ErroreConflittoFifoConcertazione` ("esiste una proposta precedente da validare prima su questi slot"). Errore di richiesta (l'admin deve processare la coda in ordine), non un esito di dominio.
3. `pg_advisory_xact_lock(hashtext(slot_id))` per ogni slot coinvolto, in ordine `slot_id ASC` (evita deadlock tra validazioni concorrenti su slot in comune).
4. Controlli strutturali per ogni riga slot (🔺 **assunzione**: "non violi i principi dell'Allegato A" B.27 interpretato come i soli controlli strutturali sotto, niente ricalcolo ISF/CP — la concertazione è negoziazione tra parti, non un nuovo round algoritmico; da confermare con l'Ente):
   - l'assegnazione attiva corrente sullo slot corrisponde al cedente atteso dalla proposta (o nessuna assegnazione attiva se `utilizzo_slot_libero`) — altrimenti lo stato è cambiato dopo la creazione della proposta;
   - l'assegnazione attiva corrente non è `tipo='blocco_gara'` (i blocchi gara non sono cedibili in concertazione, B.27 "non comprometta i blocchi gara assegnati");
   - la disciplina della domanda del ricevente è compatibile con lo spazio dello slot, e l'omologazione richiesta (se presente) è soddisfatta — stesso controllo già usato per l'ammissibilità blocchi gara;
   - i limiti di concentrazione B.19 (minuti settimanali max, slot max stesso impianto, fasce pregiate max) restano rispettati dal ricevente sommando le sue assegnazioni attive post-scambio (al netto di quanto eventualmente cede nella stessa proposta).
5. Esito: se tutti i controlli passano, applica (per ogni slot: `UPDATE assegnazioni SET stato='sostituita', decaduta_il=now(), decaduta_motivazione='concertazione: proposta <id>' WHERE ...` sull'assegnazione attiva del cedente, poi `INSERT` nuova assegnazione per il ricevente con `domanda_id` risolta da `domande_associazione_stagione_uq`, `valore_minuti` = durata slot, `concertazione_proposta_id`, `stato='validata'`), poi `proposta.stato='validata'`, `validata_il`, `validata_da=req.utente.sub`. Se un controllo fallisce: `proposta.stato='rigettata'`, `motivazione_rigetto` (testo che indica quale controllo è fallito). **Risposta HTTP sempre 200** in entrambi i casi (`{esito:'validata'}` o `{esito:'rigettata', motivazione}`) — il rigetto per incompatibilità è un esito di dominio previsto da B.28 ("le proposte incompatibili vengono rigettate con motivazione"), non un errore di richiesta. `registraOperazione` (`valida_proposta_concertazione`) in entrambi i casi.

### `PUT /backoffice/concertazione/proposte/:id/rigetta`
`richiedeRuolo('admin','operatore')`. Body `{motivazione}` (zod, min 10 caratteri, stesso pattern già in uso per `schemaRespingiDelega`/esclusione domanda). Precondizione: `stato='accettata_da_tutti'` → 409 altrimenti. Rigetto discrezionale manuale (l'admin può rigettare senza passare dal controllo automatico, es. per motivi non modellabili nei controlli strutturali). UPDATE `stato='rigettata'`, `motivazione_rigetto` + `registraOperazione`.

## Errori nuovi

- `ErroreConflittoFifoConcertazione` (`erroriDominio.ts`) → HTTP 409.
- Riuso: `ErroreNonTrovato` (404), `ErroreStatoNonValidoPerTransizione` (409, già introdotta nel blocco domande/osservazioni), `ErroreValoreDuplicato`/22P02/23503 (pattern consolidato).

## Testing

`node --test` contro Postgres reale, server HTTP vero, nessun mock. Scenari minimi per task (dettaglio nel piano):
- Pubblicazione proposta: transizione stato stagione, 409 se elaborazione mancante/stato sbagliato, lettura pubblica prima/dopo pubblicazione.
- Scambio bilaterale completo: crea → accetta entrambe le parti → `accettata_da_tutti` → valida → assegnazioni aggiornate (cedente `sostituita`, ricevente nuova riga con `concertazione_proposta_id`) → audit log.
- `utilizzo_slot_libero`: parte singola, proposta nasce già `accettata_da_tutti`, slot deve risultare libero in validazione altrimenti rigetto.
- Rigetto per disciplina incompatibile / blocco gara / limiti concentrazione superati — proposta `rigettata` con motivazione, assegnazioni invariate.
- Conflitto FIFO: due proposte sullo stesso slot, tentativo di validare la più recente prima della più vecchia → 409.
- Annullamento da parte del proponente prima della validazione; 409 se tentato dopo `validata`.
- Autorizzazione: 403 su creazione/accettazione senza abilitazione attiva sulla stagione; 403 operatore pubblico su route backoffice e viceversa.

## Assunzioni aperte (🔺, non bloccanti — da confermare con l'Ente in Fase 7)

1. Scope dei controlli B.27 "non violi i principi dell'Allegato A" limitato ai controlli strutturali elencati (§4.4) — nessun ricalcolo ISF/CP dopo lo scambio.
2. Nessuna distinzione di ruolo (rappresentante/operatore) per creare/accettare proposte di concertazione — stesso ragionamento già applicato a domande/osservazioni: qui non c'è privilege escalation, a differenza della sub-delega.
3. Concertazione gestita solo con `stagione.stato='concertazione'`; l'estensione a `'definitiva'` per le variazioni ordinarie di Fase 15 (B.32) è demandata a un task futuro separato, non a questo blocco.
