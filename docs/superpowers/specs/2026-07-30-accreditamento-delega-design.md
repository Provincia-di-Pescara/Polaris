# Design — Accreditamento associazione + deleghe (blocco 1 del Flusso pubblico)

Data: 2026-07-30. Riferimento: `docs/SPEC.md` Fase 4, punto 5 ("Flusso pubblico"), primo dei 4 sotto-blocchi in cui è stato decomposto (accreditamento+delega → domanda → osservazioni → [già chiuso separatamente: nessuno]).

Normativa: Doc Principale art. 3-4 (accreditamento associazioni, deleghe).

## Obiettivo

Permettere a una persona fisica autenticata via OIDC (SPID/CIE) di:
1. Accreditare una nuova associazione sportiva, diventandone legale rappresentante (soggetto ad approvazione operatore).
2. Caricare documenti a supporto (statuto, atto costitutivo), anche in un secondo momento.
3. Delegare altre persone fisiche sulla stessa associazione, con delega auto-approvata perché il delegante è già stato verificato.
4. Permettere all'operatore di approvare/respingere la prima abilitazione di ogni associazione, e di revocare qualunque abilitazione (con cascata sulle sue sub-deleghe).

## Schema — una migration nuova

`db/migrations/000007_catena_deleghe.up/down.sql`:

```sql
ALTER TABLE abilitazioni
    ADD COLUMN creata_da_abilitazione_id UUID REFERENCES abilitazioni(id);
CREATE INDEX abilitazioni_creata_da_idx ON abilitazioni (creata_da_abilitazione_id);
```

- `NULL` = prima abilitazione di un'associazione (creata insieme all'associazione stessa, unica che passa da approvazione operatore).
- Valorizzato = sub-delega, creata da chi ha l'abilitazione referenziata. Catena arbitrariamente profonda (delegato di un delegato).
- Nessun `ON DELETE CASCADE`: le abilitazioni non si cancellano mai, solo si marcano `revocata` (storico sempre presente, coerente col resto dello schema — vedi `assegnazioni` che tiene lo storico invece di cancellare).

## Storage documenti

Volume Docker named `documenti_associazioni`, montato sul container `backend` (produzione: `docker-compose.yml`; sviluppo: `docker-compose.override.yml`), **mai bind mount** — stesso vincolo già seguito per `postgres_data`/`postgres_backups`.

- Env `DOCUMENTI_STORAGE_PATH` (default `/data/documenti` nel container).
- Upload via `multer` (multipart), `diskStorage` con nome file generato (`randomUUID()` + estensione originale sanificata) per evitare path traversal / collisioni — mai il nome file client-provided usato as-is.
- Limite dimensione: 10 MB per file (statuti/atti costitutivi sono PDF di poche MB), tipo consentito: `application/pdf` solo (controllo su `mimetype` **e** primi byte del file — il mimetype dichiarato dal client non è fidato).
- `associazioni_documenti.file_path` = path relativo dentro il volume (mai il path assoluto host, per portabilità).

## Endpoint

Tutti sotto `richiedeAutenticazionePubblico` (pubblici) o `richiedeAutenticazione` + `richiedeRuolo('admin','operatore')` (backoffice), stesso pattern del CRUD esistente.

### `POST /pubblico/associazioni`
Body: `{ denominazione, codiceFiscalePartitaIva, rnaNumeroIscrizione?, dataCostituzione?, stagioneId }`.
Transazione (`eseguiInTransazione`):
1. INSERT `associazioni`.
2. INSERT `abilitazioni` (persona_fisica_id = `req.persona.sub`, titolo='legale_rappresentante', ruolo='rappresentante', stato='in_attesa', creata_da_abilitazione_id=NULL).
3. `registraOperazione` (azione: `'accreditamento_associazione'`).
Errori: 23505 su `codice_fiscale_partita_iva` → 409 (associazione già accreditata — messaggio suggerisce di usare `/pubblico/deleghe` se si è quella persona); 23503 (stagione inesistente) → 400; zod → 400.

### `POST /pubblico/associazioni/:id/documenti`
Multipart, campo `file` + `tipo` (es. `'statuto'`, `'atto_costitutivo'`). Richiede che il chiamante abbia un'abilitazione attiva (`approvata` o `in_attesa` — anche prima dell'approvazione può completare la pratica) su quella associazione, altrimenti 403. Salva su disco poi INSERT `associazioni_documenti`, `registraOperazione`.
Errori: 404 associazione inesistente; 413 file troppo grande (limite multer); 415 mimetype non consentito; 403 nessuna abilitazione propria su quell'associazione.

### `POST /pubblico/deleghe`
Body: `{ personaFiscaleFiscalCode oppure personaFisicaId, associazioneId, stagioneId, ruolo }` — vedi nota sotto su come si identifica il delegato.
Precondizione: il chiamante ha un'abilitazione **attiva** (stato='approvata', non scaduta/revocata) su quell'associazione+stagione — verificata risalendo `creata_da_abilitazione_id` fino alla radice e controllando che OGNI anello della catena sia `approvata` (non solo l'ultimo: se un antenato è stato revocato, il cascade eager alla revoca dovrebbe già aver marcato tutto sotto come revocata — questo controllo è quindi una query semplice sulla riga diretta del chiamante, il cascade garantisce la coerenza a monte, vedi sotto).
Transazione:
1. INSERT `abilitazioni` (persona_fisica_id target, associazione_id, stagione_id, titolo='delegato', ruolo=body.ruolo, stato='approvata', decisa_il=now(), creata_da_abilitazione_id = id dell'abilitazione del chiamante).
2. `registraOperazione` (azione: `'delega_creata'`).
Errori: 403 chiamante senza abilitazione attiva su quell'associazione+stagione; 409 (unique index esistente `abilitazioni_persona_associazione_attiva_uq`) se il target ha già un'abilitazione attiva/in_attesa su quell'associazione+stagione; 400 zod/23503.

**Nota su come si identifica il delegato**: la persona delegata potrebbe non essersi mai autenticata prima (nessuna riga `persone_fisiche`). Si accetta `codiceFiscale` nel body; se non esiste una `persone_fisiche` con quel CF, se ne crea un record "shell" (oidc_subject/oidc_provider NULL — **richiede rendere quelle due colonne nullable**, oggi `NOT NULL`) che verrà completato al primo login OIDC reale (match per CF). Questo è un cambiamento di schema aggiuntivo rispetto a quanto scritto sopra, va nella stessa migration 000007.

Conseguenza obbligatoria (non rimandabile, il flusso non regge senza): `repository/personeFisiche.ts` — chiamato da `loginPubblico.ts` — oggi fa due lookup in sequenza (per `oidc_subject`, poi per `codice_fiscale`, vedi CLAUDE.md) e se il secondo trova una riga la usa così com'è. Con gli shell record va **aggiornata** quella riga (UPDATE `oidc_subject`/`oidc_provider`/eventualmente `nome`/`cognome` se lo shell li aveva vuoti) invece di trattarla come già completa — altrimenti una persona pre-delegata non potrebbe mai autenticarsi con un `oidc_subject` proprio. Va nel piano come modifica esplicita a `personeFisiche.ts`, non solo ai due endpoint nuovi.

### `PUT /backoffice/deleghe/:id/approva` / `.../respingi`
Solo `richiedeRuolo('admin','operatore')`. 404 se `creata_da_abilitazione_id IS NOT NULL` (le sub-deleghe non passano mai da qui — trattarle come "non trovate" in questo endpoint, non 403, per non rivelare la distinzione a chi non ha i permessi di vederla comunque). 409 se stato non è già `in_attesa`. UPDATE stato + `decisa_il`/`decisa_da` (+ `motivazione` per il rigetto), `registraOperazione`.

### `PUT /backoffice/deleghe/:id/revoca`
Ruolo admin+operatore. Query ricorsiva nella stessa transazione:
```sql
WITH RECURSIVE catena AS (
    SELECT id FROM abilitazioni WHERE id = $1
    UNION ALL
    SELECT a.id FROM abilitazioni a JOIN catena c ON a.creata_da_abilitazione_id = c.id
)
UPDATE abilitazioni SET stato = 'revocata', revocata_il = now(), revocata_da_persona_fisica_id = NULL
WHERE id IN (SELECT id FROM catena) AND stato IN ('in_attesa', 'approvata')
RETURNING id;
```
(`revocata_da_persona_fisica_id` è per revoche fatte da un'altra persona fisica — qui la revoca è dell'operatore, quel campo resta NULL; il tracciamento "chi" è comunque in `log_operazioni` via `registraOperazione` con attore backoffice). `registraOperazione` una riga per ciascuna abilitazione revocata (coerente con la regola generale "audit log = una riga per scrittura reale", stessa applicata ovunque nel CRUD esistente), non una riga aggregata per la cascata.
Errori: 404 se `id` non esiste.

## Testing

Stesso stile del resto del backend: `node --test` contro Postgres reale (`TEST_DATABASE_URL`), fixture con suffissi random, nessun mock del DB. Scenari minimi:
- Creazione associazione + prima abilitazione in_attesa; duplicato CF/PIVA → 409.
- Approvazione/rigetto prima abilitazione; tentativo su una sub-delega → 404.
- Sub-delega da abilitazione approvata → auto-approvata; da abilitazione in_attesa/revocata → 403.
- Catena a 3 livelli (rappresentante → delegato A → delegato B), revoca del livello 1 → verifica che A e B risultino entrambi `revocata`.
- Upload documento: PDF valido salvato + riga DB; mimetype sbagliato → 415; utente senza abilitazione su quell'associazione → 403.
- Persona delegata mai autenticata prima: creazione shell `persone_fisiche`, poi verifica (test separato, se fattibile senza un vero giro OIDC) che un login con lo stesso CF aggiorni la riga invece di crearne una seconda.

## Fuori scope (rimandato)

- **Automazione verifica accreditamento via PDND/Camera di Commercio**: annotata in `docs/SPEC.md` §8 (decisioni aperte) come possibile evoluzione futura per ridurre il carico di approvazione manuale operatore. Non blocca questo blocco.
- Notifiche email su approvazione/rigetto delega (SMTP esiste già per bootstrap, ma non ancora un modulo email generico per l'utenza pubblica) — valutare quando si disegna il resto delle notifiche del procedimento (pubblicazioni B.10/B.23/B.30).
- Domanda (fabbisogni/preferenze/blocchi/giornate gara) e osservazioni: blocchi successivi separati, ciascuno col proprio spec.
