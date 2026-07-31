# Design — CRUD utenti backoffice (invito via email, reset password, protezione ultimo admin)

Data: 2026-07-31. Riferimento: `docs/SPEC.md` Fase 4, item 3 (parte "utenti backoffice" mai chiusa nonostante lo strikeout iniziale del checklist — gap reale, stesso caso già risolto per OIDC). Priorità decisa col committente: seconda parte del blocco admin dopo `impostazioni/oidc`.

## Scope

Gestione degli account `utenti_backoffice` (admin/operatore) da parte di un admin: creazione via invito email, lista/dettaglio, modifica anagrafica/ruolo, attivazione/disattivazione, reset password. Nessuna modifica di schema: le colonne `token_verifica_hash`/`token_verifica_scade_il` (migration `000005`, CHECK "token presente ⟺ stato = `in_attesa_verifica`") già coprono sia l'invito sia il reset, essendo generiche per costruzione.

## Decisioni chiuse col committente

1. **Chi sceglie la password di un nuovo utente**: l'invitato, non l'admin. L'admin fornisce solo `email`/`nome`/`cognome`/`ruolo`; il sistema genera un token, invia un'email con link, l'invitato imposta la propria password al primo accesso. L'admin non conosce mai una password altrui.
2. **Protezione ultimo admin**: vietato disattivare se stessi o l'ultimo admin attivo rimasto; stessa protezione estesa alla modifica di ruolo (non si può declassare l'ultimo admin attivo a `operatore`) — stesso rischio di lockout, stessa regola.
3. **Reset password**: riusa il meccanismo dell'invito (stesso token, stesso flusso "imposta password al link"), non un concetto nuovo. Le sessioni attive dell'utente vengono revocate quando un reset viene richiesto (sicurezza: se la password è compromessa o l'utente l'ha dimenticata su richiesta di un admin, le sessioni esistenti non devono restare valide).

## Endpoint

Tutti `richiedeAutenticazione` + `richiedeRuolo('admin')` (dato sensibile, mai `operatore`), tranne l'ultimo che è pubblico per costruzione (l'invitato non ha ancora credenziali).

### `POST /backoffice/utenti`
Body `{email, nome, cognome, ruolo: 'admin'|'operatore'}`. Transazione: INSERT `utenti_backoffice` (`stato='in_attesa_verifica'`, `password_hash` placeholder non utilizzabile — vedi nota tecnica sotto, `token_verifica_hash`/`token_verifica_scade_il` valorizzati, `creato_da` = admin chiamante), invio email invito, `registraOperazione` (`crea_utente_backoffice`). 409 su email duplicata (23505).

**Nota tecnica — `password_hash` prima dell'attivazione**: la colonna è `NOT NULL` nello schema. Finché l'utente non completa l'invito non esiste una password reale da hashare. Soluzione: un valore sentinella non verificabile (`hashPassword` applicato a `randomBytes(32).toString('hex')`, mai comunicato, mai loggato) — stesso trucco già implicito nel flusso di bootstrap (che invece riceve la password vera fin dalla richiesta, quindi non ha questo problema, ma qui la richiesta arriva senza password). Login con un account `in_attesa_verifica` è comunque bloccato indipendentemente dall'hash: verificato che `auth/login.ts:47` controlla `utente.stato !== 'attivo'` **prima** di `verificaPassword` (riga 57) — nessuna modifica necessaria lì, il sentinella è già irraggiungibile per costruzione.

### `GET /backoffice/utenti` / `GET /backoffice/utenti/:id`
Lista completa / singolo. Nessun campo sensibile esposto (mai `password_hash`, mai `token_verifica_hash`).

### `PUT /backoffice/utenti/:id`
Body `{nome, cognome, ruolo}`. Se `ruolo` passa da `admin` a `operatore` e il target è l'ultimo admin attivo → 409. `registraOperazione` (`aggiorna_utente_backoffice`).

### `PUT /backoffice/utenti/:id/stato`
Body `{stato: 'attivo'|'disattivato'}`. 409 se il target è il chiamante stesso, o se `stato='disattivato'` e il target è l'ultimo admin attivo rimasto (query di conteggio `admin`+`attivo` esclusi il target, dentro la stessa transazione della UPDATE per evitare race). `registraOperazione` (`cambia_stato_utente_backoffice`).

### `POST /backoffice/utenti/:id/reset-password`
Nessun body. Rigenera token (stesso TTL 24h del bootstrap), UPDATE `stato='in_attesa_verifica'` + nuovi `token_verifica_hash`/`token_verifica_scade_il`, invia nuova email, **revoca tutte le sessioni attive** dell'utente target (nuova funzione `revocaSessioniUtente(pool, utenteId)` in `repository/sessioni.ts` — oggi esiste solo `revocaSessione(pool, id)` per singola sessione). `registraOperazione` (`richiedi_reset_password_utente_backoffice`).

### `POST /backoffice/utenti/accetta-invito`
**Pubblico** (nessun `richiedeAutenticazione`: l'invitato non ha ancora un JWT). Body `{token, password}` (password ≥ 12 caratteri, stessa soglia del bootstrap). Verifica hash SHA-256 del token + scadenza (stesso pattern di `bootstrapAdmin.ts`, ma modulo nuovo e indipendente — non condivide codice con quel flusso, che resta specifico del primo admin), UPDATE `password_hash`+`stato='attivo'`+pulizia token, `registraOperazione` (`accetta_invito_utente_backoffice`, attore = l'utente stesso appena attivato). Token one-shot: dopo l'uso il CHECK di coerenza impone che i campi token tornino NULL insieme a `stato≠in_attesa_verifica`, quindi un riuso del link fallisce per costruzione (token già NULL in DB → nessuna riga corrisponde).

## Email

Sempre `creaTrasportoDaEnv()`/`inviaEmail()` (`src/email/smtp.ts`) — unico SMTP del sistema, mai un secondo store DB (coerente con la decisione presa nel blocco `impostazioni/oidc`: un solo server, config sempre in `.env`). Link nell'email: `${BACKOFFICE_BASE_URL}/utenti/accetta-invito?token=...` (stessa env già usata dal bootstrap).

## Testing

`node --test` contro Postgres reale, server HTTP vero, mai mock. Scenari minimi:
- Creazione utente → email inviata (verificata via Mailpit), token salvato hashato, login con l'account prima dell'attivazione rifiutato.
- Flusso completo: crea → estrai token dall'email (Mailpit) → accetta-invito → login riuscito.
- 403 operatore su ogni endpoint.
- 409 email duplicata; 409 auto-disattivazione; 409 disattivazione ultimo admin; 409 declassamento ultimo admin a operatore.
- Reset password: nuovo token generato, vecchie sessioni non più valide (refresh con token pre-reset rifiutato), login con vecchia password non più valido dopo l'accettazione del nuovo invito.
- Token scaduto/malformato/riusato → 400/401 su `accetta-invito`.

## Fuori scope

- Lockout per-account sui tentativi di login falliti (già annotato come residuo separato in `docs/SPEC.md`).
- UI backoffice per questi endpoint (Fase 5).
- Cancellazione fisica di un utente backoffice (solo disattivazione — coerente con l'assenza di DELETE fisici altrove nel dominio, es. abilitazioni).
