# Estensione anagrafica associazioni (Associazioni_Documenti.docx) — Design

## Contesto

Nuovo documento di riferimento fornito dal committente (2026-08-17): `documenti/Associazioni_Documenti.docx`, titolo interno "CAMPI CHE DEVONO ESSERE PREVISTI NELLA PIATTAFORMA". Non fa parte dei tre documenti normativi già elencati in CLAUDE.md (Documento Principale, Allegato A, Allegato B) — va aggiunto all'elenco "Documenti di riferimento" alla chiusura di questo blocco.

Il documento elenca i campi che l'anagrafica di un'associazione richiedente deve raccogliere, ben più ampi dello schema `associazioni` attuale (`denominazione`, `codice_fiscale_partita_iva`, `rna_numero_iscrizione`, `data_costituzione`) e del form `AccreditamentoDelegaView` appena collegato alle API reali.

**Chiarimenti ottenuti dal committente durante questo brainstorming** (non nel documento, comunicati a voce):
- Le 8 categorie di soggetti richiedenti elencate nel documento sono **tutte ammesse** (nessuna esclusione, nonostante l'assenza di un marcatore visivo nel documento tra le prime 6 e le ultime 2 — verificato che non c'è differenza di formattazione nell'XML sorgente, la distinzione andava comunque chiarita col committente).
- **Solo le "associazioni sportive" fanno domanda stagionale** (il flusso fabbisogno/ISF/round-robin/settimana-tipo già costruito nei blocchi 1-4). Le altre 7 categorie fanno solo "richieste spot", un flusso diverso non ancora documentato — **esplicitamente fuori scope per questo blocco** (vedi "Fuori scope" sotto).
- Il DAE dichiarato nel form (marca/matricola/scadenza, un solo referente "emergenze") è un dato anagrafico statico dell'associazione — **non** implementa la regola operativa completa comunicata a voce ("un DAE disponibile per ogni prenotazione, più DAE se in uso contemporaneo su due palestre, eccezionalmente un accordo con la scuola per usare il suo") — quella regola riguarda la disponibilità al momento della prenotazione/assegnazione slot, un concetto diverso e più complesso, esplicitamente fuori scope qui.

## Campi del documento → schema

**Soggetti richiedenti** (8 categorie, tutte ammesse): associazioni sportive affiliate CONI, cooperative/enti promozione sportiva CONI, enti promozione culturale/giovanile/anziani, enti assistenza handicap/volontariato, soggetti singoli/società no-profit per funzione scuola, OO.SS. (solo riunioni sindacali personale scolastico), movimenti/partiti politici, gruppi cittadini/privati/circoli.

**Anagrafica**: ragione sociale (già `denominazione`), Rappresentante Legale (nome/cognome), Delegato ad agire per conto del RL (nome/cognome, opzionale), CF (già presente), P.IVA (già `codice_fiscale_partita_iva`, uno stesso campo copre entrambi i formati per convenzione già in uso), indirizzo (via/civico/città), PEC, email.

**Documenti soggetto**: Atto Costitutivo, Statuto — già coperti dall'enum `tipo` esistente su `associazioni_documenti` (`'statuto'|'atto_costitutivo'|'altro'`), nessuna modifica necessaria. Iscrizione RASD (sì/no) → se sì: organismo sportivo affiliato (dropdown, ~80 sigle) + codice di affiliazione.

**Assicurazione**: RCT (Responsabilità Civile verso Terzi) sempre obbligatoria — compagnia, agenzia (opzionale), numero polizza, massimale, periodo copertura (dal/al). RCO (Responsabilità Civile verso Operai) solo se l'associazione ha personale assunto — stessa struttura di campi.

**Responsabile sicurezza sui luoghi di lavoro** (D.Lgs. 81/2008): nome/cognome, nato a/il, residente in (via/città), cellulare, carta d'identità.

**Responsabile emergenze e gestione/manutenzione DAE**: stessi campi anagrafici del responsabile sicurezza, più DAE (marca, numero di serie, scadenza).

## Schema dati

Estende `associazioni` con nuove colonne dirette (1:1, sempre presenti al più una riga per associazione):
- `rappresentante_legale_nome`, `rappresentante_legale_cognome` (obbligatori)
- `delegato_nome`, `delegato_cognome` (nullable — presenti insieme o assenti insieme, CHECK di coerenza stile `num_nonnulls` già in uso nel progetto)
- `indirizzo_via`, `indirizzo_civico`, `indirizzo_citta` (obbligatori)
- `pec` (nullable), `email` (obbligatoria — stesso `z.string().email()` già in uso in `backofficeSchema.ts`)
- `tipologia_soggetto` (CHECK, 8 valori — enum applicativo zod + CHECK DB, stesso pattern di `abilitazioni.ruolo`)
- `iscritta_rasd` (boolean)
- `organismo_sportivo_codice` (FK nullable verso nuova tabella `organismi_sportivi`, obbligatoria se `iscritta_rasd = true` — `.superRefine()` zod cross-campo, stesso pattern già in uso per i blocchi allenamento ⊆ preferenze nel blocco 2/4)
- `codice_affiliazione` (nullable, stesso vincolo di `organismo_sportivo_codice`)
- `ha_personale_assunto` (boolean, gate per l'obbligatorietà della riga assicurativa RCO)

Nuova tabella lookup **`organismi_sportivi`** (`codice TEXT PRIMARY KEY`, `denominazione TEXT`), seedata via migration con le ~80 sigle del documento (ACI, ACSI, AICS, ... UISP, VSS) — stesso pattern di `classi_attivita`/`crs_scaglioni` (dato normativo di riferimento, seed via migration, non un enum hardcoded lato applicativo).

Nuova tabella figlia **`associazioni_referenti`** (`id`, `associazione_id` FK CASCADE, `tipo` CHECK `'sicurezza'|'emergenze_dae'`, `nome`, `cognome`, `nato_a`, `nato_il` DATE, `residente_via`, `residente_citta`, `cellulare`, `carta_identita`, `dae_marca`/`dae_matricola`/`dae_scadenza` DATE — questi ultimi tre NULL a meno che `tipo = 'emergenze_dae'`, CHECK di coerenza). Esattamente due righe per associazione completa (una per tipo), non enforced a livello DB (una terza riga duplicata sarebbe un bug applicativo, non un vincolo dati — stesso trade-off già accettato altrove nel progetto per relazioni a cardinalità fissa gestite dall'applicazione).

Nuova tabella figlia **`associazioni_assicurazioni`** (`id`, `associazione_id` FK CASCADE, `tipo` CHECK `'rct'|'rco'`, `compagnia`, `agenzia` nullable, `numero_polizza`, `massimale` NUMERIC(12,2) — mai float, coerente col vincolo di progetto sui valori monetari/decimali — `copertura_dal`/`copertura_al` DATE). RCT sempre presente, RCO solo se `associazioni.ha_personale_assunto = true` (validato in `.superRefine()` zod, non un CHECK DB — dipende da un campo di un'altra tabella).

## Validazione cross-campo: Rappresentante Legale vs Delegato vs persona OIDC

Il documento prevede che il modulo possa essere compilato da un **Delegato ad agire per conto del RL**, non necessariamente dal RL stesso. Il sistema esistente assegna sempre `titolo = 'legale_rappresentante'` alla persona OIDC che sottoscrive `POST /pubblico/associazioni` (`creaAbilitazionePrincipale`), indipendentemente da questi due campi anagrafici — quella logica **non cambia** in questo blocco (l'abilitazione tecnica di chi sottoscrive resta un concetto separato dai due campi anagrafici del modulo).

Aggiunta però una validazione anti-frode a integrazione del `POST /pubblico/associazioni`:
- Se `delegato_nome`/`delegato_cognome` sono compilati: `req.persona.nome`/`req.persona.cognome` (claim OIDC reali, non il body) devono combaciare con essi (confronto case-insensitive, trim) — altrimenti 400.
- Se assenti: `req.persona.nome`/`req.persona.cognome` devono combaciare col Rappresentante Legale dichiarato — altrimenti 400.

Garantisce che chi sottoscrive il modulo sia realmente la persona che il modulo stesso dichiara stia agendo (RL o delegato), coerente con l'art. 53 Doc Principale (tracciabilità della vera persona fisica operante).

## API

- `GET /organismi-sportivi` (nuovo, pubblico, non autenticato — stesso livello di `GET /stagioni`): lista `{codice, denominazione}` per il dropdown RASD.
- `schemaCreaAssociazione`/`creaAssociazione` estesi con tutti i nuovi campi (obbligatori/opzionali come sopra) + le due righe `associazioni_referenti` + la/le riga/e `associazioni_assicurazioni`, tutto nella stessa transazione della creazione associazione (`eseguiInTransazione`, coerente col pattern già in uso).

## Frontend

`AccreditamentoDelegaView` (il form di creazione nuova associazione, appena collegato alle API reali nel blocco precedente) esteso con le nuove sezioni: anagrafica estesa (indirizzo/PEC/email/RL/delegato), select tipologia soggetto (8 opzioni), toggle RASD + select organismo sportivo condizionale, sezione assicurazione RCT (sempre) + RCO (condizionale a un nuovo checkbox "ha personale assunto"), due sotto-form referenti (sicurezza / emergenze+DAE).

## Testing

Backend: nuove migration validate contro Postgres reale (CHECK di coerenza, FK); `associazioni.test.ts`/`server.pubblico.test.ts` estesi con gli scenari nuovi (RCO obbligatoria/assente coerentemente con `ha_personale_assunto`, organismo sportivo obbligatorio/assente coerentemente con `iscritta_rasd`, validazione incrociata RL/delegato/persona OIDC con tutti e 3 gli esiti — match RL, match delegato, mismatch → 400). Frontend: form esteso, stesso pattern di test già stabilito (mock + `.realBackend.test.tsx`).

## Fuori scope

- **Flusso "richiesta spot"** per le 7 categorie di soggetti non-sportivi (nessun documento normativo lo descrive ancora) — nessun enforcement in questo blocco: `tipologia_soggetto` resta un campo anagrafico informativo, `POST /pubblico/domande` resta raggiungibile da chiunque abbia un'abilitazione approvata, indipendentemente dalla categoria. Residuo noto da riprendere quando il flusso sarà specificato.
- **Regola operativa DAE completa** (disponibilità per-prenotazione, DAE multipli, accordo con la scuola) — il campo DAE di questo blocco resta un dato anagrafico statico del responsabile emergenze, non collegato al flusso di prenotazione/assegnazione slot.
- Aggiornamento di `CLAUDE.md`/`docs/claude/*.md` con il nuovo documento di riferimento e il changelog del blocco — alla chiusura, come da convenzione.
- **UI backoffice per visualizzare i dettagli di accreditamento** (RCT/RCO, referenti sicurezza/emergenze+DAE): la code review finale del branch (Finding 3) ha aggiunto solo l'endpoint di lettura `GET /backoffice/associazioni/:id/dettagli-accreditamento` — l'operatore che vaglia un accreditamento non ha ancora una schermata che mostri questi dati, resta un blocco futuro.
