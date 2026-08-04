# Design — Riassegnazione finale + settimana tipo definitiva

Data: 2026-08-04. Riferimento: `docs/SPEC.md` Fase 4, Flusso pubblico blocco 4/4 (ultimo blocco del flusso pubblico, dopo blocco 3/4 pubblicazione proposta + concertazione, chiuso). Copre Allegato B fasi 13-14: art. B.29 (riassegnazione finale), B.30 (formazione quadro definitivo), B.31 (efficacia). Nessuna nuova tabella — `convenzioni` esiste già dalla Fase 1.

Ricerca preliminare (fork di investigazione sul motore Go, non implementazione): `EseguiRoundRobin` (`engine-go/internal/postgres/assegnazione.go`) è direttamente riusabile per B.29 senza nuova logica algoritmica — il filtro slot-candidati esclude già qualsiasi assegnazione attiva (non solo blocchi gara, nonostante il commento CLAUDE.md preesistente dica il contrario) e `caricaStatoIniziale` somma già correttamente lo stato post-concertazione (inclusa la VA pesata per fasce pregiate, fix C1 del blocco 3/4). Unico cambio richiesto lato Go: parametrizzare `tipo` in `PersistiEsitoRoundRobin` (oggi hardcoded `'prima_assegnazione'`) — `elaborazioni.tipo` ha già `'riassegnazione_residue'` nel CHECK constraint, mai usato finora.

## Fuori scope esplicito

- **Conferma convenzione lato pubblico (associazione)**: la tabella `convenzioni` supporta sia `confermata_da_utente_backoffice_id` sia `confermata_da_persona_fisica_id`, ma questo blocco implementa solo il primo. Le istituzioni scolastiche non hanno accesso diretto alla piattaforma (l'iter di delega manuale per le scuole, menzionato nel Doc Principale art. 3, non è mai stato implementato — residuo noto), quindi la conferma è sempre un'attestazione dell'operatore/admin backoffice per conto di un accordo raggiunto extra-piattaforma. Un'eventuale conferma pubblica lato associazione resta un'estensione futura.
- **Fase 15 (B.32-36, gestione stagionale post-`definitiva`)**: variazioni ordinarie, indisponibilità sopravvenute, monitoraggio utilizzi, decadenza — task separato futuro, schema già pronto (`indisponibilita_sopravvenute`, `utilizzi_effettivi`, `provvedimenti_mancato_utilizzo`), nessuna logica.
- UI (Fase 5).

## 1. Motore Go — art. B.29, riassegnazione finale

### `PersistiEsitoRoundRobin` — parametrizzazione del `tipo`
`engine-go/internal/postgres/assegnazione.go`: la riga `INSERT INTO elaborazioni (..., tipo, ...) VALUES (..., 'prima_assegnazione', ...)` diventa parametrica (nuovo argomento della funzione, o wrapper dedicato che la richiama con `tipo='riassegnazione_residue'`). Nessun'altra modifica: `caricaFasce` (filtro candidati) e `caricaStatoIniziale` (VA/concentrazione) restano identici e già corretti per il caso "seconda esecuzione dopo concertazione".

### `POST /stagioni/{id}/riassegnazione-residua`
`engine-go/internal/httpapi/`, stesso pattern flat (`mux.HandleFunc`) dei 3 endpoint esistenti. Stessa forma di risposta di `prima-assegnazione`: `{"elaborazione_id", "numero_assegnazioni", "round_eseguiti"}`. Riusa `Server.EseguiRoundRobin` con il nuovo parametro `tipo`.

## 2. Node — chiusura concertazione + coda riassegnazione

### `POST /backoffice/stagioni/:id/riassegnazione-residua`
`richiedeRuolo('admin')`, stesso stile lock/rate-limit/audit di `istruttoria`/`blocchi-gara`/`prima-assegnazione` (`backend-node/src/server.ts`, blocco "coda verso il motore Go"). Sequenza:
1. `pg_try_advisory_xact_lock` per stagione (non bloccante — 409 "elaborazione già in corso" se occupato, stesso motivo delle altre 3 route: non tenere una connessione pool impegnata per l'intera durata del motore).
2. `stagione.stato = 'concertazione'` altrimenti 409.
3. Se esiste ≥1 riga `concertazione_proposte` con `stato='accettata_da_tutti'` per la stagione → 409 (**bloccante**: l'admin deve validare o rigettare ogni proposta accettata da tutte le parti prima di poter chiudere la concertazione — evita che uno scambio già consensuale tra associazioni venga scavalcato silenziosamente dalla riassegnazione algoritmica).
4. `UPDATE concertazione_proposte SET stato='annullata' WHERE stagione_id=$1 AND stato='in_attesa_accettazione'` (bulk — le proposte mai arrivate a piena accettazione decadono automaticamente alla chiusura, art. B.24 "la concertazione è aperta" implica una finestra temporale con una fine).
5. Chiamata al motore (`ClientMotore.eseguiRiassegnazioneResidua`, quarto metodo aggiunto a `backend-node/src/engine/client.ts` sullo stesso modello dei tre esistenti — path `/stagioni/${id}/riassegnazione-residua`, stessa forma di risposta di `eseguiPrimaAssegnazione`).
6. `registraOperazione` (`azione: 'riassegnazione_residua'`, `entitaTipo: 'stagioni_sportive'`).

Nota: lo `stato` della stagione **resta `'concertazione'`** dopo questa chiamata — la transizione a `'definitiva'` è un'azione admin separata e discrezionale (§3), non automatica: l'admin potrebbe voler rivedere l'esito della riassegnazione residua prima di formalizzare il quadro definitivo, o non aver bisogno di eseguirla affatto se non restano fasce libere.

## 3. Node — art. B.30-31, approvazione settimana tipo definitiva

### `POST /backoffice/stagioni/:id/approva-definitiva`
`richiedeRuolo('admin')`. Precondizione: `stato = 'concertazione'` (guardia `UPDATE ... WHERE stato='concertazione'`, 409 altrimenti — nessun'altra precondizione: la riassegnazione residua di §2 è discrezionale, non un prerequisito rigido). Transazione (`eseguiInTransazione`):
1. `UPDATE stagioni_sportive SET stato='definitiva' WHERE id=$1 AND stato='concertazione' RETURNING id` (stessa guardia atomica delle altre transizioni di stato in questo progetto).
2. `INSERT INTO convenzioni (assegnazione_id, istituzione_scolastica_id) SELECT a.id, sp.impianto_id... FROM assegnazioni a JOIN slot_settimana_tipo st ON st.id=a.slot_id JOIN spazi_sportivi sp ON sp.id=st.spazio_id JOIN impianti i ON i.id=sp.impianto_id WHERE st.stagione_id=$1 AND a.stato IN ('provvisoria','validata') AND NOT EXISTS (SELECT 1 FROM convenzioni c WHERE c.assegnazione_id=a.id)` — una riga `convenzioni` (`stato` default `'in_attesa'`) per ogni assegnazione attiva che non ne ha già una (copre tutti i tipi: `singola`/`blocco_allenamento`/`blocco_gara` — B.31 parla genericamente di "ciascuna assegnazione presso una palestra scolastica", nessuna esclusione per tipo).
3. `registraOperazione` (`azione: 'approva_settimana_tipo_definitiva'`, `entitaTipo: 'stagioni_sportive'`, `dettaglio: {numeroConvenzioniCreate}`).

### `PUT /backoffice/convenzioni/:id/conferma`
`richiedeRuolo('admin', 'operatore')`. Nessun body. Guardia atomica: `UPDATE convenzioni SET stato='perfezionata', confermata_il=now(), confermata_da_utente_backoffice_id=$2 WHERE id=$1 AND stato='in_attesa' RETURNING id` (stesso pattern `ammettiDomanda`/`approvaAbilitazione` — 404 se id inesistente, 409 se già `perfezionata`). `registraOperazione` (`azione: 'conferma_convenzione'`, `entitaTipo: 'convenzioni'`).

### `GET /backoffice/stagioni/:id/convenzioni`
`richiedeRuolo('admin', 'operatore')`. Coda di lavoro: lista convenzioni della stagione con filtro opzionale `?stato=in_attesa`, join minima per mostrare associazione+istituzione+slot di ciascuna.

### `GET /pubblico/stagioni/:id/settimana-tipo-definitiva`
`richiedeAutenticazionePubblico`, nessuna restrizione di associazione (stessa trasparenza di B.10/B.23). Precondizione: `stato IN ('definitiva', 'chiusa')` (409 altrimenti). Riusa in larga parte la query già scritta in `propostaProvvisoria.ts::trovaPropostaProvvisoria` (stessa shape: slot/associazione/tipo/valoreMinuti/FR/ISF cumulativo/sorteggioRiferimento — stessa correzione LATERAL del blocco precedente per evitare fan-out), estesa con:
- `concertazioneProposaId` (da `assegnazioni.concertazione_proposta_id`, per mostrare quali fasce derivano da un accordo di concertazione — B.30 "gli accordi intervenuti in fase di concertazione").
- `efficace: boolean` (`convenzioni.stato = 'perfezionata'` per quello slot — join su `convenzioni.assegnazione_id`; `false` se la convenzione non esiste ancora o è `'in_attesa'`).
- Un secondo campo separato `slotLiberi: string[]` (id degli slot della stagione senza alcuna assegnazione attiva) — B.30 "le fasce rimaste disponibili".

## Testing

`node --test` contro Postgres reale, server HTTP vero, motore Go fittizio iniettato via `DipendenzeApp` per i test Node (stesso pattern già in uso per `coda motore Go` del blocco precedente — mai un mock di `fetch`). Scenari minimi:
- Riassegnazione residua: 409 se proposte `accettata_da_tutti` pendenti, auto-annullo delle `in_attesa_accettazione`, chiamata al motore verificata (client fittizio), audit log.
- Approva definitiva: transizione stato, creazione convenzioni per ogni assegnazione attiva (incluse quelle da blocco gara e da concertazione), 409 su doppia approvazione, nessuna convenzione duplicata se già esistente.
- Conferma convenzione: 404/409 su id inesistente/già perfezionata, audit log.
- Settimana tipo definitiva pubblica: 409 prima dell'approvazione, contenuto completo (fasce+blocchi gara+libere+accordi+efficacia) dopo, nessun fan-out sorteggi (stesso test del blocco precedente riapplicato a questo endpoint).
- Motore Go: test Go esistente pattern (`internal/postgres` integration test) esteso con uno scenario "seconda esecuzione dopo concertazione" — verifica che `tipo='riassegnazione_residue'` sia scritto correttamente e che una fascia già assegnata (incl. da concertazione) non venga ricandidata.

## Assunzioni aperte (🔺, non bloccanti — da confermare con l'Ente in Fase 7)

1. Conferma convenzione solo lato backoffice in questo blocco (nessun endpoint pubblico associazione) — le istituzioni scolastiche non hanno accesso diretto alla piattaforma, coerente col residuo noto "iter delega manuale scuole" mai implementato.
2. Chiusura della finestra di concertazione bloccata (409) se restano proposte `accettata_da_tutti` non decise, invece di auto-decisione o auto-annullo — scelta esplicita del committente per evitare che accordi già consensuali tra associazioni vengano scavalcati dalla riassegnazione algoritmica senza intervento admin.
3. `POST approva-definitiva` non richiede che la riassegnazione residua sia stata eseguita — è un'azione discrezionale separata, l'admin può approvare il quadro anche senza rieseguirla.
