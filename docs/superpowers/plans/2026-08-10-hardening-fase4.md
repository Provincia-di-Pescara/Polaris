# Hardening Fase 4 residuo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere il residuo di hardening della Fase 4 (Backend Node): security headers (`helmet`) + CORS configurabile via allowlist, `trust proxy` configurabile per il reverse proxy esterno, e lockout per-account sui tentativi di login backoffice falliti.

**Architettura:** Tre modifiche indipendenti nello stesso file principale (`server.ts`) + repository (`tentativiLogin.ts`) + logica di login (`auth/login.ts`), nessuna nuova tabella oltre a un'estensione del `CHECK` esistente. Nessuna modifica al motore Go, nessuna modifica alla UI.

**Tech Stack:** Node.js 24 + TypeScript 7 (`.ts` nativo), Express 5, `helmet`, `cors`, `pg` diretto senza ORM, `node --test` contro Postgres reale.

## Global Constraints

- Nessun default CORS permissivo: `CORS_ALLOWED_ORIGINS` assente/vuota → nessuna origine cross-site esplicitamente permessa (mai `*`, nemmeno in sviluppo).
- Nessun default `trust proxy` abilitato: `TRUST_PROXY` assente → comportamento Express invariato.
- Soglia lockout **fissa nel codice**, non parametro versionato: 5 tentativi con `esito='password_errata'` nelle ultime 15 minuti per la stessa email.
- Il lockout riusa `ErroreCredenzialiNonValide` (nessuna differenza osservabile dal client rispetto a una password sbagliata — no enumerazione).
- Test sempre con `TEST_DATABASE_URL`, skip pulito se assente, fixture con `randomUUID()` per unicità su Postgres persistente condiviso.
- Nessuna modifica al motore Go, nessuna modifica alla UI.

---

## File Structure

- **Create** `db/migrations/000017_lockout_account_bloccato.up.sql` / `.down.sql`.
- **Modify** `backend-node/src/repository/tentativiLogin.ts` — `contaTentativiFallitiRecenti`, `EsitoTentativoLogin` esteso.
- **Modify** `backend-node/src/repository/tentativiLogin.test.ts` (nuovo file di test per questo repository — non esisteva prima).
- **Modify** `backend-node/src/auth/login.ts` — guardia di lockout in `eseguiLogin`.
- **Modify** `backend-node/src/auth/login.test.ts` — nuovi scenari di lockout.
- **Modify** `backend-node/package.json` — dipendenze `helmet`, `cors`, `@types/cors`.
- **Modify** `backend-node/src/server.ts` — `helmet()`, `cors()`, `trust proxy` in `creaApp`.
- **Create** `backend-node/src/server.hardening.test.ts` — test HTTP per CORS/helmet.
- **Modify** `.env.example` — documenta `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY`.

---

### Task 1: Migration — nuovo esito `account_bloccato`

**Files:**
- Create: `db/migrations/000017_lockout_account_bloccato.up.sql`
- Create: `db/migrations/000017_lockout_account_bloccato.down.sql`

**Interfaces:**
- Produces: `tentativi_login_backoffice.esito` accetta anche `'account_bloccato'` — usato da Task 2-3.

- [ ] **Step 1: Scrivi la migration up**

```sql
ALTER TABLE tentativi_login_backoffice DROP CONSTRAINT tentativi_login_backoffice_esito_check;
ALTER TABLE tentativi_login_backoffice ADD CONSTRAINT tentativi_login_backoffice_esito_check
  CHECK (esito IN ('successo', 'password_errata', 'utente_non_trovato', 'utente_disattivato', 'account_bloccato'));
```

Salva in `db/migrations/000017_lockout_account_bloccato.up.sql`.

- [ ] **Step 2: Scrivi la migration down**

```sql
ALTER TABLE tentativi_login_backoffice DROP CONSTRAINT tentativi_login_backoffice_esito_check;
ALTER TABLE tentativi_login_backoffice ADD CONSTRAINT tentativi_login_backoffice_esito_check
  CHECK (esito IN ('successo', 'password_errata', 'utente_non_trovato', 'utente_disattivato'));
```

Salva in `db/migrations/000017_lockout_account_bloccato.down.sql`.

- [ ] **Step 3: Verifica contro Postgres reale**

Applica la migration sul Postgres di sviluppo persistente (`pg-palestre-dev`, porta mappata `5433` — se il container non esiste, vedi CLAUDE.md sezione "Se `pg-palestre-dev` non esiste" per ricrearlo):

```bash
docker cp db/migrations/000017_lockout_account_bloccato.up.sql pg-palestre-dev:/tmp/000017.up.sql
docker exec pg-palestre-dev psql -U postgres -d palestre -v ON_ERROR_STOP=1 -f /tmp/000017.up.sql
docker exec pg-palestre-dev psql -U postgres -d palestre -c "\d tentativi_login_backoffice"
```

Expected: il `CHECK` mostra i 5 valori inclusi `account_bloccato`. Verifica anche che un `INSERT` con `esito='account_bloccato'` funzioni:

```bash
docker exec pg-palestre-dev psql -U postgres -d palestre -c "INSERT INTO tentativi_login_backoffice (email_tentata, esito) VALUES ('test-migration-000017@test.local', 'account_bloccato');"
docker exec pg-palestre-dev psql -U postgres -d palestre -c "DELETE FROM tentativi_login_backoffice WHERE email_tentata = 'test-migration-000017@test.local';"
```

Non applicare la `.down.sql` qui — il Postgres persistente resta con lo schema aggiornato per i task successivi.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/000017_lockout_account_bloccato.up.sql db/migrations/000017_lockout_account_bloccato.down.sql
git commit -m "feat(db): aggiungi esito account_bloccato per il lockout per-account (hardening Fase 4)"
```

---

### Task 2: Repository `tentativiLogin.ts` — conteggio tentativi falliti recenti

**Files:**
- Modify: `backend-node/src/repository/tentativiLogin.ts`
- Create: `backend-node/src/repository/tentativiLogin.test.ts`

**Interfaces:**
- Consumes: `Db`/`Pool` (già presente in `db.ts`).
- Produces: `EsitoTentativoLogin` esteso con `'account_bloccato'`; `contaTentativiFallitiRecenti(pool: Pool, email: string, finestraMs: number): Promise<number>`. Consumato da Task 3 (`auth/login.ts`).

- [ ] **Step 1: Scrivi il test repository**

Crea `backend-node/src/repository/tentativiLogin.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { registraTentativoLogin, contaTentativiFallitiRecenti } from './tentativiLogin.ts';

const dsn = process.env.TEST_DATABASE_URL;

test('contaTentativiFallitiRecenti: conta solo password_errata dentro la finestra', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const email = `conta-tentativi-${randomUUID()}@test.local`;

  await registraTentativoLogin(pool, { emailTentata: email, esito: 'password_errata' });
  await registraTentativoLogin(pool, { emailTentata: email, esito: 'password_errata' });
  await registraTentativoLogin(pool, { emailTentata: email, esito: 'successo' });

  const conteggio = await contaTentativiFallitiRecenti(pool, email, 15 * 60 * 1000);
  assert.equal(conteggio, 2);
});

test('contaTentativiFallitiRecenti: ignora tentativi più vecchi della finestra', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const email = `conta-vecchi-${randomUUID()}@test.local`;

  await registraTentativoLogin(pool, { emailTentata: email, esito: 'password_errata' });
  await pool.query(
    `UPDATE tentativi_login_backoffice SET avvenuto_il = now() - interval '20 minutes' WHERE email_tentata = $1`,
    [email],
  );

  const conteggio = await contaTentativiFallitiRecenti(pool, email, 15 * 60 * 1000);
  assert.equal(conteggio, 0);
});

test('contaTentativiFallitiRecenti: ignora esiti diversi da password_errata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const email = `conta-altri-esiti-${randomUUID()}@test.local`;

  await registraTentativoLogin(pool, { emailTentata: email, esito: 'utente_non_trovato' });
  await registraTentativoLogin(pool, { emailTentata: email, esito: 'utente_disattivato' });

  const conteggio = await contaTentativiFallitiRecenti(pool, email, 15 * 60 * 1000);
  assert.equal(conteggio, 0);
});

test('contaTentativiFallitiRecenti: email diversa non viene contata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const emailA = `conta-a-${randomUUID()}@test.local`;
  const emailB = `conta-b-${randomUUID()}@test.local`;

  await registraTentativoLogin(pool, { emailTentata: emailA, esito: 'password_errata' });

  const conteggio = await contaTentativiFallitiRecenti(pool, emailB, 15 * 60 * 1000);
  assert.equal(conteggio, 0);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/repository/tentativiLogin.test.ts`
Expected: FAIL — `contaTentativiFallitiRecenti` non esiste.

- [ ] **Step 3: Scrivi l'implementazione**

Sostituisci il contenuto di `backend-node/src/repository/tentativiLogin.ts` con:

```ts
import type { Pool } from 'pg';

export type EsitoTentativoLogin = 'successo' | 'password_errata' | 'utente_non_trovato' | 'utente_disattivato' | 'account_bloccato';

export interface TentativoLogin {
  emailTentata: string;
  utenteBackofficeId?: string | null;
  esito: EsitoTentativoLogin;
  ipAddress?: string | null;
}

export async function registraTentativoLogin(pool: Pool, tentativo: TentativoLogin): Promise<void> {
  await pool.query(
    `INSERT INTO tentativi_login_backoffice (email_tentata, utente_backoffice_id, esito, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [tentativo.emailTentata, tentativo.utenteBackofficeId ?? null, tentativo.esito, tentativo.ipAddress ?? null],
  );
}

// Lockout per-account (hardening Fase 4): conta solo 'password_errata' — un account che
// non esiste (utente_non_trovato) o è già disattivato (utente_disattivato) non ha bisogno
// di questa protezione aggiuntiva, è già coperto dal rate limiter per-IP su /auth/login.
export async function contaTentativiFallitiRecenti(pool: Pool, email: string, finestraMs: number): Promise<number> {
  const r = await pool.query<{ conteggio: string }>(
    `SELECT count(*) AS conteggio FROM tentativi_login_backoffice
     WHERE email_tentata = $1 AND esito = 'password_errata' AND avvenuto_il > now() - ($2 || ' milliseconds')::interval`,
    [email, finestraMs],
  );
  return Number(r.rows[0]!.conteggio);
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/repository/tentativiLogin.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc` se `pnpm` non è in PATH)
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/repository/tentativiLogin.ts backend-node/src/repository/tentativiLogin.test.ts
git commit -m "feat(backend): conta tentativi login falliti recenti per email (hardening Fase 4)"
```

---

### Task 3: Lockout per-account in `eseguiLogin`

**Files:**
- Modify: `backend-node/src/auth/login.ts`
- Modify: `backend-node/src/auth/login.test.ts`

**Interfaces:**
- Consumes: `contaTentativiFallitiRecenti` (`../repository/tentativiLogin.ts`, Task 2).
- Produces: `eseguiLogin` rifiuta con `ErroreCredenzialiNonValide` (già esportata da `./errori.ts`) se la soglia è raggiunta, prima di verificare password/stato utente.

- [ ] **Step 1: Scrivi i test**

Aggiungi in `backend-node/src/auth/login.test.ts`, dentro il blocco `t.test(...)` esistente (stesso `pool`/`runId` già in scope), subito dopo il test `'login con utente disattivato viene rifiutato'`:

```ts
    await t.test('lockout: 5 password errate consecutive bloccano il 6° tentativo anche con password corretta', async () => {
      const email = `login-lockout-${runId}@test.local`;
      await creaUtenteTest(pool, { email, password: 'password-corretta-lockout' });

      for (let i = 0; i < 5; i++) {
        await assert.rejects(() => eseguiLogin(pool, email, 'password-sbagliata', '127.0.0.1'), ErroreCredenzialiNonValide);
      }

      await assert.rejects(
        () => eseguiLogin(pool, email, 'password-corretta-lockout', '127.0.0.1'),
        ErroreCredenzialiNonValide,
      );

      const tentativo = await pool.query(
        `SELECT esito FROM tentativi_login_backoffice WHERE email_tentata = $1 ORDER BY avvenuto_il DESC LIMIT 1`,
        [email],
      );
      assert.equal(tentativo.rows[0]?.esito, 'account_bloccato');
    });

    await t.test('lockout: sotto soglia il login con password corretta funziona ancora', async () => {
      const email = `login-sotto-soglia-${runId}@test.local`;
      await creaUtenteTest(pool, { email, password: 'password-corretta-sottosoglia' });

      for (let i = 0; i < 4; i++) {
        await assert.rejects(() => eseguiLogin(pool, email, 'password-sbagliata', '127.0.0.1'), ErroreCredenzialiNonValide);
      }

      const esito = await eseguiLogin(pool, email, 'password-corretta-sottosoglia', '127.0.0.1');
      assert.ok(esito.accessToken);
    });
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/auth/login.test.ts`
Expected: FAIL — il test `lockout: 5 password errate...` fallisce perché il 6° tentativo con password corretta oggi riesce (nessun lockout implementato).

- [ ] **Step 3: Scrivi l'implementazione**

In `backend-node/src/auth/login.ts`, aggiungi l'import `import { registraTentativoLogin, contaTentativiFallitiRecenti } from '../repository/tentativiLogin.ts';` (sostituisce/estende l'import esistente da quel modulo — unisci se già importato `registraTentativoLogin` da lì, aggiungi solo `contaTentativiFallitiRecenti`).

Aggiungi la costante subito sotto `DURATA_REFRESH_TOKEN_MS`:

```ts
const SOGLIA_LOCKOUT = 5;
const FINESTRA_LOCKOUT_MS = 15 * 60 * 1000; // 15 minuti, stessa finestra di limitatoreLogin (server.ts)
```

Modifica `eseguiLogin` per controllare il lockout PRIMA di `trovaUtentePerEmail`:

```ts
export async function eseguiLogin(
  pool: Pool,
  email: string,
  password: string,
  ipAddress: string | null,
): Promise<EsitoAutenticazione> {
  const tentativiFalliti = await contaTentativiFallitiRecenti(pool, email, FINESTRA_LOCKOUT_MS);
  if (tentativiFalliti >= SOGLIA_LOCKOUT) {
    await registraTentativoLogin(pool, { emailTentata: email, esito: 'account_bloccato', ipAddress });
    throw new ErroreCredenzialiNonValide();
  }

  const utente = await trovaUtentePerEmail(pool, email);
  // ... resto della funzione invariato
```

Il resto del corpo della funzione (dal `if (!utente)` in poi) resta esattamente come nel file esistente — non lo riscrivere, il codice sopra si inserisce PRIMA della riga `const utente = await trovaUtentePerEmail(pool, email);` già presente.

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/auth/login.test.ts`
Expected: PASS (tutti i test del file, incluso il ciclo completo login→refresh→logout preesistente — nessuna regressione).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc`)
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/auth/login.ts backend-node/src/auth/login.test.ts
git commit -m "feat(backend): lockout per-account sui tentativi di login falliti (hardening Fase 4)"
```

---

### Task 4: Helmet + CORS + trust proxy

**Files:**
- Modify: `backend-node/package.json`
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.hardening.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `creaApp` applica `helmet()`, `cors(...)` (allowlist da `CORS_ALLOWED_ORIGINS`), e `app.set('trust proxy', ...)` (da `TRUST_PROXY`) prima di ogni route.

- [ ] **Step 1: Installa le dipendenze**

```bash
cd backend-node
pnpm add helmet@^8.3.0 cors@^2.8.6
pnpm add -D @types/cors@^2.8.19
```

Se `pnpm` non è in PATH o fallisce per un problema del workspace, aggiungi manualmente le tre righe a `package.json` (`"helmet": "^8.3.0"`, `"cors": "^2.8.6"` in `dependencies`; `"@types/cors": "^2.8.19"` in `devDependencies`) e verifica poi con `pnpm install --ignore-workspace --lockfile-only` dentro `backend-node/` (stesso pattern già documentato in CLAUDE.md per questo repo) — se anche questo non è disponibile, copia i pacchetti già presenti in un altro worktree/checkout se esistono, altrimenti documenta il blocco nel report.

- [ ] **Step 2: Scrivi il test HTTP**

Crea `backend-node/src/server.hardening.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { creaApp } from './server.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

test('helmet: risposta include header di sicurezza standard', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const r = await fetch(`${base}/healthz`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('cors: origine in allowlist riceve Access-Control-Allow-Origin', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://esempio-consentito.test';
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente === undefined) { delete process.env.CORS_ALLOWED_ORIGINS; } else { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://esempio-consentito.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://esempio-consentito.test');
});

test('cors: origine NON in allowlist non riceve Access-Control-Allow-Origin', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://esempio-consentito.test';
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente === undefined) { delete process.env.CORS_ALLOWED_ORIGINS; } else { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://non-consentito.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('cors: nessuna CORS_ALLOWED_ORIGINS configurata, nessuna origine riceve il header', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.CORS_ALLOWED_ORIGINS;
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente !== undefined) { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://qualsiasi.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});
```

- [ ] **Step 3: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.hardening.test.ts`
Expected: FAIL — nessun header di sicurezza/CORS presente ancora.

- [ ] **Step 4: Aggiungi helmet, cors e trust proxy in `server.ts`**

Aggiungi gli import in cima al file (vicino agli altri import di libreria):

```ts
import helmet from 'helmet';
import cors from 'cors';
```

Dentro `creaApp`, subito dopo `const app = express();` e PRIMA di `app.use(express.json());`, aggiungi:

```ts
  if (process.env.TRUST_PROXY) {
    const valoreNumerico = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(valoreNumerico) ? process.env.TRUST_PROXY : valoreNumerico);
  }

  app.use(helmet());

  const originiConsentite = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.use(cors({ origin: originiConsentite.length > 0 ? originiConsentite : false, credentials: true }));
```

Il resto di `creaApp` (`app.use(express.json())`, `app.use(cookieParser(...))`, tutte le route) resta invariato.

- [ ] **Step 5: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.hardening.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Aggiorna `.env.example`**

In `.env.example`, aggiungi una nuova sezione subito dopo la sezione `# ── Secret ──` esistente (dopo la riga `JWT_SECRET=...`):

```
# ── Hardening (opzionali, nessun default abilitato) ──────────────────────────
# Origini consentite per le richieste cross-site (CORS), separate da virgola.
# Vuoto/assente = nessuna origine cross-site esplicitamente permessa.
# Esempio: CORS_ALLOWED_ORIGINS=https://backoffice.esempio.it,https://pubblico.esempio.it
CORS_ALLOWED_ORIGINS=

# Da impostare SOLO quando il reverse proxy esterno (gestito fuori da questo
# repo) è effettivamente davanti al backend — altrimenti req.ip e i rate
# limiter leggerebbero l'IP del proxy invece di quello del client reale.
# Valori accettati: quelli di Express (es. 'loopback', un numero di hop, un IP/subnet).
TRUST_PROXY=
```

- [ ] **Step 7: Verifica il typecheck e l'intera suite**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc`)
Expected: nessun errore.

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test "src/**/*.test.ts"` (quotato)
Expected: tutti i test passano, nessuna regressione sul resto della suite.

- [ ] **Step 8: Commit**

```bash
git add backend-node/package.json backend-node/pnpm-lock.yaml backend-node/src/server.ts backend-node/src/server.hardening.test.ts .env.example
git commit -m "feat(backend): helmet, CORS configurabile, trust proxy opzionale (hardening Fase 4)"
```

Nota: se `pnpm install`/`pnpm add` ha rigenerato `pnpm-lock.yaml`, includilo nel commit — è tracciato dal repo (vedi CLAUDE.md, gotcha lockfile standalone di `backend-node/`).

---

## Self-Review Notes

- **Spec coverage**: CORS (Task 4, allowlist env-driven, default nessuna origine). Helmet (Task 4, default della libreria). `trust proxy` (Task 4, env-driven, default disattivato). Lockout per-account (Task 1-3: migration, conteggio, guardia in `eseguiLogin`, stesso errore generico, nessuna nuova colonna/meccanismo di sblocco manuale). Fuori scope confermato: lockout OIDC pubblico, sblocco manuale admin, valori di produzione per le nuove env var.
- **Placeholder scan**: nessun TODO/TBD residuo.
- **Type consistency**: `EsitoTentativoLogin` esteso in Task 2, usato identico in Task 3 (`registraTentativoLogin({ ..., esito: 'account_bloccato' })`). `contaTentativiFallitiRecenti(pool, email, finestraMs)` definita in Task 2, chiamata con la stessa firma in Task 3.
