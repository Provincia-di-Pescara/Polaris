# Design — Domanda (presentazione + istruttoria ammissibilità + pubblicazione esiti + osservazioni)

Data: 2026-08-01. Riferimento: `docs/SPEC.md` Fase 4/5, Flusso pubblico blocco 2/4 (dopo blocco 1/4 accreditamento+delega, chiuso). Copre Allegato B fasi 2-3-5: art. B.5-B.6 (presentazione domanda), B.7 (verifica ammissibilità), B.10-B.11 (pubblicazione esiti + osservazioni/riesame). Schema già completo dalla Fase 1 (`domande`, `domanda_discipline`, `preferenze`, `blocchi_allenamento_richiesti`/`blocco_allenamento_slot`, `richieste_giornata_gara`, `osservazioni_istruttoria`) — nessuna migration di schema nuova tranne un sequence per il numero di protocollo (vedi sotto).

Sessione senza il committente presente: procedo con le decisioni più coerenti con i pattern già consolidati nel progetto, segnalando esplicitamente ogni assunzione aperta con 🔺 (stesso trattamento dei placeholder dell'allegato parametrico — da confermare, non blocca lo sviluppo).

## Fuori scope esplicito (residui già noti, non toccati da questo blocco)

- Esecuzione istruttoria/calcolo FR-coefficienti: il motore Go (`POST /stagioni/{id}/istruttoria`) esiste già ma **nessuna route Node lo invoca ancora** ("coda verso l'HTTP del motore Go" è un residuo separato in `docs/SPEC.md`). Questo blocco espone gli esiti se/quando calcolati altrove (LEFT JOIN, valori possono essere NULL), non triggera il calcolo.
- Riesecuzione istruttoria a seguito di un'osservazione accolta: fuori scope, azione amministrativa manuale futura (stesso motivo sopra).
- Modifica di una domanda dopo la presentazione: nessun PUT su contenuto domanda — solo creazione, poi transizioni di stato (ammetti/escludi/osservazioni). Coerente col principio "niente incentivo a dichiarazioni strategiche" (stesso spirito del CSD, art. A.11/B.9).
- `domanda_impianti_compatibili`: tabella esistente nello schema ma **non tra i campi dichiarati dall'art. B.5** (identificativi, disciplina, livello, squadre federali, giornata gara, fasce+ordine, blocchi). Non popolata da questo blocco.
- UI (Fase 5).

## 1. Presentazione domanda — art. B.5-B.6

### `POST /pubblico/domande`
`richiedeAutenticazionePubblico`. Body (zod `schemaCreaDomanda`):

```
associazioneId, stagioneId,
disciplineCodici: string[] (>=1, ogni codice FK discipline_sportive),
classeAttivitaCodice?: string (FK classi_attivita),
livelloCampionato?: 'provinciale'|'regionale'|'interregionale'|'nazionale',
numeroTesserati, numeroAtletiPartecipanti, numeroSquadre, numeroSquadreFederaliStagionePrecedente: int >=0,
attivitaGiovanile, attivitaAgonistica, attivitaParalimpicaInclusiva: boolean (default false),
fabbisognoMinimoMinuti, fabbisognoOttimaleMinuti: decimal-stringa (stesso pattern REGEX_DECIMALE del parametrico, coerente con NUMERIC(10,3)) — refine fabbisognoOttimale >= fabbisognoMinimo (replica CHECK domande_fabbisogno_coerente),
preferenze: string[] (slotId, >=1, univoci) — ordine_preferenza assegnato server-side come posizione nell'array (indice+1), MAI accettato dal client: evita gap/duplicati senza validazione aggiuntiva,
blocchiAllenamento: string[][] (ogni blocco >=2 slotId univoci; ogni slotId del blocco deve comparire anche in preferenze — .superRefine cross-campo, un blocco su fasce non richieste non ha senso),
richiedeGiornataGara: boolean (default false),
richiesteGiornataGara: array (obbligatorio non-vuoto se richiedeGiornataGara=true, vuoto se false — refine cross-campo) di {federazione, campionato, categoria, requisitiTecnici?, necessitaImpiantoOmologato: boolean default true}
```

Autorizzazione: il chiamante deve avere `trovaAbilitazioneAttiva(pool, req.persona.sub, associazioneId, stagioneId)` (stesso helper già usato da `POST /pubblico/deleghe`) — 403 se assente. Nessuna distinzione di ruolo (rappresentante/operatore): entrambi possono presentare domanda per l'associazione che rappresentano, a differenza della sub-delega che distingue i ruoli per privilege escalation — qui non c'è escalation, solo presentazione di un atto per conto dell'associazione.

Un solo `numero_protocollo` per riga, generato server-side (mai dal client — "protocollata automaticamente" art. B.5). 🔺 **Formato scelto** (nessuna indicazione normativa sul formato, solo "protocollata automaticamente" — assunzione tecnica, non richiede conferma Ente essendo un dettaglio implementativo interno): `DOM-<anno-corrente>-<progressivo 6 cifre>`, progressivo da sequence Postgres dedicata (`domande_protocollo_seq`), **migration nuova** `000009_sequenza_protocollo_domande.up/down.sql`.

Vincolo esistente `domande_associazione_stagione_uq` (una domanda per associazione+stagione) → 409 su duplicato (`ErroreValoreDuplicato`, stesso mapping 23505 già in uso).

Transazione (`eseguiInTransazione`): INSERT `domande` (stato default `'presentata'`, `presentata_da_persona_fisica_id = req.persona.sub`) + INSERT multipli `domanda_discipline` + `preferenze` (ordine da posizione) + per ogni blocco: INSERT `blocchi_allenamento_richiesti` poi INSERT multipli `blocco_allenamento_slot` + (se richiede giornata gara) INSERT multipli `richieste_giornata_gara` + `registraOperazione` (`crea_domanda`, attore pubblico, ruolo del delegante trovato). Mapping errori: 23505→409, 22P02/23503→400 (FK su slot/disciplina/classe/associazione/stagione inesistenti), refine zod per i CHECK cross-campo.

### `GET /pubblico/associazioni/:associazioneId/domande`
`richiedeAutenticazionePubblico`, stessa verifica abilitazione attiva del POST (403 se assente). Query opzionale `?stagioneId=`. Ritorna array (al più 1 elemento per stagione data l'unique, ma la route resta a lista per coerenza con `GET /backoffice/impianti/:id/spazi` — filtro stesso stile). Shape completa nested (discipline, preferenze ordinate, blocchi con slot, richieste giornata gara).

### `GET /pubblico/domande/:id`
`richiedeAutenticazionePubblico`. Verifica abilitazione attiva sull'`associazioneId` della domanda trovata (stesso pattern della verifica upload documenti: query diretta `abilitazioni` prima di restituire, 403 se assente, 404 se id inesistente, 400 su UUID malformato).

## 2. Verifica ammissibilità — art. B.7

### `PUT /backoffice/domande/:id/ammetti`
`richiedeRuolo('admin','operatore')`. Nessun body. Precondizione: `stato = 'presentata'` (altrimenti 409 — transizione valida una sola volta, non ri-ammissibile da qui: un eventuale ribaltamento post-osservazione è fuori scope, vedi sopra). UPDATE `stato='ammessa'` + `registraOperazione` (`ammetti_domanda`) in transazione.

### `PUT /backoffice/domande/:id/escludi`
`richiedeRuolo('admin','operatore')`. Body `{motivazione}` (zod, min 10 caratteri — stesso ordine di grandezza già usato per `schemaRespingiDelega`). Stessa precondizione `stato='presentata'` → 409. UPDATE `stato='esclusa'`, `motivazione_esclusione` + `registraOperazione` (`escludi_domanda`).

### `GET /backoffice/domande` / `GET /backoffice/domande/:id`
`richiedeRuolo('admin','operatore')`. Lista con filtro opzionale `?stagioneId=`; dettaglio con shape nested completa (stessa del GET pubblico) + LEFT JOIN `fabbisogni_riconosciuti`/`coefficienti_associazione` se già calcolati (nullable — istruttoria è un passo separato, vedi fuori-scope). Mapping 22P02 su `:id` (residuo di altre route corretto in blocchi precedenti — qui applicato fin da subito).

## 3. Pubblicazione esiti — art. B.10

### `GET /pubblico/stagioni/:stagioneId/domande/esiti`
`richiedeAutenticazionePubblico` (nessuna restrizione alla propria associazione: B.10 è trasparenza pubblica dell'intera procedura, coerente con "riproducibile da terzi" art. 28 Doc Principale / art. B.1). Ritorna solo domande **decise** (`stato IN ('ammessa','esclusa','riesame_richiesto','riesame_deciso')`, esclude `'presentata'` — non ancora istruita, nulla da pubblicare): `{domandaId, associazioneId, stato, motivazioneEsclusione, fabbisognoRiconosciuto: {frFinaleMinuti,...} | null, coefficienti: {crs,caa,csd,cp} | null}`. Valori NUMERIC sempre stringa (stesso pattern parametrico).

## 4. Osservazioni e riesame — art. B.11

### `POST /pubblico/domande/:id/osservazioni`
`richiedeAutenticazionePubblico`. Verifica abilitazione attiva sull'associazione della domanda (403 se assente, stesso pattern). Precondizione: `domande.stato IN ('ammessa','esclusa','riesame_richiesto')` (esito già pubblicato — coerente con B.10/B.11: non si osserva una domanda non ancora istruita) → 409 se `'presentata'`. Body `{testo}` (zod, min 10 caratteri). Transazione: INSERT `osservazioni_istruttoria` (`stato='in_esame'`, `presentata_da_persona_fisica_id=req.persona.sub`) + UPDATE `domande SET stato='riesame_richiesto'` **solo se** stato attuale ≠ `'riesame_richiesto'` (idempotente: più osservazioni sulla stessa domanda da persone diverse non richiedono transizioni multiple, e non regrediscono uno stato già `'riesame_richiesto'`) + `registraOperazione` (`presenta_osservazione`).

### `PUT /backoffice/osservazioni/:id/accogli` / `PUT /backoffice/osservazioni/:id/respingi`
`richiedeRuolo('admin','operatore')`. Precondizione: `osservazioni_istruttoria.stato='in_esame'` → 409 altrimenti. Body: `respingi` richiede `{motivazione}` (min 10), `accogli` nessun body obbligatorio. UPDATE `osservazioni_istruttoria` (`stato`, `decisa_il=now()`, `decisa_da=req.utente.sub`, `decisione_motivazione` se presente) dentro transazione. Dopo l'update: se **nessun'altra** osservazione della stessa domanda resta `'in_esame'` (query di conteggio nella stessa transazione), UPDATE `domande SET stato='riesame_deciso'` (consolidamento — coerente con B.11 "i valori così consolidati non sono ulteriormente contestabili"). `registraOperazione` (`accogli_osservazione`/`respingi_osservazione`).

## Testing

`node --test` contro Postgres reale, server HTTP vero, nessun mock. Scenari minimi per task (dettaglio nel piano):
- Presentazione domanda: creazione completa con discipline/preferenze/blocchi/giornata gara, 403 senza abilitazione, 409 doppia domanda stessa stagione, 400 su fabbisogno incoerente/blocco con slot non in preferenze/richiesteGiornataGara vuoto con richiedeGiornataGara=true, protocollo generato e univoco.
- Lettura pubblica propria domanda: 403 su associazione altrui, 404/400 su id.
- Ammetti/escludi: 403 pubblico (route backoffice), 409 su doppia transizione, audit log verificato.
- Pubblicazione esiti: solo domande decise, valori coefficienti NULL quando istruttoria non eseguita, 403 operatore NON si applica qui (endpoint pubblico, non backoffice — nessuna restrizione di ruolo).
- Osservazioni: 409 su domanda ancora `'presentata'`, transizione domanda→riesame_richiesto poi riesame_deciso dopo decisione di tutte le osservazioni aperte, 403 operatore/admin invertito (pubblico non può decidere, backoffice non può presentare).

## Assunzioni aperte (🔺, non bloccanti — da confermare con l'Ente in Fase 7)

1. Formato numero di protocollo (`DOM-YYYY-NNNNNN`) — dettaglio tecnico, non normativo.
2. Nessuna distinzione di ruolo (rappresentante/operatore) per la presentazione domanda o per l'osservazione — il testo B.5/B.11 dice "l'associazione" senza distinguere, a differenza della sub-delega dove la distinzione emerge dalla logica di privilege escalation, non dal testo.
3. Ribaltamento esito dopo osservazione accolta (es. da `esclusa` a `ammessa`) non modellato in questo blocco: l'endpoint di decisione osservazione consolida lo stato (`riesame_deciso`) ma non tocca `stato` originale ammessa/esclusa — un'eventuale azione correttiva resta manuale/futura.
