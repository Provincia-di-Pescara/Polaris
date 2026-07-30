# Impostazioni OIDC (backoffice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Esporre `GET`/`PUT /backoffice/impostazioni/oidc` (solo admin) per leggere/scrivere la configurazione OIDC in `impostazioni_sistema`, oggi scrivibile solo con SQL a mano.

**Architecture:** Riuso di `oidc/config.ts`/`oidc/crypto.ts` esistenti. `repository/impostazioniSistema.ts` passa da `Pool` a `Db` (transazioni) e inizia a valorizzare `aggiornata_da`. `oidc/config.ts` guadagna: `clientSecret` opzionale in scrittura (omesso = mantiene il cifrato esistente), un DTO pubblico senza secret per la GET HTTP, un errore dedicato per il caso "nessun secret e nessuna config precedente". Nessun nuovo file di storage: stessa tabella, stessa chiave `'oidc'`.

**Tech Stack:** Node.js 24, TypeScript 7.0.2, Express 5, zod, `pg`, `node --test` contro Postgres 18 reale.

## Global Constraints

- Niente ORM: query SQL parametrizzate dirette.
- Ogni scrittura passa da `registraOperazione` (audit log art. B.39), nella stessa transazione via `eseguiInTransazione`.
- Il `client_secret` OIDC **non deve mai comparire in chiaro** in una risposta HTTP né nel `dettaglio` di `log_operazioni` — né in forma cifrata nel body di risposta della GET.
- Solo `richiedeRuolo('admin')` su questi endpoint — mai `'operatore'` (dato sensibile, a differenza del resto del CRUD backoffice).
- Test con `node --test` contro Postgres reale (`TEST_DATABASE_URL`), server HTTP vero, mai mock del DB.
- `exactOptionalPropertyTypes: true`: campi opzionali dichiarati `campo?: T | undefined` esplicito.
- `entita_id` in `log_operazioni` è UUID: `impostazioni_sistema` ha PK testuale (`chiave`), quindi va **omesso** da `registraOperazione` (stesso caso già gestito per `discipline_sportive`, vedi CLAUDE.md), non passato come `null`.
- Postgres 18 dev persistente su `localhost:5433`, credenziali `postgres:test`, database `palestre`, schema già applicato (migration 000001-000007). `cd backend-node` prima dei comandi npm/node.

---

### Task 1: Repository — `scriviImpostazione` transazionale + `scriviConfigOidc` con secret opzionale

**Files:**
- Modify: `backend-node/src/repository/impostazioniSistema.ts`
- Modify: `backend-node/src/oidc/config.ts`
- Create: `backend-node/src/oidc/config.test.ts`
- Modify: `backend-node/src/server.test.ts` (verificare che la chiamata esistente a `scriviConfigOidc` a riga 78 resti compatibile — vedi Step 6)
- Modify: `backend-node/src/auth/loginPubblico.test.ts` (stessa verifica, chiamata a riga 132)

**Interfaces:**
- Consumes: `Db` da `../db.ts`; `cifra`/`decifra` da `./crypto.ts` (invariate).
- Produces: `scriviImpostazione<T>(db: Db, chiave: string, valore: T, aggiornataDa?: string | undefined): Promise<void>`; `ConfigOidcInput { issuer: string; clientId: string; redirectUri: string; clientSecret?: string | undefined }`; `scriviConfigOidc(db: Db, config: ConfigOidcInput, aggiornataDa?: string | undefined): Promise<void>`; `class ErroreClientSecretMancante extends Error {}`; `ConfigOidcPubblica { issuer: string; clientId: string; redirectUri: string; clientSecretConfigurato: boolean }`; `leggiConfigOidcPubblica(db: Db): Promise<ConfigOidcPubblica | null>`. `leggiConfigOidc(db: Db): Promise<ConfigOidc | null>` invariata nella forma, solo il tipo del primo parametro allargato da `Pool` a `Db`.

- [ ] **Step 1: Scrivere il test RED per `scriviImpostazione` con `aggiornataDa`**

`backend-node/src/repository/impostazioniSistema.test.ts` (nuovo file — verificare prima che non esista già; se esiste, aggiungere in fondo):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { leggiImpostazione, scriviImpostazione } from './impostazioniSistema.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'scriviImpostazione valorizza aggiornata_da',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const chiave = `test-impostazione-${randomUUID()}`;
      const operatoreId = randomUUID();
      await pool.query(
        `INSERT INTO utenti_backoffice (id, email, password_hash, nome, cognome, ruolo, stato)
         VALUES ($1, $2, 'hash-finto', 'Test', 'Impostazioni', 'admin', 'attivo')`,
        [operatoreId, `impostazioni-test-${randomUUID()}@test.local`],
      );

      await scriviImpostazione(pool, chiave, { valore: 'iniziale' }, operatoreId);

      const riga = await pool.query<{ aggiornata_da: string }>(
        'SELECT aggiornata_da FROM impostazioni_sistema WHERE chiave = $1',
        [chiave],
      );
      assert.equal(riga.rows[0]?.aggiornata_da, operatoreId);

      const letta = await leggiImpostazione<{ valore: string }>(pool, chiave);
      assert.equal(letta?.valore, 'iniziale');
    } finally {
      await pool.end();
    }
  },
);
```
Nota: `utenti_backoffice.password_hash` richiede un valore NOT NULL ma non serve un hash reale valido per questo test (mai autenticato) — una stringa qualsiasi basta a soddisfare il vincolo.

- [ ] **Step 2: Eseguire il test, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/repository/impostazioniSistema.test.ts`
Expected: FAIL — `scriviImpostazione` accetta solo 3 argomenti oggi, TypeScript/runtime segnala il quarto come eccedente o (se il file non esiste ancora) `Cannot find module`.

- [ ] **Step 3: Modificare `repository/impostazioniSistema.ts`**

```ts
import type { Db } from '../db.ts';

export async function leggiImpostazione<T>(db: Db, chiave: string): Promise<T | null> {
  const risultato = await db.query<{ valore: T }>('SELECT valore FROM impostazioni_sistema WHERE chiave = $1', [
    chiave,
  ]);
  return risultato.rows[0]?.valore ?? null;
}

export async function scriviImpostazione<T>(
  db: Db,
  chiave: string,
  valore: T,
  aggiornataDa?: string | undefined,
): Promise<void> {
  await db.query(
    `INSERT INTO impostazioni_sistema (chiave, valore, aggiornata_da)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore, aggiornata_il = now(), aggiornata_da = EXCLUDED.aggiornata_da`,
    [chiave, JSON.stringify(valore), aggiornataDa ?? null],
  );
}
```
(sostituisce interamente il contenuto attuale del file — `Pool` non è più importato qui)

- [ ] **Step 4: Eseguire il test, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/repository/impostazioniSistema.test.ts`
Expected: PASS.

- [ ] **Step 5: Scrivere il test RED per `scriviConfigOidc` con secret opzionale**

`backend-node/src/oidc/config.test.ts` (nuovo file):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  leggiConfigOidc,
  leggiConfigOidcPubblica,
  scriviConfigOidc,
  ErroreClientSecretMancante,
} from './config.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

test(
  'scriviConfigOidc: primo salvataggio richiede clientSecret, secret opzionale sui successivi',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      // Isolamento: ogni test su questa chiave singleton usa un client_secret univoco
      // per verificare che il valore letto sia proprio quello appena scritto, ma la
      // RIGA in impostazioni_sistema è condivisa (chiave fissa 'oidc') — non gira in
      // parallelo con altri test che la toccano nello stesso processo (nessun altro
      // file tocca questa chiave).
      const issuer1 = `https://idp-test-${randomUUID()}.invalid`;
      await assert.rejects(
        () => scriviConfigOidc(pool, { issuer: issuer1, clientId: 'client-a', redirectUri: 'https://app.invalid/cb' }),
        ErroreClientSecretMancante,
        'primo salvataggio in assoluto senza clientSecret deve fallire',
      );

      await scriviConfigOidc(pool, {
        issuer: issuer1,
        clientId: 'client-a',
        clientSecret: 'segreto-iniziale',
        redirectUri: 'https://app.invalid/cb',
      });
      const dopoPrimo = await leggiConfigOidc(pool);
      assert.equal(dopoPrimo?.clientSecret, 'segreto-iniziale');

      const issuer2 = `https://idp-test-${randomUUID()}.invalid`;
      await scriviConfigOidc(pool, { issuer: issuer2, clientId: 'client-a', redirectUri: 'https://app.invalid/cb2' });
      const dopoSecondo = await leggiConfigOidc(pool);
      assert.equal(dopoSecondo?.issuer, issuer2, 'issuer aggiornato');
      assert.equal(dopoSecondo?.clientSecret, 'segreto-iniziale', 'clientSecret invariato perché omesso');

      const pubblica = await leggiConfigOidcPubblica(pool);
      assert.equal(pubblica?.clientSecretConfigurato, true);
      assert.equal((pubblica as unknown as { clientSecret?: unknown }).clientSecret, undefined, 'mai il secret nel DTO pubblico');
    } finally {
      await pool.end();
    }
  },
);
```

- [ ] **Step 6: Eseguire il test, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/oidc/config.test.ts`
Expected: FAIL — `ErroreClientSecretMancante`/`leggiConfigOidcPubblica` non esistono, `scriviConfigOidc` richiede ancora `clientSecret` obbligatorio a livello di tipo.

- [ ] **Step 7: Riscrivere `oidc/config.ts`**

```ts
import type { Db } from '../db.ts';
import { leggiImpostazione, scriviImpostazione } from '../repository/impostazioniSistema.ts';
import { cifra, decifra } from './crypto.ts';

const CHIAVE_IMPOSTAZIONE = 'oidc';

// Lanciato quando un PUT omette il client_secret ma non esiste ancora nessuna
// configurazione OIDC salvata da cui ereditarlo — non validabile con zod puro perché
// dipende dallo stato del DB, non solo dal body della richiesta.
export class ErroreClientSecretMancante extends Error {}

export interface ConfigOidc {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ConfigOidcInput {
  issuer: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string | undefined;
}

// DTO per la GET HTTP: mai il secret, nemmeno cifrato.
export interface ConfigOidcPubblica {
  issuer: string;
  clientId: string;
  redirectUri: string;
  clientSecretConfigurato: boolean;
}

interface ConfigOidcMemorizzata {
  issuer: string;
  clientId: string;
  clientSecretCifrato: string;
  redirectUri: string;
}

export async function leggiConfigOidc(db: Db): Promise<ConfigOidc | null> {
  const memorizzata = await leggiImpostazione<ConfigOidcMemorizzata>(db, CHIAVE_IMPOSTAZIONE);
  if (!memorizzata) {
    return null;
  }
  return {
    issuer: memorizzata.issuer,
    clientId: memorizzata.clientId,
    clientSecret: await decifra(memorizzata.clientSecretCifrato),
    redirectUri: memorizzata.redirectUri,
  };
}

export async function leggiConfigOidcPubblica(db: Db): Promise<ConfigOidcPubblica | null> {
  const memorizzata = await leggiImpostazione<ConfigOidcMemorizzata>(db, CHIAVE_IMPOSTAZIONE);
  if (!memorizzata) {
    return null;
  }
  return {
    issuer: memorizzata.issuer,
    clientId: memorizzata.clientId,
    redirectUri: memorizzata.redirectUri,
    clientSecretConfigurato: true,
  };
}

export async function scriviConfigOidc(
  db: Db,
  config: ConfigOidcInput,
  aggiornataDa?: string | undefined,
): Promise<void> {
  let clientSecretCifrato: string;
  if (config.clientSecret !== undefined) {
    clientSecretCifrato = await cifra(config.clientSecret);
  } else {
    const esistente = await leggiImpostazione<ConfigOidcMemorizzata>(db, CHIAVE_IMPOSTAZIONE);
    if (!esistente) {
      throw new ErroreClientSecretMancante(
        'client_secret obbligatorio: nessuna configurazione OIDC esistente da cui ereditarlo',
      );
    }
    clientSecretCifrato = esistente.clientSecretCifrato;
  }
  const memorizzata: ConfigOidcMemorizzata = {
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecretCifrato,
    redirectUri: config.redirectUri,
  };
  await scriviImpostazione(db, CHIAVE_IMPOSTAZIONE, memorizzata, aggiornataDa);
}
```

- [ ] **Step 8: Eseguire il test, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/oidc/config.test.ts`
Expected: PASS.

- [ ] **Step 9: Verificare che i chiamanti esistenti di `scriviConfigOidc` restino compatibili**

`backend-node/src/server.test.ts:78` e `backend-node/src/auth/loginPubblico.test.ts:132` chiamano già `scriviConfigOidc(pool, { issuer, clientId, clientSecret, redirectUri })` (2 argomenti, `clientSecret` sempre presente). Con la nuova firma questo continua a compilare e funzionare invariato: `Pool` soddisfa `Db`, `clientSecret` è ancora un campo valido (ora opzionale, non più obbligatorio — un valore presente resta accettato), il terzo argomento `aggiornataDa` è opzionale e viene omesso. **Non modificare questi due file** — eseguili per confermare che non si siano rotti:
```
cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.test.ts src/auth/loginPubblico.test.ts
```
Expected: PASS, nessuna modifica necessaria.

- [ ] **Step 10: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```
Expected: typecheck pulito, nessuna regressione sulla suite esistente.

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/repository/impostazioniSistema.ts backend-node/src/repository/impostazioniSistema.test.ts backend-node/src/oidc/config.ts backend-node/src/oidc/config.test.ts
git commit -m "feat(backend): scriviConfigOidc con client_secret opzionale (merge-on-omit) + aggiornata_da"
```

---

### Task 2: Endpoint `GET`/`PUT /backoffice/impostazioni/oidc`

**Files:**
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`

**Interfaces:**
- Consumes: `leggiConfigOidcPubblica`, `scriviConfigOidc`, `ErroreClientSecretMancante` da `./oidc/config.ts` (Task 1); `richiedeAutenticazione`, `richiedeRuolo`, `RequestAutenticata` da `./auth/middleware.ts`; `eseguiInTransazione`, `registraOperazione` (già in `server.ts`).
- Produces: `schemaImpostazioniOidc` (zod) in `backofficeSchema.ts`; route `GET /backoffice/impostazioni/oidc`, `PUT /backoffice/impostazioni/oidc`.

- [ ] **Step 1: Aggiungere lo schema zod**

Aggiungere a `backend-node/src/backofficeSchema.ts`:
```ts
export const schemaImpostazioniOidc = z.object({
  issuer: z.string().url(),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  clientSecret: z.string().min(1).optional(),
});
export type ImpostazioniOidcRequest = z.infer<typeof schemaImpostazioniOidc>;
```

- [ ] **Step 2: Scrivere gli scenari HTTP RED**

Aggiungere a `backend-node/src/server.backoffice.test.ts` (riusa `avviaServerTest`/`creaUtenteBackofficeTest` già definiti in cima al file):
```ts
test(
  'GET/PUT /backoffice/impostazioni/oidc: solo admin, secret mai in chiaro, merge-on-omit',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const admin = await creaUtenteBackofficeTest(pool, 'admin');
    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');

    await t.test('operatore: 403 su GET e PUT', async () => {
      const rGet = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(rGet.status, 403);
      const rPut = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({}),
      });
      assert.equal(rPut.status, 403);
    });

    await t.test('admin, GET senza config: 404', async () => {
      const r = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('admin, primo PUT senza clientSecret: 400', async () => {
      const r = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          issuer: 'https://idp-http-test.invalid',
          clientId: 'client-http-test',
          redirectUri: 'https://app-http-test.invalid/cb',
        }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('admin, primo PUT con clientSecret: 200, GET non espone il secret', async () => {
      const rPut = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          issuer: 'https://idp-http-test.invalid',
          clientId: 'client-http-test',
          clientSecret: 'segreto-http-test',
          redirectUri: 'https://app-http-test.invalid/cb',
        }),
      });
      assert.equal(rPut.status, 200);
      const bodyPut = (await rPut.json()) as Record<string, unknown>;
      assert.equal('clientSecret' in bodyPut, false, 'PUT non deve mai riflettere il secret nella risposta');
      assert.equal(bodyPut.clientSecretConfigurato, true);

      const rGet = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(rGet.status, 200);
      const bodyGet = (await rGet.json()) as Record<string, unknown>;
      assert.equal('clientSecret' in bodyGet, false);
      assert.equal(bodyGet.issuer, 'https://idp-http-test.invalid');

      const log = await pool.query(
        `SELECT dettaglio FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'aggiorna_impostazioni_oidc' ORDER BY avvenuta_il DESC LIMIT 1`,
        [admin.id],
      );
      const dettaglio = log.rows[0]?.dettaglio as Record<string, unknown> | undefined;
      assert.ok(dettaglio);
      assert.equal('clientSecret' in dettaglio!, false, 'il secret non deve mai finire nel dettaglio dell\'audit log');
    });

    await t.test('admin, PUT successivo senza clientSecret: 200, secret precedente preservato', async () => {
      const rPut = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          issuer: 'https://idp-http-test-2.invalid',
          clientId: 'client-http-test',
          redirectUri: 'https://app-http-test.invalid/cb',
        }),
      });
      assert.equal(rPut.status, 200);
      const bodyPut = (await rPut.json()) as { issuer: string; clientSecretConfigurato: boolean };
      assert.equal(bodyPut.issuer, 'https://idp-http-test-2.invalid');
      assert.equal(bodyPut.clientSecretConfigurato, true, 'il flag resta true anche se il secret non è stato reinviato');
    });
  },
);
```
Nota: la colonna timestamp di `log_operazioni` è `avvenuta_il` (verificato in `db/migrations/000001_init.up.sql:564`), già usata correttamente nella query sopra.

- [ ] **Step 3: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: FAIL — 404 (rotte non wired) sui sotto-test che si aspettano altri status.

- [ ] **Step 4: Wire delle route in `server.ts`**

Import da aggiungere (in cima al file, insieme agli altri import):
```ts
import { leggiConfigOidcPubblica, scriviConfigOidc, ErroreClientSecretMancante } from './oidc/config.ts';
```
E aggiungere `schemaImpostazioniOidc` alla riga di import esistente da `./backofficeSchema.ts`.

Route (dopo l'ultima route esistente, prima di `return app; }`):
```ts
  app.get(
    '/backoffice/impostazioni/oidc',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (_req, res) => {
      try {
        const config = await leggiConfigOidcPubblica(pool);
        if (!config) {
          res.status(404).json({ errore: 'configurazione OIDC non ancora impostata' });
          return;
        }
        res.status(200).json(config);
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/impostazioni/oidc',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaImpostazioniOidc.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const config = await eseguiInTransazione(pool, async (client) => {
          await scriviConfigOidc(client, parsed.data, req.utente!.sub);
          // entitaId omesso: impostazioni_sistema ha PK testuale (chiave), non UUID —
          // stesso caso già gestito per discipline_sportive (vedi CLAUDE.md). Il
          // dettaglio NON include mai clientSecret, nemmeno cifrato.
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'aggiorna_impostazioni_oidc',
            entitaTipo: 'impostazioni_sistema',
            dettaglio: { issuer: parsed.data.issuer, clientId: parsed.data.clientId, redirectUri: parsed.data.redirectUri },
          });
          return leggiConfigOidcPubblica(client);
        });
        res.status(200).json(config);
      } catch (err) {
        if (err instanceof ErroreClientSecretMancante) {
          res.status(400).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 5: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: PASS, tutti gli scenari.

- [ ] **Step 6: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```
Expected: pulito, nessuna regressione su nessuno dei file esistenti (in particolare `server.test.ts`/`loginPubblico.test.ts`, che chiamano `scriviConfigOidc` con la firma vecchia — devono restare verdi senza modifiche).

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/backofficeSchema.ts backend-node/src/server.ts backend-node/src/server.backoffice.test.ts
git commit -m "feat(backend): GET/PUT /backoffice/impostazioni/oidc (solo admin, secret mai in chiaro)"
```

---

## Self-Review (fatto in fase di scrittura del piano)

**Copertura spec**: GET/PUT solo admin ✅ (Task 2), secret mai in GET ✅ (Task 1 DTO pubblico + Task 2 test espliciti), merge-on-omit ✅ (Task 1), 400 su primo PUT senza secret ✅ (Task 1+2), audit log senza secret ✅ (Task 2, test dedicato sul `dettaglio`), `aggiornata_da` valorizzata ✅ (Task 1). SMTP esplicitamente fuori scope, nessun task lo tocca.

**Placeholder**: nessun TBD/TODO nei passi di codice. L'unica nota "verificare il nome esatto della colonna" (Task 2, Step 2) è una verifica puntuale contro lo schema esistente, non un'ambiguità di design — l'implementatore la risolve con un `grep` prima di scrivere la query, non una scelta aperta.

**Coerenza tipi**: `ConfigOidcInput`/`ConfigOidcPubblica`/`ErroreClientSecretMancante` definiti nel Task 1 e riusati identici nel Task 2 (stessi nomi, stessa forma). `scriviImpostazione`/`scriviConfigOidc` accettano `Db` fin dal Task 1, coerente con l'uso dentro `eseguiInTransazione` nel Task 2 (nessun cast, nessuna firma `Pool` residua).
