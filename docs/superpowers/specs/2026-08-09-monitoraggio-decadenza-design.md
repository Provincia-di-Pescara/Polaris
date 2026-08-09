# Monitoraggio utilizzo effettivo + escalation mancato utilizzo — design

**Riferimento normativo**: Allegato B, artt. B.34 (rilevazione dell'utilizzo effettivo), B.35 (mancato utilizzo), B.36 (effetti sulle stagioni successive) — Fase 15, secondo blocco (il primo, indisponibilità sopravvenute B.33 + variazioni ordinarie B.32, è già chiuso).

## Contesto

Lo schema per questo blocco esiste già dalla Fase 1 (`utilizzi_effettivi`, `provvedimenti_mancato_utilizzo`, colonne `soglia_mancati_utilizzi_diffida`/`soglia_mancati_utilizzi_decadenza`/`soglia_scostamento_dichiarato_pct` in `parametrico_versioni`) ma nessuna logica applicativa lo usa ancora.

Testo normativo (estratto):
- **B.34**: "L'utilizzo effettivo delle fasce assegnate è rilevato con le modalità definite dall'Amministrazione tra le seguenti, anche in combinazione: registro tenuto dal personale addetto all'impianto; autodichiarazione dell'associazione con controlli a campione; check-in digitale."
- **B.35**: "Al mancato utilizzo non giustificato di una fascia assegnata conseguono, in via graduata: la richiesta di giustificazione all'associazione; la diffida, al superamento del numero di mancati utilizzi stabilito nell'allegato parametrico; la decadenza dalla fascia, disposta con provvedimento motivato; lo spazio torna a disposizione quale fascia libera, utilizzabile secondo le regole delle variazioni ordinarie e della concertazione (artt. B.25 e B.32)."
- **B.36**: "Lo storico di utilizzo effettivo concorre alla determinazione dei coefficienti delle stagioni successive. Lo scostamento significativo e non giustificato tra i dati dichiarati in domanda e l'utilizzo rilevato comporta la penalizzazione dei coefficienti secondo l'allegato parametrico."

## Decisioni di scope (prese col committente)

1. **B.36 — solo storico interrogabile in questo blocco.** L'aggancio al calcolo dei coefficienti (verosimilmente CSD, art. A.11) è rimandato alla Fase 7 (taratura CSD, già segnata come lavoro futuro in CLAUDE.md) — collegare lo storico a un coefficiente non ancora formulato sarebbe prematuro. Questo blocco rende l'utilizzo effettivo interrogabile ma non modifica il motore Go né alcun calcolo.
2. **B.34 — solo modalità "registro impianto" in questo blocco.** `rilevato_tramite` resta fisso a `'registro_impianto'`; le altre due modalità (autodichiarazione con controlli a campione, check-in digitale) sono rimandate — lo schema (`CHECK` su `rilevato_tramite`) le ammette già, nessuna migrazione futura necessaria per estenderle.
3. **Giustificazione — flusso a due fasi.** Il backoffice registra sempre l'esito grezzo (incluso `non_utilizzato_non_giustificato` per un mancato utilizzo non ancora valutato); l'associazione può presentare una giustificazione via API pubblica entro una finestra temporale; il backoffice accoglie (derubrica a `non_utilizzato_giustificato`) o rigetta.
4. **Finestra di giustificazione — nuovo parametro versionato** (🔺 placeholder, non specificato dalla norma che rimanda a "termine indicato nell'avviso" per un caso analogo, B.11).
5. **Emissione diffida/decadenza — manuale.** Il sistema segnala quando una soglia è raggiunta (coda backoffice); l'operatore emette esplicitamente il provvedimento. Non automatico: B.35 parla di "provvedimento motivato" per la decadenza, un atto amministrativo, non un effetto automatico.

## Schema — migration `000015`

```sql
ALTER TABLE parametrico_versioni
  ADD COLUMN termine_giustificazione_giorni INTEGER NOT NULL DEFAULT 7;

ALTER TABLE utilizzi_effettivi
  ADD COLUMN giustificazione_scade_il TIMESTAMPTZ,
  ADD COLUMN giustificazione_testo TEXT,
  ADD COLUMN giustificazione_presentata_il TIMESTAMPTZ,
  ADD COLUMN giustificazione_decisa_da UUID REFERENCES utenti_backoffice(id),
  ADD COLUMN giustificazione_decisa_il TIMESTAMPTZ;
```

Note:
- Nessuna modifica al `CHECK` esistente su `esito` (4 valori invariati: `utilizzato`, `non_utilizzato_giustificato`, `non_utilizzato_non_giustificato`, `indisponibilita_impianto`). Lo stato "giustificazione in corso" è rappresentato dalle colonne sopra (in particolare `giustificazione_scade_il IS NOT NULL AND giustificazione_decisa_il IS NULL` = finestra aperta), **non** da un quinto valore di `esito` — evita di allargare un enum che un filtro esatto altrove potrebbe non coprire (stessa classe di bug già vista con `domande.stato`/`riesame_stato`, risolta allora con una colonna separata invece che con valori aggiuntivi nello stesso campo).
- `provvedimenti_mancato_utilizzo` riusata as-is, nessuna modifica: ha già `tipo IN ('richiesta_giustificazione', 'diffida', 'decadenza')`.
- `assegnazioni.stato` ha già `'decaduta'` nel `CHECK` esistente (migration `000001`) — la decadenza è un `UPDATE` guardato, nessuna migrazione su quella tabella.
- `soglia_mancati_utilizzi_diffida`/`_decadenza` e `soglia_scostamento_dichiarato_pct` già esistono (migration `000001`) e sono già esposte via `POST/GET /backoffice/parametrico` — nessuna modifica a quell'endpoint.

## Repository

Due file nuovi, stesso stile di `indisponibilita.ts`/`variazioni.ts` (funzioni pure su `Db`, nessuna apertura di transazione propria):

- `backend-node/src/utilizziEffettivi.ts`: `registraUtilizzo`, `trovaUtilizzoPerId`, `listaUtilizziPerAssegnazione`, `listaUtilizziPerAssociazione` (pubblica, scoped stagione), `presentaGiustificazione`, `accogliGiustificazione`, `rigettaGiustificazione`.
- `backend-node/src/provvedimenti.ts`: `creaProvvedimento` (uso interno per `richiesta_giustificazione` automatica + uso da route per `diffida`/`decadenza`), `listaProvvedimentiPerAssegnazione`, `codaMancatiUtilizzi(db, associazioneId, stagioneId)` — aggrega per assegnazione i mancati-utilizzi "definitivi" (finestra scaduta senza presentazione, oppure giustificazione rigettata) e li confronta con le soglie del parametrico attivo.

## Endpoint

**Backoffice** (`richiedeRuolo('admin', 'operatore')` salvo diversa indicazione):

1. `POST /backoffice/assegnazioni/:id/utilizzi` — `{data, esito, note?}`. Se `esito='non_utilizzato_non_giustificato'`: imposta `giustificazione_scade_il = now() + termine_giustificazione_giorni` (dal parametrico attivo) e crea, nella stessa transazione, un `provvedimenti_mancato_utilizzo` tipo `richiesta_giustificazione` (`emesso_da` = l'operatore che registra).
2. `GET /backoffice/assegnazioni/:id/utilizzi` — storico per assegnazione.
3. `PUT /backoffice/utilizzi/:id/accogli-giustificazione` — richiede `giustificazione_presentata_il IS NOT NULL` e `giustificazione_decisa_il IS NULL` (409 altrimenti); imposta `esito='non_utilizzato_giustificato'`, registra decisore/data.
4. `PUT /backoffice/utilizzi/:id/rigetta-giustificazione` — `{motivazione}`; stesse guardie di (3); `esito` resta `non_utilizzato_non_giustificato`, registra decisione.
5. `GET /backoffice/associazioni/:id/mancati-utilizzi?stagioneId=` — coda aggregata (vedi `codaMancatiUtilizzi` sopra).
6. `POST /backoffice/assegnazioni/:id/provvedimenti` — `{tipo: 'diffida'|'decadenza', motivazione}` (mai `richiesta_giustificazione`, quella è automatica al punto 1). Per `decadenza`: `UPDATE assegnazioni SET stato='decaduta' WHERE id=$1 AND stato IN ('provvisoria','validata')` nella stessa transazione — guardia atomica stile TOCTOU-safe già usato altrove (`UPDATE...WHERE...RETURNING`), 409 (`ErroreStatoNonValidoPerTransizione`) se l'assegnazione non è più in uno stato decadibile. Lo slot liberato ridiventa visibile a `trovaProprietarioOccorrenza` (`variazioni.ts`, blocco precedente) come libero, senza alcuna modifica a quel file.
7. `GET /backoffice/assegnazioni/:id/provvedimenti` — storico provvedimenti per assegnazione.

**Pubblico** (`richiedeAutenticazionePubblico`):

8. `POST /pubblico/utilizzi/:id/giustificazione` — `{testo}`. Verifica abilitazione attiva della persona sull'associazione titolare dell'assegnazione, scoped per la stagione (stesso pattern sempre usato in questo progetto, mai senza `stagione_id` — vedi CLAUDE.md, bug storico noto). Guardia atomica: `esito='non_utilizzato_non_giustificato'`, `giustificazione_presentata_il IS NULL`, `giustificazione_scade_il > now()` — 409 altrimenti (finestra scaduta, già presentata, o esito non pertinente).
9. `GET /pubblico/associazioni/:id/utilizzi?stagioneId=` — lettura storico, trasparenza (stesso pattern di indisponibilità/variazioni del blocco precedente).

## Errori

Pattern consolidato del progetto: `ErroreNonTrovato`→404, `ErroreStatoNonValidoPerTransizione`→409, `comeErroreRiferimentoNonValido`→400 (UUID malformato/FK inesistente), validazione zod→400. Ogni scrittura dentro `eseguiInTransazione` + `registraOperazione` (art. B.39) con azioni distinte per tipo di operazione (`registra_utilizzo_effettivo`, `accoglie_giustificazione`, `rigetta_giustificazione`, `emette_provvedimento_mancato_utilizzo`).

## Testing

Stesso approccio del progetto: `node --test` contro Postgres reale (`TEST_DATABASE_URL`), fixture con `randomUUID()`, nessun mock. Scenari da coprire:
- Registrazione utilizzo con tutti e 4 gli esiti.
- Apertura finestra giustificazione su `non_utilizzato_non_giustificato`, non su altri esiti.
- Presentazione giustificazione: entro finestra (ok), dopo scadenza (409 — fixture con `giustificazione_scade_il` esplicitamente nel passato, pattern CHECK-scadenza già visto altrove in questo progetto), doppia presentazione (409).
- Accoglimento/rigetto: guardie su stato non pertinente.
- `codaMancatiUtilizzi`: conteggio corretto (esclude finestre ancora aperte, include scadute/rigettate), confronto con soglie parametriche.
- Emissione diffida (nessun effetto su `assegnazioni.stato`) e decadenza (`assegnazioni.stato='decaduta'`, guardia su doppia decadenza, verifica che lo slot risulti libero per `trovaProprietarioOccorrenza`).
- Autorizzazione scoped per stagione su tutte le route pubbliche (stesso bug-pattern storico da evitare).

## Fuori scope esplicito

- Autodichiarazione/check-in digitale (altre 2 modalità B.34).
- Aggancio calcolo CSD/coefficienti stagione successiva (B.36) — richiede prima la taratura CSD (Fase 7).
- Ricalcolo automatico di `caa_neutro`/altri coefficienti per prima-stagione basato su storico.
- UI (Fase 5, non ancora collegata).
- Modifiche al motore Go.
