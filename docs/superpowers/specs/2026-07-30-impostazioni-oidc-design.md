# Design — Endpoint backoffice per la configurazione OIDC (`/backoffice/impostazioni/oidc`)

Data: 2026-07-30. Riferimento: `docs/SPEC.md` Fase 4, item 3 (parte "impostazioni (SMTP, OIDC)" mai effettivamente chiusa nonostante lo strikeout del checklist — gap reale). Priorità decisa col committente rispetto al blocco 2/4 del Flusso pubblico: serve prima di poter testare OIDC contro il vero pa-sso-proxy con `client_id`/`client_secret` reali.

## Scope

Solo **configurazione OIDC**. L'SMTP resta **permanentemente** su `.env` (decisione esplicita del committente: un solo server SMTP, cambio config = cambio env; il wizard di bootstrap provisiona solo il primo admin, non è un caso d'uso ricorrente che giustifichi uno store DB). Nessun lavoro SMTP in questo blocco.

## Stato di partenza

`backend-node/src/oidc/config.ts` ha già `leggiConfigOidc(pool)`/`scriviConfigOidc(pool, config)`, con cifratura AES-256-GCM del `client_secret` (`oidc/crypto.ts`, chiave derivata da `JWT_SECRET`). Oggi queste funzioni sono chiamate **solo dai test** (fixture dirette, bypassando l'HTTP) — non esiste alcun endpoint che le esponga, quindi in produzione la config OIDC può essere scritta solo con SQL a mano.

## Modifiche

### `repository/impostazioniSistema.ts`
- `scriviImpostazione<T>(db: Db, chiave: string, valore: T, aggiornataDa: string): Promise<void>` — firma cambia da `Pool` a `Db` (per stare nella stessa transazione dell'audit log, stesso pattern del blocco accreditamento+delega) e aggiunge il parametro `aggiornataDa`, finalmente valorizzando la colonna `impostazioni_sistema.aggiornata_da` (esiste dallo schema Fase 1, mai scritta).
- `leggiImpostazione` resta invariata (`Pool`, sola lettura, nessuna transazione necessaria).

### `oidc/config.ts`
- `scriviConfigOidc(db: Db, config: ConfigOidcInput, aggiornataDa: string): Promise<void>` — `Db` invece di `Pool`. `ConfigOidcInput.clientSecret` diventa opzionale (`string | undefined`): se assente, la funzione legge la config esistente (`leggiImpostazione` sulla stessa `db`) e riusa `clientSecretCifrato` già in DB; se non esiste ancora nessuna config E il body non ha il secret, lancia un nuovo errore `ErroreClientSecretMancante` (la route lo mappa a 400 — non è validabile con zod puro perché dipende dallo stato DB, non solo dal body).
- `leggiConfigOidc` resta `Pool`, ma il tipo di ritorno per l'uso HTTP (GET) non è lo stesso di quello usato da `oidc/flow.ts` internamente: la route GET non deve mai restituire `clientSecret` in chiaro al client — mappa esplicitamente a un DTO senza quel campo, aggiungendo `clientSecretConfigurato: boolean` (`true` se `leggiImpostazione` trova una riga, indipendentemente dal contenuto).

### `backofficeSchema.ts`
```ts
export const schemaImpostazioniOidc = z.object({
  issuer: z.string().url(),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  clientSecret: z.string().min(1).optional(),
});
```

### `server.ts` — nuove route
- `GET /backoffice/impostazioni/oidc` (`richiedeRuolo('admin')` — **mai** `'operatore'`, dato sensibile): 404 se nessuna config salvata, altrimenti `{issuer, clientId, redirectUri, clientSecretConfigurato}`.
- `PUT /backoffice/impostazioni/oidc` (`richiedeRuolo('admin')`): valida con `schemaImpostazioniOidc`, chiama `scriviConfigOidc` dentro `eseguiInTransazione`, poi `registraOperazione` (azione `'aggiorna_impostazioni_oidc'`, **mai** loggare il client_secret nel `dettaglio` — solo issuer/clientId/redirectUri). Mapping errori: `ErroreClientSecretMancante` → 400.

## Effetto immediato

`oidc/flow.ts::costruisciUrlAutorizzazione` chiama già `leggiConfigOidc(pool)` ad ogni richiesta (nessuna cache sulla config stessa) — un PUT riuscito è immediatamente attivo sul prossimo `/auth/oidc/start`, nessun riavvio necessario. Nota collaterale non risolta qui (fuori scope, comportamento preesistente): `oidc/discovery.ts` cache il `.well-known` per 10 minuti in memoria per issuer — se l'admin cambia `issuer`, la nuova discovery viene comunque fetchata (chiave di cache diversa), ma se aggiorna solo `client_secret`/`clientId` sullo stesso issuer non c'è alcun problema perché la discovery non dipende da quei campi.

## Testing

`node --test` contro Postgres reale, server HTTP vero:
- GET senza config salvata → 404.
- PUT con tutti i campi (incluso `clientSecret`) → 200/201, poi GET conferma `clientSecretConfigurato: true` e **nessun campo `clientSecret`/`clientSecretCifrato` nel body**.
- PUT successivo che omette `clientSecret` → il secret cifrato in DB resta invariato (verificato decifrando con `decifra()` nel test e confrontando col valore originale), gli altri campi (es. `redirectUri`) vengono aggiornati.
- Primo PUT in assoluto senza `clientSecret` (nessuna config precedente) → 400.
- Operatore (ruolo `'operatore'`) su GET e PUT → 403.
- `log_operazioni` scritto su ogni PUT riuscito, `dettaglio` verificato NON contenere il secret in nessuna forma (né chiaro né cifrato).

## Fuori scope

- SMTP: resta permanentemente `.env`, nessun lavoro qui (decisione esplicita, vedi sopra).
- Cache discovery OIDC su cambio issuer: comportamento preesistente, non toccato.
- UI backoffice per questi endpoint: Fase 5 (frontend), non in questo blocco.
