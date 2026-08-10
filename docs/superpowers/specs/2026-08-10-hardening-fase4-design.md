# Hardening Fase 4 residuo — design

**Riferimento**: residuo esplicito segnato in CLAUDE.md/SPEC.md dalla Fase 4 (Backend Node): "CORS/security headers, lockout per-account sui tentativi falliti (richiederebbe altre colonne schema)". Il secondo punto è ora fattibile senza nuove colonne (vedi sotto). Nessun riferimento normativo (Allegato A/B) — tutte e tre le modifiche sono decisioni tecniche di sicurezza, non regole di business.

## Contesto

Il backend Node non ha oggi né `helmet` né `cors` come dipendenze, nessun `app.set('trust proxy', ...)`, e nessun lockout per-account (solo rate limiting per-IP via `limitatoreLogin`, 10 tentativi/15min). `tentativi_login_backoffice` (migration `000003`) già registra ogni tentativo di login backoffice con `email_tentata`, `esito`, `avvenuto_il`, indicizzata su `(email_tentata, avvenuto_il)` — sufficiente per un lockout a finestra temporale calcolato al volo, senza estendere lo schema con contatori/colonne di stato.

Il reverse proxy davanti al backend è gestito esternamente (fuori dal `docker-compose` di questo repo) e non ancora deployato — la sua topologia esatta (numero di hop, IP fidati) non è nota da qui.

## Decisioni di scope

1. **CORS**: allowlist da env var `CORS_ALLOWED_ORIGINS` (lista separata da virgola), default assente/vuota = nessuna origine cross-site esplicitamente permessa. Nessun default `*`, nemmeno in sviluppo (evita comportamento diverso tra ambienti che potrebbe mascherare un problema di configurazione al primo deploy reale).
2. **Helmet**: configurazione di default della libreria, nessun tuning — il backend è un'API JSON pura, non serve HTML/asset statici, i default (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, ecc.) sono già adeguati.
3. **`trust proxy`**: nuova env var `TRUST_PROXY` (stringa), default assente = comportamento Express invariato (nessun proxy fidato). Se presente, passata direttamente a `app.set('trust proxy', valore)` — accetta qualunque valore che Express stesso accetta. Nessun default abilitato: si attiva da chi gestisce il deploy quando il reverse proxy sarà pronto, senza toccare codice.
4. **Lockout per-account**: soglia **fissa nel codice** (decisione tecnica, non parametro versionato — non ha base normativa nell'Allegato A/B, a differenza delle soglie di business come `soglia_mancati_utilizzi_diffida`). **5 tentativi con `esito='password_errata'` nelle ultime 15 minuti** per la stessa email, calcolato con una `COUNT(*)` su `tentativi_login_backoffice` — nessuna nuova colonna, nessun meccanismo di "sblocco": passata la finestra il conteggio scende da sé e il login torna possibile automaticamente.
5. **Perché solo `password_errata`**: `utente_non_trovato` e `utente_disattivato` non riguardano un account reale da proteggere da brute-force (il primo non ha account, il secondo è già bloccato per altra via) — già coperti dal rate limiter IP-based esistente (`limitatoreLogin`).
6. **Comportamento a soglia raggiunta**: `eseguiLogin` rifiuta PRIMA di verificare la password (evita di continuare a spendere cicli scrypt su un account sotto attacco), con lo stesso errore generico usato per credenziali sbagliate (`ErroreCredenzialiNonValide`, HTTP 401) — nessuna differenza osservabile dal client, coerente col principio "no enumerazione utenti" già stabilito nel progetto. Registra comunque un tentativo con un nuovo valore di `esito`, `'account_bloccato'`, per audit/monitoraggio di un attacco in corso — mai esposto al client.

## Schema — migration `000017`

```sql
ALTER TABLE tentativi_login_backoffice DROP CONSTRAINT tentativi_login_backoffice_esito_check;
ALTER TABLE tentativi_login_backoffice ADD CONSTRAINT tentativi_login_backoffice_esito_check
  CHECK (esito IN ('successo', 'password_errata', 'utente_non_trovato', 'utente_disattivato', 'account_bloccato'));
```

(nome esatto del constraint da verificare contro lo schema reale — Postgres assegna un nome di default `<tabella>_<colonna>_check` per un CHECK inline non nominato esplicitamente, da confermare con `\d tentativi_login_backoffice` prima di scrivere la migration).

## Componenti

- **`backend-node/src/server.ts`**: import e uso di `helmet()` e `cors(...)` come middleware applicati subito dopo la creazione dell'app Express, prima di ogni route — stesso punto di montaggio di `cookie-parser` già presente.
- **`backend-node/src/index.ts`** (o `server.ts`, dove già si legge `process.env` per altre env var come `JWT_SECRET`): lettura di `TRUST_PROXY` e `CORS_ALLOWED_ORIGINS`, passate rispettivamente a `app.set('trust proxy', ...)` e alla config di `cors()`.
- **`backend-node/src/repository/tentativiLogin.ts`**: nuova funzione `contaTentativiFallitiRecenti(pool, email, finestraMs)` — query `COUNT(*)` sopra descritta. `EsitoTentativoLogin` esteso con `'account_bloccato'`.
- **`backend-node/src/auth/login.ts`** (`eseguiLogin`): prima del lookup utente, chiama `contaTentativiFallitiRecenti`; se ≥ soglia, registra `esito='account_bloccato'` e lancia `ErroreCredenzialiNonValide` senza toccare `trovaUtentePerEmail`/verifica password.
- **`package.json`**: nuove dipendenze `helmet` e `cors` (+ `@types/cors` in dev, `helmet` ha già i propri tipi inclusi).

## Errori

Nessun nuovo tipo di errore HTTP: il lockout riusa `ErroreCredenzialiNonValide` (già mappato a 401 nella route `/auth/login`). Nessuna modifica al mapping errori esistente.

## Testing

Stesso approccio del progetto: `node --test` contro Postgres reale, fixture con `randomUUID()` per l'email. Scenari:
- `contaTentativiFallitiRecenti`: conta solo `password_errata` nella finestra, ignora tentativi più vecchi della finestra e altri esiti.
- `eseguiLogin`: 5 password errate consecutive → il 6° tentativo (anche con password corretta) fallisce con `ErroreCredenzialiNonValide` e registra `esito='account_bloccato'`, senza eseguire `verificaPassword` (verificabile indirettamente: un utente disattivato durante la finestra di lockout non genererebbe comunque `utente_disattivato` come esito registrato, perché il controllo di lockout precede quello di stato — da testare esplicitamente).
- Test HTTP end-to-end su `/auth/login`: stesso scenario, verifica 401 e verifica che l'audit (`tentativi_login_backoffice`) mostri `account_bloccato`.
- CORS: richiesta con header `Origin` non in allowlist → nessun header `Access-Control-Allow-Origin` in risposta (verificabile con `fetch` e controllo header, non un errore HTTP esplicito — è così che funziona CORS, il browser blocca lato client, il server semplicemente non mette l'header).
- Helmet: verifica presenza di almeno un header di sicurezza noto (es. `X-Content-Type-Options: nosniff`) su una risposta qualunque.
- `trust proxy`: nessun test automatico dedicato (comportamento Express standard, non logica applicativa nostra) — verificabile manualmente con uno smoke test se necessario, non bloccante per questo blocco.

## Fuori scope esplicito

- Configurazione effettiva di `CORS_ALLOWED_ORIGINS`/`TRUST_PROXY` in produzione (dipende da domini/topologia non ancora noti — valori di esempio in `.env.example`, mai un default abilitato).
- Lockout per il login pubblico (OIDC) — non applicabile, l'autenticazione pubblica non ha una password da forzare lato nostro (delegata al proxy SPID/CIE).
- Sblocco manuale da admin (deciso: solo automatico a finestra).
- Qualunque modifica al motore Go o alla UI.
