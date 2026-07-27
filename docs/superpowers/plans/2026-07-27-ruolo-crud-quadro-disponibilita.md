# Ruolo backoffice + CRUD "quadro delle disponibilità" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere al backend Node il middleware di autorizzazione per ruolo e il CRUD completo delle entità del "quadro delle disponibilità" (Allegato B, Fase 1, art. B.2-B.4): discipline sportive, istituzioni scolastiche, impianti, spazi sportivi, slot settimana tipo, più la creazione di nuove stagioni. Oggi queste tabelle esistono solo a livello di schema Postgres — nessuna API le tocca, quindi il backoffice non può popolarle senza SQL a mano.

**Architecture:** Stesso pattern già in uso in `backend-node/src/stagioni.ts` e `backend-node/src/repository/*`: repository puro (funzioni che accettano `Db` e query SQL parametrizzate, nessun ORM) + zod per la validazione dell'input HTTP + route Express in `server.ts` protette da `richiedeAutenticazione` + un nuovo middleware `richiedeRuolo(...ruoli)`. Ogni scrittura (create/update) registra un'operazione in `log_operazioni` tramite `registraOperazione` (già esistente, art. B.39) — questo blocco è esplicitamente il "CRUD futuro" per cui quell'helper è stato scritto.

**Tech Stack:** Node.js 24 (esecuzione `.ts` nativa), Express 5.2.1, zod 4.4.3, `pg` 8.22.0, `node:test` nativo, Postgres 18.

## Global Constraints

- Node.js esegue `.ts` nativamente: mai aggiungere un build step, mai importare senza estensione `.ts` esplicita.
- Niente ORM: SQL puro parametrizzato (`$1, $2...`), mai string interpolation nei valori.
- Ogni funzione di repository accetta `Db` (interfaccia in `src/db.ts`, soddisfatta sia da `Pool` che da `PoolClient`), mai `Pool` direttamente — permette di girare dentro transazioni in futuro.
- Risposte HTTP sempre `camelCase` in uscita, errori `{ errore, dettagli? }`, validazione zod su ogni input, mai un endpoint che fida ciecamente il body.
- TDD rigoroso: ogni funzione ha un test scritto e verificato RED prima dell'implementazione. Test contro Postgres reale via `TEST_DATABASE_URL`, skip pulito se non impostata (`{ skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }`).
- Audit log (art. B.39): ogni CREATE/UPDATE (mai le GET/list) chiama `registraOperazione` da `src/repository/logOperazioni.ts` con `attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo }`.
- `log_operazioni.entita_id` è colonna `UUID` (verificato contro Postgres reale): per le entità con PK UUID passare l'id; per `discipline_sportive` (PK `codice` testuale) **omettere** `entitaId` (resta `null`) — il codice resta comunque nel campo `dettaglio`.
- Codici di errore Postgres verificati per davvero contro Postgres 18 (non assunti): `unique_violation` = `23505`, `exclusion_violation` = `23P01`. `import { DatabaseError } from 'pg'` funziona (verificato).
- Tutte le nuove route sotto `/backoffice/*`, protette da `richiedeAutenticazione, richiedeRuolo(...)` — mai esposte senza autenticazione.
- Fixture di test con valori UNIQUE: sempre con suffisso random per-esecuzione (`randomUUID()`), il DB locale persiste tra i run.
- **Fuori scope esplicito per questo piano**: nessuna DELETE hard su nessuna di queste entità (impianti/slot possono essere referenziati da assegnazioni storiche; la cancellazione logica/gestione indisponibilità è materia della Fase 15 normativa, non di questo blocco). Nessuna gestione di `omologazioni` come sottoinsieme validato di `disciplineCompatibili` — sono due campi indipendenti a schema, incrociarli sarebbe una regola di business non scritta nei documenti normativi.

---

## File Structure

- `backend-node/src/erroriDominio.ts` — **nuovo**. Due classi di errore condivise da tutte le repository CRUD di questo blocco (`ErroreValoreDuplicato`, `ErroreNonTrovato`), per evitare 6 copie quasi identiche e per permettere a `server.ts` di fare `instanceof` contro un'unica definizione.
- `backend-node/src/auth/middleware.ts` — **modificato**. Aggiunge `richiedeRuolo(...ruoliConsentiti)`.
- `backend-node/src/backofficeSchema.ts` — **nuovo**. Tutti gli schemi zod di questo blocco (stesso pattern di `auth/schema.ts`, che raccoglie tutti gli schemi auth in un unico file).
- `backend-node/src/discipline.ts` — **nuovo**. Repository discipline sportive.
- `backend-node/src/istituzioni.ts` — **nuovo**. Repository istituzioni scolastiche.
- `backend-node/src/impianti.ts` — **nuovo**. Repository impianti.
- `backend-node/src/spazi.ts` — **nuovo**. Repository spazi sportivi (incl. gestione discipline compatibili via `spazio_disciplina_compatibile`).
- `backend-node/src/slot.ts` — **nuovo**. Repository slot settimana tipo (incl. mappatura dell'errore di sovrapposizione EXCLUDE).
- `backend-node/src/stagioni.ts` — **modificato**. Aggiunge `creaStagione`.
- `backend-node/src/server.ts` — **modificato in ogni task**. Aggiunge le route `/backoffice/*`.
- Un file di test per repository per entità (`src/<entita>.test.ts`, pattern di `src/stagioni.test.ts`) + un file di test HTTP condiviso `src/server.backoffice.test.ts` (pattern di `src/server.test.ts`), esteso da ogni task con i propri scenari.

---

### Task 1: Middleware `richiedeRuolo` + errori di dominio condivisi

**Files:**
- Create: `backend-node/src/erroriDominio.ts`
- Modify: `backend-node/src/auth/middleware.ts`
- Test: `backend-node/src/auth/middleware.test.ts`

**Interfaces:**
- Consumes: `PayloadAccessToken` da `./jwt.ts` (già esistente: `{ sub: string; email: string; ruolo: 'admin' | 'operatore' }`), `RequestAutenticata` (già esistente in `middleware.ts`).
- Produces: `richiedeRuolo(...ruoliConsentiti: Array<'admin' | 'operatore'>): (req: RequestAutenticata, res: Response, next: NextFunction) => void` — usata da TUTTE le route dei task successivi. `ErroreValoreDuplicato` e `ErroreNonTrovato` (entrambe `extends Error`, nessun campo aggiuntivo) da `erroriDominio.ts` — usate da tutte le repository dei task successivi.

- [ ] **Step 1: Scrivere il test RED per `richiedeRuolo`**

```typescript
// backend-node/src/auth/middleware.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richiedeRuolo, type RequestAutenticata } from './middleware.ts';

interface RispostaFinta {
  statusCode: number | null;
  body: unknown;
  status: (code: number) => RispostaFinta;
  json: (body: unknown) => RispostaFinta;
}

function creaRispostaFinta(): RispostaFinta {
  const res: RispostaFinta = {
    statusCode: null,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

test('richiedeRuolo lascia passare un ruolo consentito', () => {
  const req = { utente: { sub: 'u1', email: 'a@b.it', ruolo: 'admin' } } as RequestAutenticata;
  const res = creaRispostaFinta();
  let chiamatoNext = false;

  richiedeRuolo('admin')(req, res as never, () => {
    chiamatoNext = true;
  });

  assert.equal(chiamatoNext, true);
  assert.equal(res.statusCode, null);
});

test('richiedeRuolo rifiuta un ruolo non consentito con 403', () => {
  const req = { utente: { sub: 'u1', email: 'a@b.it', ruolo: 'operatore' } } as RequestAutenticata;
  const res = creaRispostaFinta();
  let chiamatoNext = false;

  richiedeRuolo('admin')(req, res as never, () => {
    chiamatoNext = true;
  });

  assert.equal(chiamatoNext, false);
  assert.equal(res.statusCode, 403);
});

test('richiedeRuolo rifiuta senza utente autenticato con 401', () => {
  const req = {} as RequestAutenticata;
  const res = creaRispostaFinta();
  let chiamatoNext = false;

  richiedeRuolo('admin')(req, res as never, () => {
    chiamatoNext = true;
  });

  assert.equal(chiamatoNext, false);
  assert.equal(res.statusCode, 401);
});

test('richiedeRuolo con più ruoli consente operatore quando ammesso', () => {
  const req = { utente: { sub: 'u1', email: 'a@b.it', ruolo: 'operatore' } } as RequestAutenticata;
  const res = creaRispostaFinta();
  let chiamatoNext = false;

  richiedeRuolo('admin', 'operatore')(req, res as never, () => {
    chiamatoNext = true;
  });

  assert.equal(chiamatoNext, true);
});
```

- [ ] **Step 2: Eseguire il test, verificare che fallisca per compilazione (funzione mancante)**

Run: `cd backend-node && node --test src/auth/middleware.test.ts`
Expected: errore TypeScript/runtime `richiedeRuolo` non esportata da `./middleware.ts` (RED valido: manca la feature, non un typo).

- [ ] **Step 3: Creare `erroriDominio.ts`**

```typescript
// backend-node/src/erroriDominio.ts

// Errori di dominio condivisi dalle repository CRUD del backoffice (distinti da
// auth/errori.ts, che è specifico del flusso di autenticazione). Un'unica definizione
// per classe: i controller in server.ts fanno instanceof contro QUESTE classi, non
// contro copie locali per modulo.
export class ErroreValoreDuplicato extends Error {}
export class ErroreNonTrovato extends Error {}
```

- [ ] **Step 4: Aggiungere `richiedeRuolo` a `middleware.ts`**

Aggiungere in fondo a `backend-node/src/auth/middleware.ts` (il file esistente resta invariato sopra):

```typescript
export function richiedeRuolo(...ruoliConsentiti: Array<PayloadAccessToken['ruolo']>) {
  return (req: RequestAutenticata, res: Response, next: NextFunction): void => {
    if (!req.utente) {
      res.status(401).json({ errore: 'token mancante' });
      return;
    }
    if (!ruoliConsentiti.includes(req.utente.ruolo)) {
      res.status(403).json({ errore: 'ruolo non autorizzato' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 5: Eseguire il test, verificare che passi**

Run: `cd backend-node && node --test src/auth/middleware.test.ts`
Expected: `pass 4`, `fail 0`.

- [ ] **Step 6: Typecheck**

Run: `cd backend-node && pnpm exec tsc` (o `./node_modules/.bin/tsc` se `pnpm exec` desse problemi di workspace)
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/erroriDominio.ts backend-node/src/auth/middleware.ts backend-node/src/auth/middleware.test.ts
git commit -m "feat(backend): richiedeRuolo middleware + shared domain errors"
```

---

### Task 2: Discipline sportive CRUD

**Files:**
- Create: `backend-node/src/discipline.ts`
- Create: `backend-node/src/discipline.test.ts`
- Create: `backend-node/src/backofficeSchema.ts`
- Create: `backend-node/src/server.backoffice.test.ts`
- Modify: `backend-node/src/server.ts`

**Interfaces:**
- Consumes: `Db` da `./db.ts`; `ErroreValoreDuplicato`, `ErroreNonTrovato` da `./erroriDominio.ts` (Task 1); `richiedeRuolo` da `./auth/middleware.ts` (Task 1); `registraOperazione` da `./repository/logOperazioni.ts` (esistente).
- Produces: `Disciplina { codice: string; denominazione: string }`, `creaDisciplina(db, { codice, denominazione }): Promise<Disciplina>`, `listaDiscipline(db): Promise<Disciplina[]>`, `aggiornaDisciplina(db, codice, denominazione): Promise<Disciplina>`. `schemaCreaDisciplina`, `schemaAggiornaDisciplina` (zod) — usati anche da task successivi come precedente nello stesso file.

- [ ] **Step 1: Scrivere il test RED della repository**

```typescript
// backend-node/src/discipline.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaDisciplina, listaDiscipline, aggiornaDisciplina } from './discipline.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'discipline sportive CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());
    const codice = `TST-${randomUUID().slice(0, 8).toUpperCase()}`;

    await t.test('crea e ritrova nella lista', async () => {
      const disciplina = await creaDisciplina(pool, { codice, denominazione: 'Disciplina Test' });
      assert.equal(disciplina.codice, codice);
      assert.equal(disciplina.denominazione, 'Disciplina Test');

      const lista = await listaDiscipline(pool);
      assert.ok(lista.some((d) => d.codice === codice));
    });

    await t.test('crea con codice duplicato viene rifiutata', async () => {
      await assert.rejects(creaDisciplina(pool, { codice, denominazione: 'Altra' }), ErroreValoreDuplicato);
    });

    await t.test('aggiorna la denominazione', async () => {
      const aggiornata = await aggiornaDisciplina(pool, codice, 'Nuovo Nome');
      assert.equal(aggiornata.denominazione, 'Nuovo Nome');
    });

    await t.test('aggiorna un codice inesistente viene rifiutato', async () => {
      await assert.rejects(aggiornaDisciplina(pool, `NON-ESISTE-${randomUUID()}`, 'X'), ErroreNonTrovato);
    });
  },
);
```

- [ ] **Step 2: Eseguire il test, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/discipline.test.ts`
Expected: `Cannot find module './discipline.ts'` (RED valido).

- [ ] **Step 3: Implementare la repository**

```typescript
// backend-node/src/discipline.ts
import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

export interface Disciplina {
  codice: string;
  denominazione: string;
}

interface RigaDisciplina {
  codice: string;
  denominazione: string;
}

function daRiga(r: RigaDisciplina): Disciplina {
  return { codice: r.codice, denominazione: r.denominazione };
}

export interface DatiCreaDisciplina {
  codice: string;
  denominazione: string;
}

export async function creaDisciplina(db: Db, dati: DatiCreaDisciplina): Promise<Disciplina> {
  try {
    const r = await db.query<RigaDisciplina>(
      `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, $2)
       RETURNING codice, denominazione`,
      [dati.codice, dati.denominazione],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('codice disciplina già esistente');
    }
    throw err;
  }
}

export async function listaDiscipline(db: Db): Promise<Disciplina[]> {
  const r = await db.query<RigaDisciplina>(
    `SELECT codice, denominazione FROM discipline_sportive ORDER BY denominazione`,
  );
  return r.rows.map(daRiga);
}

export async function aggiornaDisciplina(db: Db, codice: string, denominazione: string): Promise<Disciplina> {
  const r = await db.query<RigaDisciplina>(
    `UPDATE discipline_sportive SET denominazione = $2 WHERE codice = $1
     RETURNING codice, denominazione`,
    [codice, denominazione],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('disciplina non trovata');
  }
  return daRiga(riga);
}
```

- [ ] **Step 4: Eseguire il test, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/discipline.test.ts`
Expected: `pass 4`, `fail 0`.

- [ ] **Step 5: Creare `backofficeSchema.ts` con gli schemi di questo task**

```typescript
// backend-node/src/backofficeSchema.ts
import { z } from 'zod';

export const schemaCreaDisciplina = z.object({
  codice: z.string().min(1),
  denominazione: z.string().min(1),
});
export type CreaDisciplinaRequest = z.infer<typeof schemaCreaDisciplina>;

export const schemaAggiornaDisciplina = z.object({
  denominazione: z.string().min(1),
});
export type AggiornaDisciplinaRequest = z.infer<typeof schemaAggiornaDisciplina>;
```

- [ ] **Step 6: Scrivere il test HTTP RED**

```typescript
// backend-node/src/server.backoffice.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { hashPassword } from './auth/password.ts';
import { generaAccessToken } from './auth/jwt.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteBackofficeTest(
  pool: Pool,
  ruolo: 'admin' | 'operatore',
): Promise<{ id: string; token: string }> {
  const email = `backoffice-crud-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'CRUD', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessToken({ sub: id, email, ruolo });
  return { id, token };
}

test(
  'CRUD backoffice: discipline sportive (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const codice = `TST-${randomUUID().slice(0, 8).toUpperCase()}`;

    await t.test('senza token: 401', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, { method: 'GET' });
      assert.equal(r.status, 401);
    });

    await t.test('operatore crea una disciplina: 201, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ codice, denominazione: 'Pallavolo Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { codice: string; denominazione: string };
      assert.equal(body.codice, codice);

      const log = await pool.query(
        `SELECT azione, entita_tipo, entita_id FROM log_operazioni
         WHERE utente_backoffice_id = $1 AND azione = 'crea_disciplina_sportiva'`,
        [operatore.id],
      );
      assert.equal(log.rows.length, 1);
      assert.equal(log.rows[0]!.entita_tipo, 'discipline_sportive');
      assert.equal(log.rows[0]!.entita_id, null);
    });

    await t.test('lista include la disciplina creata', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
      const lista = (await r.json()) as { codice: string }[];
      assert.ok(lista.some((d) => d.codice === codice));
    });

    await t.test('creazione con codice duplicato: 409', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ codice, denominazione: 'Altra' }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('body malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Senza codice' }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('aggiorna denominazione: 200, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/discipline/${codice}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Nuovo Nome' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'Nuovo Nome');

      const log = await pool.query(
        `SELECT 1 FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'aggiorna_disciplina_sportiva'`,
        [operatore.id],
      );
      assert.equal(log.rows.length, 1);
    });

    await t.test('aggiorna codice inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/discipline/NON-ESISTE-${randomUUID()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'X' }),
      });
      assert.equal(r.status, 404);
    });
  },
);
```

- [ ] **Step 7: Eseguire il test HTTP, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: fallisce — `/backoffice/discipline` non esiste (404 dove il test attende 401/201/200), oppure errore di import se si prova a importare simboli non ancora esportati da server.ts. RED valido.

- [ ] **Step 8: Wire delle route in `server.ts`**

Aggiungere gli import in cima a `backend-node/src/server.ts` (accanto agli altri import):

```typescript
import { richiedeRuolo } from './auth/middleware.ts';
import { registraOperazione } from './repository/logOperazioni.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';
import { creaDisciplina, listaDiscipline, aggiornaDisciplina } from './discipline.ts';
import { schemaCreaDisciplina, schemaAggiornaDisciplina } from './backofficeSchema.ts';
```

Aggiungere le route dentro `creaApp`, dopo il blocco `/auth/pubblico/me` (prima di `return app;`):

```typescript
  // --- Backoffice: quadro delle disponibilità (Allegato B, Fase 1, art. B.2-B.4) ---
  // Aperto sia ad admin che operatore (SPEC: "operatore: CRUD palestre/slot").

  app.post(
    '/backoffice/discipline',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaDisciplina.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const disciplina = await creaDisciplina(pool, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_disciplina_sportiva',
          entitaTipo: 'discipline_sportive',
          dettaglio: disciplina,
        });
        res.status(201).json(disciplina);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/discipline', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (_req, res) => {
    try {
      res.status(200).json(await listaDiscipline(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/discipline/:codice',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaDisciplina.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const disciplina = await aggiornaDisciplina(pool, req.params.codice, parsed.data.denominazione);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'aggiorna_disciplina_sportiva',
          entitaTipo: 'discipline_sportive',
          dettaglio: disciplina,
        });
        res.status(200).json(disciplina);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 9: Eseguire il test HTTP, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: tutti i subtest passano.

- [ ] **Step 10: Typecheck + intera suite**

Run:
```bash
cd backend-node
pnpm exec tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test "src/**/*.test.ts"
```
Expected: `tsc` senza errori; suite intera verde (nessuna regressione sui test esistenti).

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/discipline.ts backend-node/src/discipline.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.backoffice.test.ts backend-node/src/server.ts
git commit -m "feat(backend): CRUD discipline sportive (Allegato B art. B.2-B.4)"
```

---

### Task 3: Istituzioni scolastiche CRUD

**Files:**
- Create: `backend-node/src/istituzioni.ts`
- Create: `backend-node/src/istituzioni.test.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`
- Modify: `backend-node/src/server.ts`

**Interfaces:**
- Consumes: stesso di Task 2 (`Db`, `ErroreValoreDuplicato`, `ErroreNonTrovato`, `richiedeRuolo`, `registraOperazione`).
- Produces: `Istituzione { id: string; denominazione: string; codiceMeccanografico: string | null; indirizzo: string | null }`, `creaIstituzione(db, dati): Promise<Istituzione>`, `listaIstituzioni(db): Promise<Istituzione[]>`, `trovaIstituzionePerId(db, id): Promise<Istituzione | null>`, `aggiornaIstituzione(db, id, dati): Promise<Istituzione>`. Usato da Task 4 (impianti referenziano `istituzioneScolasticaId`).

- [ ] **Step 1: Scrivere il test RED della repository**

```typescript
// backend-node/src/istituzioni.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaIstituzione, listaIstituzioni, trovaIstituzionePerId, aggiornaIstituzione } from './istituzioni.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'istituzioni scolastiche CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());
    const codiceMecc = `MECC-${randomUUID().slice(0, 8)}`;
    let istituzioneId = '';

    await t.test('crea e ritrova nella lista', async () => {
      const istituzione = await creaIstituzione(pool, {
        denominazione: 'IIS Test',
        codiceMeccanografico: codiceMecc,
        indirizzo: 'Via Test 1',
      });
      istituzioneId = istituzione.id;
      assert.ok(istituzione.id);
      assert.equal(istituzione.codiceMeccanografico, codiceMecc);

      const lista = await listaIstituzioni(pool);
      assert.ok(lista.some((i) => i.id === istituzioneId));
    });

    await t.test('crea senza campi opzionali', async () => {
      const istituzione = await creaIstituzione(pool, { denominazione: 'IIS Minimo' });
      assert.equal(istituzione.codiceMeccanografico, null);
      assert.equal(istituzione.indirizzo, null);
    });

    await t.test('crea con codice meccanografico duplicato viene rifiutata', async () => {
      await assert.rejects(
        creaIstituzione(pool, { denominazione: 'Altra', codiceMeccanografico: codiceMecc }),
        ErroreValoreDuplicato,
      );
    });

    await t.test('trova per id', async () => {
      const trovata = await trovaIstituzionePerId(pool, istituzioneId);
      assert.equal(trovata?.denominazione, 'IIS Test');
    });

    await t.test('trova per id inesistente restituisce null', async () => {
      const trovata = await trovaIstituzionePerId(pool, randomUUID());
      assert.equal(trovata, null);
    });

    await t.test('aggiorna', async () => {
      const aggiornata = await aggiornaIstituzione(pool, istituzioneId, {
        denominazione: 'IIS Test Rinominato',
        indirizzo: 'Via Nuova 2',
      });
      assert.equal(aggiornata.denominazione, 'IIS Test Rinominato');
      assert.equal(aggiornata.indirizzo, 'Via Nuova 2');
      assert.equal(aggiornata.codiceMeccanografico, null);
    });

    await t.test('aggiorna id inesistente viene rifiutato', async () => {
      await assert.rejects(
        aggiornaIstituzione(pool, randomUUID(), { denominazione: 'X' }),
        ErroreNonTrovato,
      );
    });
  },
);
```

- [ ] **Step 2: Eseguire il test, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/istituzioni.test.ts`
Expected: `Cannot find module './istituzioni.ts'`.

- [ ] **Step 3: Implementare la repository**

```typescript
// backend-node/src/istituzioni.ts
import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

export interface Istituzione {
  id: string;
  denominazione: string;
  codiceMeccanografico: string | null;
  indirizzo: string | null;
}

interface RigaIstituzione {
  id: string;
  denominazione: string;
  codice_meccanografico: string | null;
  indirizzo: string | null;
}

function daRiga(r: RigaIstituzione): Istituzione {
  return {
    id: r.id,
    denominazione: r.denominazione,
    codiceMeccanografico: r.codice_meccanografico,
    indirizzo: r.indirizzo,
  };
}

export interface DatiIstituzione {
  denominazione: string;
  codiceMeccanografico?: string;
  indirizzo?: string;
}

export async function creaIstituzione(db: Db, dati: DatiIstituzione): Promise<Istituzione> {
  try {
    const r = await db.query<RigaIstituzione>(
      `INSERT INTO istituzioni_scolastiche (denominazione, codice_meccanografico, indirizzo)
       VALUES ($1, $2, $3)
       RETURNING id, denominazione, codice_meccanografico, indirizzo`,
      [dati.denominazione, dati.codiceMeccanografico ?? null, dati.indirizzo ?? null],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('codice meccanografico già utilizzato');
    }
    throw err;
  }
}

export async function listaIstituzioni(db: Db): Promise<Istituzione[]> {
  const r = await db.query<RigaIstituzione>(
    `SELECT id, denominazione, codice_meccanografico, indirizzo FROM istituzioni_scolastiche ORDER BY denominazione`,
  );
  return r.rows.map(daRiga);
}

export async function trovaIstituzionePerId(db: Db, id: string): Promise<Istituzione | null> {
  const r = await db.query<RigaIstituzione>(
    `SELECT id, denominazione, codice_meccanografico, indirizzo FROM istituzioni_scolastiche WHERE id = $1`,
    [id],
  );
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function aggiornaIstituzione(db: Db, id: string, dati: DatiIstituzione): Promise<Istituzione> {
  try {
    const r = await db.query<RigaIstituzione>(
      `UPDATE istituzioni_scolastiche SET denominazione = $2, codice_meccanografico = $3, indirizzo = $4
       WHERE id = $1
       RETURNING id, denominazione, codice_meccanografico, indirizzo`,
      [id, dati.denominazione, dati.codiceMeccanografico ?? null, dati.indirizzo ?? null],
    );
    const riga = r.rows[0];
    if (!riga) {
      throw new ErroreNonTrovato('istituzione non trovata');
    }
    return daRiga(riga);
  } catch (err) {
    if (err instanceof ErroreNonTrovato) {
      throw err;
    }
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('codice meccanografico già utilizzato');
    }
    throw err;
  }
}
```

- [ ] **Step 4: Eseguire il test, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/istituzioni.test.ts`
Expected: `pass 7`, `fail 0`.

- [ ] **Step 5: Aggiungere gli schemi zod a `backofficeSchema.ts`**

Aggiungere in fondo al file (accanto agli schemi discipline del Task 2):

```typescript
export const schemaCreaIstituzione = z.object({
  denominazione: z.string().min(1),
  codiceMeccanografico: z.string().min(1).optional(),
  indirizzo: z.string().min(1).optional(),
});
export type CreaIstituzioneRequest = z.infer<typeof schemaCreaIstituzione>;

export const schemaAggiornaIstituzione = schemaCreaIstituzione;
export type AggiornaIstituzioneRequest = z.infer<typeof schemaAggiornaIstituzione>;
```

- [ ] **Step 6: Aggiungere gli scenari HTTP RED a `server.backoffice.test.ts`**

Aggiungere un nuovo blocco `test(...)` in fondo al file (usa lo stesso `avviaServerTest`/`creaUtenteBackofficeTest` già definiti al Task 2 — non ridefinirli):

```typescript
test(
  'CRUD backoffice: istituzioni scolastiche (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const admin = await creaUtenteBackofficeTest(pool, 'admin');
    let istituzioneId = '';

    await t.test('admin crea un\'istituzione: 201, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ denominazione: 'IIS Backoffice Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; denominazione: string };
      istituzioneId = body.id;
      assert.ok(istituzioneId);

      const log = await pool.query(
        `SELECT entita_id FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'crea_istituzione_scolastica'`,
        [admin.id],
      );
      assert.equal(log.rows[0]!.entita_id, istituzioneId);
    });

    await t.test('lista include l\'istituzione creata', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni`, { headers: { Authorization: `Bearer ${admin.token}` } });
      const lista = (await r.json()) as { id: string }[];
      assert.ok(lista.some((i) => i.id === istituzioneId));
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${istituzioneId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'IIS Backoffice Test');
    });

    await t.test('get per id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${randomUUID()}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('aggiorna: 200', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${istituzioneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ denominazione: 'IIS Rinominato' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'IIS Rinominato');
    });
  },
);
```

- [ ] **Step 7: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: il nuovo blocco fallisce (route inesistenti), il blocco discipline del Task 2 continua a passare.

- [ ] **Step 8: Wire delle route in `server.ts`**

Aggiungere import:

```typescript
import { creaIstituzione, listaIstituzioni, trovaIstituzionePerId, aggiornaIstituzione } from './istituzioni.ts';
import { schemaCreaIstituzione, schemaAggiornaIstituzione } from './backofficeSchema.ts';
```

(Nota: `schemaCreaDisciplina, schemaAggiornaDisciplina` già importati da `backofficeSchema.ts` nel Task 2 — aggiungere questi due nomi allo stesso import esistente, non duplicare la riga `import ... from './backofficeSchema.ts'`.)

Aggiungere le route dopo quelle delle discipline:

```typescript
  app.post(
    '/backoffice/istituzioni',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaIstituzione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const istituzione = await creaIstituzione(pool, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_istituzione_scolastica',
          entitaTipo: 'istituzioni_scolastiche',
          entitaId: istituzione.id,
          dettaglio: istituzione,
        });
        res.status(201).json(istituzione);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/istituzioni', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (_req, res) => {
    try {
      res.status(200).json(await listaIstituzioni(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(
    '/backoffice/istituzioni/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const istituzione = await trovaIstituzionePerId(pool, req.params.id);
        if (!istituzione) {
          res.status(404).json({ errore: 'istituzione non trovata' });
          return;
        }
        res.status(200).json(istituzione);
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/istituzioni/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaIstituzione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const istituzione = await aggiornaIstituzione(pool, req.params.id, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'aggiorna_istituzione_scolastica',
          entitaTipo: 'istituzioni_scolastiche',
          entitaId: istituzione.id,
          dettaglio: istituzione,
        });
        res.status(200).json(istituzione);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 9: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: tutti i subtest (discipline + istituzioni) passano.

- [ ] **Step 10: Typecheck + suite intera**

Run:
```bash
cd backend-node
pnpm exec tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test "src/**/*.test.ts"
```

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/istituzioni.ts backend-node/src/istituzioni.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.backoffice.test.ts backend-node/src/server.ts
git commit -m "feat(backend): CRUD istituzioni scolastiche (Doc Principale art. 19)"
```

---

### Task 4: Impianti CRUD

**Files:**
- Create: `backend-node/src/impianti.ts`
- Create: `backend-node/src/impianti.test.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`
- Modify: `backend-node/src/server.ts`

**Interfaces:**
- Consumes: stesso di Task 2/3.
- Produces: `Impianto { id: string; denominazione: string; istituzioneScolasticaId: string | null; indirizzo: string | null }`, `creaImpianto`, `listaImpianti(db, filtroIstituzioneId?: string)`, `trovaImpiantoPerId`, `aggiornaImpianto`. Usato da Task 5 (spazi referenziano `impiantoId`).

- [ ] **Step 1: Test RED della repository**

```typescript
// backend-node/src/impianti.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaImpianto, listaImpianti, trovaImpiantoPerId, aggiornaImpianto } from './impianti.ts';
import { creaIstituzione } from './istituzioni.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'impianti CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const istituzione = await creaIstituzione(pool, { denominazione: `IIS Impianti Test ${randomUUID()}` });
    let impiantoId = '';

    await t.test('crea legato a un\'istituzione e ritrova nella lista', async () => {
      const impianto = await creaImpianto(pool, {
        denominazione: 'Palestra A',
        istituzioneScolasticaId: istituzione.id,
        indirizzo: 'Via Sport 1',
      });
      impiantoId = impianto.id;
      assert.equal(impianto.istituzioneScolasticaId, istituzione.id);

      const lista = await listaImpianti(pool);
      assert.ok(lista.some((i) => i.id === impiantoId));
    });

    await t.test('crea senza istituzione (opzionale)', async () => {
      const impianto = await creaImpianto(pool, { denominazione: 'Palestra Senza Scuola' });
      assert.equal(impianto.istituzioneScolasticaId, null);
    });

    await t.test('lista filtrata per istituzione', async () => {
      const lista = await listaImpianti(pool, istituzione.id);
      assert.ok(lista.length >= 1);
      assert.ok(lista.every((i) => i.istituzioneScolasticaId === istituzione.id));
    });

    await t.test('trova per id', async () => {
      const trovato = await trovaImpiantoPerId(pool, impiantoId);
      assert.equal(trovato?.denominazione, 'Palestra A');
    });

    await t.test('aggiorna', async () => {
      const aggiornato = await aggiornaImpianto(pool, impiantoId, { denominazione: 'Palestra A Rinominata' });
      assert.equal(aggiornato.denominazione, 'Palestra A Rinominata');
    });

    await t.test('aggiorna id inesistente viene rifiutato', async () => {
      await assert.rejects(aggiornaImpianto(pool, randomUUID(), { denominazione: 'X' }), ErroreNonTrovato);
    });
  },
);
```

- [ ] **Step 2: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/impianti.test.ts`
Expected: `Cannot find module './impianti.ts'`.

- [ ] **Step 3: Implementare la repository**

```typescript
// backend-node/src/impianti.ts
import type { Db } from './db.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

export interface Impianto {
  id: string;
  denominazione: string;
  istituzioneScolasticaId: string | null;
  indirizzo: string | null;
}

interface RigaImpianto {
  id: string;
  denominazione: string;
  istituzione_scolastica_id: string | null;
  indirizzo: string | null;
}

function daRiga(r: RigaImpianto): Impianto {
  return {
    id: r.id,
    denominazione: r.denominazione,
    istituzioneScolasticaId: r.istituzione_scolastica_id,
    indirizzo: r.indirizzo,
  };
}

export interface DatiImpianto {
  denominazione: string;
  istituzioneScolasticaId?: string;
  indirizzo?: string;
}

export async function creaImpianto(db: Db, dati: DatiImpianto): Promise<Impianto> {
  const r = await db.query<RigaImpianto>(
    `INSERT INTO impianti (denominazione, istituzione_scolastica_id, indirizzo)
     VALUES ($1, $2, $3)
     RETURNING id, denominazione, istituzione_scolastica_id, indirizzo`,
    [dati.denominazione, dati.istituzioneScolasticaId ?? null, dati.indirizzo ?? null],
  );
  return daRiga(r.rows[0]!);
}

export async function listaImpianti(db: Db, filtroIstituzioneId?: string): Promise<Impianto[]> {
  if (filtroIstituzioneId) {
    const r = await db.query<RigaImpianto>(
      `SELECT id, denominazione, istituzione_scolastica_id, indirizzo FROM impianti
       WHERE istituzione_scolastica_id = $1 ORDER BY denominazione`,
      [filtroIstituzioneId],
    );
    return r.rows.map(daRiga);
  }
  const r = await db.query<RigaImpianto>(
    `SELECT id, denominazione, istituzione_scolastica_id, indirizzo FROM impianti ORDER BY denominazione`,
  );
  return r.rows.map(daRiga);
}

export async function trovaImpiantoPerId(db: Db, id: string): Promise<Impianto | null> {
  const r = await db.query<RigaImpianto>(
    `SELECT id, denominazione, istituzione_scolastica_id, indirizzo FROM impianti WHERE id = $1`,
    [id],
  );
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function aggiornaImpianto(db: Db, id: string, dati: DatiImpianto): Promise<Impianto> {
  const r = await db.query<RigaImpianto>(
    `UPDATE impianti SET denominazione = $2, istituzione_scolastica_id = $3, indirizzo = $4
     WHERE id = $1
     RETURNING id, denominazione, istituzione_scolastica_id, indirizzo`,
    [id, dati.denominazione, dati.istituzioneScolasticaId ?? null, dati.indirizzo ?? null],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('impianto non trovato');
  }
  return daRiga(riga);
}
```

- [ ] **Step 4: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/impianti.test.ts`
Expected: `pass 6`, `fail 0`.

- [ ] **Step 5: Schemi zod**

Aggiungere a `backofficeSchema.ts`:

```typescript
export const schemaCreaImpianto = z.object({
  denominazione: z.string().min(1),
  istituzioneScolasticaId: z.string().uuid().optional(),
  indirizzo: z.string().min(1).optional(),
});
export type CreaImpiantoRequest = z.infer<typeof schemaCreaImpianto>;

export const schemaAggiornaImpianto = schemaCreaImpianto;
export type AggiornaImpiantoRequest = z.infer<typeof schemaAggiornaImpianto>;

export const schemaQueryListaImpianti = z.object({
  istituzioneScolasticaId: z.string().uuid().optional(),
});
```

- [ ] **Step 6: Scenari HTTP RED**

Aggiungere a `server.backoffice.test.ts`:

```typescript
test(
  'CRUD backoffice: impianti (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    let impiantoId = '';

    await t.test('crea impianto senza istituzione: 201', async () => {
      const r = await fetch(`${base}/backoffice/impianti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Palestra HTTP Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string };
      impiantoId = body.id;
    });

    await t.test('istituzioneScolasticaId non valida (non uuid): 400', async () => {
      const r = await fetch(`${base}/backoffice/impianti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'X', istituzioneScolasticaId: 'non-un-uuid' }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
    });

    await t.test('aggiorna: 200', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Palestra Rinominata' }),
      });
      assert.equal(r.status, 200);
    });
  },
);
```

- [ ] **Step 7: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`

- [ ] **Step 8: Wire delle route**

Import da aggiungere/estendere in `server.ts`:

```typescript
import { creaImpianto, listaImpianti, trovaImpiantoPerId, aggiornaImpianto } from './impianti.ts';
import { schemaCreaImpianto, schemaAggiornaImpianto, schemaQueryListaImpianti } from './backofficeSchema.ts';
```

Route (dopo quelle delle istituzioni):

```typescript
  app.post(
    '/backoffice/impianti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaImpianto.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const impianto = await creaImpianto(pool, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_impianto',
          entitaTipo: 'impianti',
          entitaId: impianto.id,
          dettaglio: impianto,
        });
        res.status(201).json(impianto);
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/impianti', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    const parsed = schemaQueryListaImpianti.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      res.status(200).json(await listaImpianti(pool, parsed.data.istituzioneScolasticaId));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/impianti/:id', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    try {
      const impianto = await trovaImpiantoPerId(pool, req.params.id);
      if (!impianto) {
        res.status(404).json({ errore: 'impianto non trovato' });
        return;
      }
      res.status(200).json(impianto);
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/impianti/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaImpianto.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const impianto = await aggiornaImpianto(pool, req.params.id, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'aggiorna_impianto',
          entitaTipo: 'impianti',
          entitaId: impianto.id,
          dettaglio: impianto,
        });
        res.status(200).json(impianto);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 9: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`

- [ ] **Step 10: Typecheck + suite intera**

Run:
```bash
cd backend-node
pnpm exec tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test "src/**/*.test.ts"
```

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/impianti.ts backend-node/src/impianti.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.backoffice.test.ts backend-node/src/server.ts
git commit -m "feat(backend): CRUD impianti (Allegato B art. B.2)"
```

---

### Task 5: Spazi sportivi CRUD (con discipline compatibili)

**Files:**
- Create: `backend-node/src/spazi.ts`
- Create: `backend-node/src/spazi.test.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`
- Modify: `backend-node/src/server.ts`

**Interfaces:**
- Consumes: `Impianto`/`creaImpianto` da Task 4 (per i test); `Db`, errori, `richiedeRuolo`, `registraOperazione` come sopra.
- Produces: `SpazioSportivo { id: string; impiantoId: string; denominazione: string; omologazioni: string[]; note: string | null; disciplineCompatibili: string[] }`, `creaSpazio`, `listaSpaziPerImpianto(db, impiantoId)`, `trovaSpazioPerId`, `aggiornaSpazio`. Usato da Task 6 (slot referenziano `spazioId`).

**Nota di dominio**: `omologazioni` (colonna `TEXT[]` su `spazi_sportivi`, usata da `internal/gara` per l'ammissibilità blocchi gara) e `disciplineCompatibili` (tabella ponte `spazio_disciplina_compatibile`) sono due concetti indipendenti a schema — nessun vincolo che il primo sia sottoinsieme del secondo (sarebbe una regola di business non scritta nei documenti normativi). Il repository gestisce `disciplineCompatibili` con semantica "sostituisci tutto l'insieme" ad ogni update (DELETE + INSERT dentro la stessa funzione, non serve una transazione esplicita: sono comunque due statement sullo stesso `Db`, coerente con l'uso attuale del progetto).

- [ ] **Step 1: Test RED della repository**

```typescript
// backend-node/src/spazi.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaSpazio, listaSpaziPerImpianto, trovaSpazioPerId, aggiornaSpazio } from './spazi.ts';
import { creaImpianto } from './impianti.ts';
import { creaDisciplina } from './discipline.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'spazi sportivi CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const impianto = await creaImpianto(pool, { denominazione: `Impianto Spazi Test ${randomUUID()}` });
    const d1 = await creaDisciplina(pool, { codice: `SPZ-${randomUUID().slice(0, 6)}`, denominazione: 'Disciplina Spazi 1' });
    const d2 = await creaDisciplina(pool, { codice: `SPZ-${randomUUID().slice(0, 6)}`, denominazione: 'Disciplina Spazi 2' });
    let spazioId = '';

    await t.test('crea con omologazioni e discipline compatibili, ritrova nella lista', async () => {
      const spazio = await creaSpazio(pool, {
        impiantoId: impianto.id,
        denominazione: 'Campo Grande',
        omologazioni: [d1.codice],
        note: 'nota di prova',
        disciplineCompatibili: [d1.codice, d2.codice],
      });
      spazioId = spazio.id;
      assert.deepEqual(spazio.omologazioni, [d1.codice]);
      assert.deepEqual([...spazio.disciplineCompatibili].sort(), [d1.codice, d2.codice].sort());

      const lista = await listaSpaziPerImpianto(pool, impianto.id);
      assert.ok(lista.some((s) => s.id === spazioId));
    });

    await t.test('crea senza campi opzionali', async () => {
      const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo Minimo' });
      assert.deepEqual(spazio.omologazioni, []);
      assert.deepEqual(spazio.disciplineCompatibili, []);
      assert.equal(spazio.note, null);
    });

    await t.test('trova per id', async () => {
      const trovato = await trovaSpazioPerId(pool, spazioId);
      assert.equal(trovato?.denominazione, 'Campo Grande');
    });

    await t.test('aggiorna sostituisce interamente le discipline compatibili', async () => {
      const aggiornato = await aggiornaSpazio(pool, spazioId, {
        denominazione: 'Campo Grande Rinominato',
        disciplineCompatibili: [d2.codice],
      });
      assert.deepEqual(aggiornato.disciplineCompatibili, [d2.codice]);
    });

    await t.test('aggiorna id inesistente viene rifiutato', async () => {
      await assert.rejects(
        aggiornaSpazio(pool, randomUUID(), { denominazione: 'X' }),
        ErroreNonTrovato,
      );
    });
  },
);
```

- [ ] **Step 2: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/spazi.test.ts`
Expected: `Cannot find module './spazi.ts'`.

- [ ] **Step 3: Implementare la repository**

```typescript
// backend-node/src/spazi.ts
import type { Db } from './db.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

export interface SpazioSportivo {
  id: string;
  impiantoId: string;
  denominazione: string;
  omologazioni: string[];
  note: string | null;
  disciplineCompatibili: string[];
}

interface RigaSpazio {
  id: string;
  impianto_id: string;
  denominazione: string;
  omologazioni: string[] | null;
  note: string | null;
}

async function disciplineCompatibiliDi(db: Db, spazioId: string): Promise<string[]> {
  const r = await db.query<{ disciplina_codice: string }>(
    `SELECT disciplina_codice FROM spazio_disciplina_compatibile WHERE spazio_id = $1 ORDER BY disciplina_codice`,
    [spazioId],
  );
  return r.rows.map((riga) => riga.disciplina_codice);
}

async function sostituisciDisciplineCompatibili(db: Db, spazioId: string, codici: string[]): Promise<void> {
  await db.query(`DELETE FROM spazio_disciplina_compatibile WHERE spazio_id = $1`, [spazioId]);
  for (const codice of codici) {
    await db.query(
      `INSERT INTO spazio_disciplina_compatibile (spazio_id, disciplina_codice) VALUES ($1, $2)`,
      [spazioId, codice],
    );
  }
}

export interface DatiCreaSpazio {
  impiantoId: string;
  denominazione: string;
  omologazioni?: string[];
  note?: string;
  disciplineCompatibili?: string[];
}

export interface DatiAggiornaSpazio {
  denominazione: string;
  omologazioni?: string[];
  note?: string;
  disciplineCompatibili?: string[];
}

export async function creaSpazio(db: Db, dati: DatiCreaSpazio): Promise<SpazioSportivo> {
  const r = await db.query<RigaSpazio>(
    `INSERT INTO spazi_sportivi (impianto_id, denominazione, omologazioni, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id, impianto_id, denominazione, omologazioni, note`,
    [dati.impiantoId, dati.denominazione, dati.omologazioni ?? [], dati.note ?? null],
  );
  const riga = r.rows[0]!;
  const disciplineCompatibili = dati.disciplineCompatibili ?? [];
  if (disciplineCompatibili.length > 0) {
    await sostituisciDisciplineCompatibili(db, riga.id, disciplineCompatibili);
  }
  return {
    id: riga.id,
    impiantoId: riga.impianto_id,
    denominazione: riga.denominazione,
    omologazioni: riga.omologazioni ?? [],
    note: riga.note,
    disciplineCompatibili,
  };
}

export async function listaSpaziPerImpianto(db: Db, impiantoId: string): Promise<SpazioSportivo[]> {
  const r = await db.query<RigaSpazio>(
    `SELECT id, impianto_id, denominazione, omologazioni, note FROM spazi_sportivi
     WHERE impianto_id = $1 ORDER BY denominazione`,
    [impiantoId],
  );
  const out: SpazioSportivo[] = [];
  for (const riga of r.rows) {
    out.push({
      id: riga.id,
      impiantoId: riga.impianto_id,
      denominazione: riga.denominazione,
      omologazioni: riga.omologazioni ?? [],
      note: riga.note,
      disciplineCompatibili: await disciplineCompatibiliDi(db, riga.id),
    });
  }
  return out;
}

export async function trovaSpazioPerId(db: Db, id: string): Promise<SpazioSportivo | null> {
  const r = await db.query<RigaSpazio>(
    `SELECT id, impianto_id, denominazione, omologazioni, note FROM spazi_sportivi WHERE id = $1`,
    [id],
  );
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return {
    id: riga.id,
    impiantoId: riga.impianto_id,
    denominazione: riga.denominazione,
    omologazioni: riga.omologazioni ?? [],
    note: riga.note,
    disciplineCompatibili: await disciplineCompatibiliDi(db, riga.id),
  };
}

export async function aggiornaSpazio(db: Db, id: string, dati: DatiAggiornaSpazio): Promise<SpazioSportivo> {
  const r = await db.query<RigaSpazio>(
    `UPDATE spazi_sportivi SET denominazione = $2, omologazioni = $3, note = $4
     WHERE id = $1
     RETURNING id, impianto_id, denominazione, omologazioni, note`,
    [id, dati.denominazione, dati.omologazioni ?? [], dati.note ?? null],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('spazio sportivo non trovato');
  }
  if (dati.disciplineCompatibili !== undefined) {
    await sostituisciDisciplineCompatibili(db, id, dati.disciplineCompatibili);
  }
  return {
    id: riga.id,
    impiantoId: riga.impianto_id,
    denominazione: riga.denominazione,
    omologazioni: riga.omologazioni ?? [],
    note: riga.note,
    disciplineCompatibili: await disciplineCompatibiliDi(db, id),
  };
}
```

- [ ] **Step 4: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/spazi.test.ts`
Expected: `pass 5`, `fail 0`.

- [ ] **Step 5: Schemi zod**

Aggiungere a `backofficeSchema.ts`:

```typescript
export const schemaCreaSpazio = z.object({
  impiantoId: z.string().uuid(),
  denominazione: z.string().min(1),
  omologazioni: z.array(z.string().min(1)).optional(),
  note: z.string().min(1).optional(),
  disciplineCompatibili: z.array(z.string().min(1)).optional(),
});
export type CreaSpazioRequest = z.infer<typeof schemaCreaSpazio>;

export const schemaAggiornaSpazio = z.object({
  denominazione: z.string().min(1),
  omologazioni: z.array(z.string().min(1)).optional(),
  note: z.string().min(1).optional(),
  disciplineCompatibili: z.array(z.string().min(1)).optional(),
});
export type AggiornaSpazioRequest = z.infer<typeof schemaAggiornaSpazio>;
```

- [ ] **Step 6: Scenari HTTP RED**

Aggiungere a `server.backoffice.test.ts` (route annidate sotto l'impianto):

```typescript
test(
  'CRUD backoffice: spazi sportivi (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const impianto = await pool.query<{ id: string }>(
      `INSERT INTO impianti (denominazione) VALUES ('Impianto Spazi HTTP') RETURNING id`,
    );
    const impiantoId = impianto.rows[0]!.id;
    let spazioId = '';

    await t.test('crea uno spazio dentro l\'impianto: 201', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}/spazi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Campo HTTP Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; impiantoId: string };
      spazioId = body.id;
      assert.equal(body.impiantoId, impiantoId);
    });

    await t.test('lista spazi dell\'impianto', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}/spazi`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      const lista = (await r.json()) as { id: string }[];
      assert.ok(lista.some((s) => s.id === spazioId));
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/spazi/${spazioId}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r.status, 200);
    });

    await t.test('aggiorna: 200', async () => {
      const r = await fetch(`${base}/backoffice/spazi/${spazioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Campo Rinominato' }),
      });
      assert.equal(r.status, 200);
    });
  },
);
```

- [ ] **Step 7: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`

- [ ] **Step 8: Wire delle route**

Import in `server.ts`:

```typescript
import { creaSpazio, listaSpaziPerImpianto, trovaSpazioPerId, aggiornaSpazio } from './spazi.ts';
import { schemaCreaSpazio, schemaAggiornaSpazio } from './backofficeSchema.ts';
```

Route (dopo quelle di impianti):

```typescript
  app.post(
    '/backoffice/impianti/:impiantoId/spazi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaSpazio.omit({ impiantoId: true }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const spazio = await creaSpazio(pool, { ...parsed.data, impiantoId: req.params.impiantoId });
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_spazio_sportivo',
          entitaTipo: 'spazi_sportivi',
          entitaId: spazio.id,
          dettaglio: spazio,
        });
        res.status(201).json(spazio);
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/impianti/:impiantoId/spazi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        res.status(200).json(await listaSpaziPerImpianto(pool, req.params.impiantoId));
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/spazi/:id', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    try {
      const spazio = await trovaSpazioPerId(pool, req.params.id);
      if (!spazio) {
        res.status(404).json({ errore: 'spazio sportivo non trovato' });
        return;
      }
      res.status(200).json(spazio);
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/spazi/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaSpazio.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const spazio = await aggiornaSpazio(pool, req.params.id, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'aggiorna_spazio_sportivo',
          entitaTipo: 'spazi_sportivi',
          entitaId: spazio.id,
          dettaglio: spazio,
        });
        res.status(200).json(spazio);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 9: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`

- [ ] **Step 10: Typecheck + suite intera**

Run:
```bash
cd backend-node
pnpm exec tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test "src/**/*.test.ts"
```

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/spazi.ts backend-node/src/spazi.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.backoffice.test.ts backend-node/src/server.ts
git commit -m "feat(backend): CRUD spazi sportivi con discipline compatibili"
```

---

### Task 6: Slot settimana tipo CRUD (con gestione conflitto EXCLUDE)

**Files:**
- Create: `backend-node/src/slot.ts`
- Create: `backend-node/src/slot.test.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`
- Modify: `backend-node/src/server.ts`

**Interfaces:**
- Consumes: `creaImpianto` (Task 4), `creaSpazio` (Task 5) per i test; `Db`, errori condivisi, `richiedeRuolo`, `registraOperazione`.
- Produces: `SlotSettimanaTipo { id: string; stagioneId: string; spazioId: string; giornoSettimana: number; orarioInizio: string; orarioFine: string; durataMinuti: number; pregiata: boolean; indisponibilePermanente: boolean; note: string | null }`, `creaSlot`, `listaSlotPerStagione(db, stagioneId, filtroSpazioId?)`, `trovaSlotPerId`, `aggiornaSlot`. Nuova classe `ErroreSovrapposizioneSlot` (in questo file, non in `erroriDominio.ts`: è specifica dell'unico vincolo EXCLUDE del progetto, non riusata da altre entità).

- [ ] **Step 1: Test RED della repository**

```typescript
// backend-node/src/slot.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaSlot, listaSlotPerStagione, trovaSlotPerId, aggiornaSlot, ErroreSovrapposizioneSlot } from './slot.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'slot settimana tipo CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2035-09-01', '2036-06-30') RETURNING id`,
      [`slot-test-${randomUUID()}`],
    );
    const stagioneId = stagione.rows[0]!.id;
    const impianto = await creaImpianto(pool, { denominazione: `Impianto Slot Test ${randomUUID()}` });
    const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo Slot Test' });
    let slotId = '';

    await t.test('crea e ritrova nella lista', async () => {
      const slot = await creaSlot(pool, {
        stagioneId,
        spazioId: spazio.id,
        giornoSettimana: 1,
        orarioInizio: '16:30',
        orarioFine: '18:00',
      });
      slotId = slot.id;
      assert.equal(slot.durataMinuti, 90);
      assert.equal(slot.pregiata, false);
      assert.equal(slot.indisponibilePermanente, false);

      const lista = await listaSlotPerStagione(pool, stagioneId);
      assert.ok(lista.some((s) => s.id === slotId));
    });

    await t.test('crea sovrapposto allo stesso spazio/giorno/stagione viene rifiutato', async () => {
      await assert.rejects(
        creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '17:00', orarioFine: '19:00' }),
        ErroreSovrapposizioneSlot,
      );
    });

    await t.test('crea non sovrapposto (giorno diverso) viene accettato', async () => {
      const slot = await creaSlot(pool, {
        stagioneId,
        spazioId: spazio.id,
        giornoSettimana: 2,
        orarioInizio: '16:30',
        orarioFine: '18:00',
      });
      assert.ok(slot.id);
    });

    await t.test('trova per id', async () => {
      const trovato = await trovaSlotPerId(pool, slotId);
      assert.equal(trovato?.giornoSettimana, 1);
    });

    await t.test('lista filtrata per spazio', async () => {
      const lista = await listaSlotPerStagione(pool, stagioneId, spazio.id);
      assert.ok(lista.every((s) => s.spazioId === spazio.id));
    });

    await t.test('aggiorna marcando pregiata e indisponibile_permanente', async () => {
      const aggiornato = await aggiornaSlot(pool, slotId, {
        giornoSettimana: 1,
        orarioInizio: '16:30',
        orarioFine: '18:00',
        pregiata: true,
        indisponibilePermanente: true,
        note: 'fuori uso per lavori',
      });
      assert.equal(aggiornato.pregiata, true);
      assert.equal(aggiornato.indisponibilePermanente, true);
    });

    await t.test('aggiorna id inesistente viene rifiutato', async () => {
      await assert.rejects(
        aggiornaSlot(pool, randomUUID(), {
          giornoSettimana: 1,
          orarioInizio: '10:00',
          orarioFine: '11:00',
          pregiata: false,
          indisponibilePermanente: false,
        }),
        ErroreNonTrovato,
      );
    });
  },
);
```

- [ ] **Step 2: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/slot.test.ts`
Expected: `Cannot find module './slot.ts'`.

- [ ] **Step 3: Implementare la repository**

```typescript
// backend-node/src/slot.ts
import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

// Specifica di questo file, non condivisa: è l'unico vincolo EXCLUDE del progetto
// (art. B.3 — niente sovrapposizioni fisiche sullo stesso spazio/giorno/stagione,
// garantito a livello Postgres, non solo applicativo).
export class ErroreSovrapposizioneSlot extends Error {}

export interface SlotSettimanaTipo {
  id: string;
  stagioneId: string;
  spazioId: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
  indisponibilePermanente: boolean;
  note: string | null;
}

interface RigaSlot {
  id: string;
  stagione_id: string;
  spazio_id: string;
  giorno_settimana: number;
  orario_inizio: string;
  orario_fine: string;
  durata_minuti: number;
  pregiata: boolean;
  indisponibile_permanente: boolean;
  note: string | null;
}

function daRiga(r: RigaSlot): SlotSettimanaTipo {
  return {
    id: r.id,
    stagioneId: r.stagione_id,
    spazioId: r.spazio_id,
    giornoSettimana: r.giorno_settimana,
    orarioInizio: r.orario_inizio,
    orarioFine: r.orario_fine,
    durataMinuti: r.durata_minuti,
    pregiata: r.pregiata,
    indisponibilePermanente: r.indisponibile_permanente,
    note: r.note,
  };
}

const COLONNE_SELECT = `id, stagione_id, spazio_id, giorno_settimana,
  to_char(orario_inizio, 'HH24:MI') AS orario_inizio,
  to_char(orario_fine, 'HH24:MI') AS orario_fine,
  durata_minuti, pregiata, indisponibile_permanente, note`;

export interface DatiCreaSlot {
  stagioneId: string;
  spazioId: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  pregiata?: boolean;
  indisponibilePermanente?: boolean;
  note?: string;
}

export async function creaSlot(db: Db, dati: DatiCreaSlot): Promise<SlotSettimanaTipo> {
  try {
    const r = await db.query<RigaSlot>(
      `INSERT INTO slot_settimana_tipo
         (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine, pregiata, indisponibile_permanente, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLONNE_SELECT}`,
      [
        dati.stagioneId,
        dati.spazioId,
        dati.giornoSettimana,
        dati.orarioInizio,
        dati.orarioFine,
        dati.pregiata ?? false,
        dati.indisponibilePermanente ?? false,
        dati.note ?? null,
      ],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23P01') {
      throw new ErroreSovrapposizioneSlot('la fascia si sovrappone a un\'altra già esistente sullo stesso spazio/giorno/stagione');
    }
    throw err;
  }
}

export async function listaSlotPerStagione(db: Db, stagioneId: string, filtroSpazioId?: string): Promise<SlotSettimanaTipo[]> {
  if (filtroSpazioId) {
    const r = await db.query<RigaSlot>(
      `SELECT ${COLONNE_SELECT} FROM slot_settimana_tipo
       WHERE stagione_id = $1 AND spazio_id = $2
       ORDER BY giorno_settimana, orario_inizio`,
      [stagioneId, filtroSpazioId],
    );
    return r.rows.map(daRiga);
  }
  const r = await db.query<RigaSlot>(
    `SELECT ${COLONNE_SELECT} FROM slot_settimana_tipo WHERE stagione_id = $1 ORDER BY giorno_settimana, orario_inizio`,
    [stagioneId],
  );
  return r.rows.map(daRiga);
}

export async function trovaSlotPerId(db: Db, id: string): Promise<SlotSettimanaTipo | null> {
  const r = await db.query<RigaSlot>(`SELECT ${COLONNE_SELECT} FROM slot_settimana_tipo WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export interface DatiAggiornaSlot {
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  pregiata: boolean;
  indisponibilePermanente: boolean;
  note?: string;
}

export async function aggiornaSlot(db: Db, id: string, dati: DatiAggiornaSlot): Promise<SlotSettimanaTipo> {
  try {
    const r = await db.query<RigaSlot>(
      `UPDATE slot_settimana_tipo
       SET giorno_settimana = $2, orario_inizio = $3, orario_fine = $4, pregiata = $5,
           indisponibile_permanente = $6, note = $7
       WHERE id = $1
       RETURNING ${COLONNE_SELECT}`,
      [id, dati.giornoSettimana, dati.orarioInizio, dati.orarioFine, dati.pregiata, dati.indisponibilePermanente, dati.note ?? null],
    );
    const riga = r.rows[0];
    if (!riga) {
      throw new ErroreNonTrovato('slot non trovato');
    }
    return daRiga(riga);
  } catch (err) {
    if (err instanceof ErroreNonTrovato) {
      throw err;
    }
    if (err instanceof DatabaseError && err.code === '23P01') {
      throw new ErroreSovrapposizioneSlot('la fascia si sovrappone a un\'altra già esistente sullo stesso spazio/giorno/stagione');
    }
    throw err;
  }
}
```

- [ ] **Step 4: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/slot.test.ts`
Expected: `pass 7`, `fail 0`.

- [ ] **Step 5: Schemi zod**

Aggiungere a `backofficeSchema.ts`:

```typescript
const REGEX_ORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

export const schemaCreaSlot = z.object({
  spazioId: z.string().uuid(),
  giornoSettimana: z.number().int().min(1).max(7),
  orarioInizio: z.string().regex(REGEX_ORARIO),
  orarioFine: z.string().regex(REGEX_ORARIO),
  pregiata: z.boolean().optional(),
  indisponibilePermanente: z.boolean().optional(),
  note: z.string().min(1).optional(),
});
export type CreaSlotRequest = z.infer<typeof schemaCreaSlot>;

export const schemaAggiornaSlot = z.object({
  giornoSettimana: z.number().int().min(1).max(7),
  orarioInizio: z.string().regex(REGEX_ORARIO),
  orarioFine: z.string().regex(REGEX_ORARIO),
  pregiata: z.boolean(),
  indisponibilePermanente: z.boolean(),
  note: z.string().min(1).optional(),
});
export type AggiornaSlotRequest = z.infer<typeof schemaAggiornaSlot>;

export const schemaQueryListaSlot = z.object({
  spazioId: z.string().uuid().optional(),
});
```

- [ ] **Step 6: Scenari HTTP RED**

Aggiungere a `server.backoffice.test.ts` (route annidate sotto la stagione):

```typescript
test(
  'CRUD backoffice: slot settimana tipo (server vero, ruolo, conflitto EXCLUDE)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2036-09-01', '2037-06-30') RETURNING id`,
      [`slot-http-${randomUUID()}`],
    );
    const stagioneId = stagione.rows[0]!.id;
    const impianto = await pool.query<{ id: string }>(`INSERT INTO impianti (denominazione) VALUES ('Impianto Slot HTTP') RETURNING id`);
    const spazio = await pool.query<{ id: string }>(
      `INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, 'Campo Slot HTTP') RETURNING id`,
      [impianto.rows[0]!.id],
    );
    const spazioId = spazio.rows[0]!.id;
    let slotId = '';

    await t.test('crea slot dentro la stagione: 201', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ spazioId, giornoSettimana: 1, orarioInizio: '16:30', orarioFine: '18:00' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; durataMinuti: number };
      slotId = body.id;
      assert.equal(body.durataMinuti, 90);
    });

    await t.test('crea slot sovrapposto: 409', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ spazioId, giornoSettimana: 1, orarioInizio: '17:00', orarioFine: '19:00' }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('orario malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ spazioId, giornoSettimana: 1, orarioInizio: '25:99', orarioFine: '18:00' }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('lista slot della stagione', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      const lista = (await r.json()) as { id: string }[];
      assert.ok(lista.some((s) => s.id === slotId));
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/slot/${slotId}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r.status, 200);
    });

    await t.test('aggiorna marcando indisponibile_permanente: 200', async () => {
      const r = await fetch(`${base}/backoffice/slot/${slotId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({
          giornoSettimana: 1,
          orarioInizio: '16:30',
          orarioFine: '18:00',
          pregiata: false,
          indisponibilePermanente: true,
        }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { indisponibilePermanente: boolean };
      assert.equal(body.indisponibilePermanente, true);
    });
  },
);
```

- [ ] **Step 7: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`

- [ ] **Step 8: Wire delle route**

Import in `server.ts`:

```typescript
import { creaSlot, listaSlotPerStagione, trovaSlotPerId, aggiornaSlot, ErroreSovrapposizioneSlot } from './slot.ts';
import { schemaCreaSlot, schemaAggiornaSlot, schemaQueryListaSlot } from './backofficeSchema.ts';
```

Route (dopo quelle degli spazi):

```typescript
  app.post(
    '/backoffice/stagioni/:stagioneId/slot',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaSlot.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const slot = await creaSlot(pool, { ...parsed.data, stagioneId: req.params.stagioneId });
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_slot_settimana_tipo',
          entitaTipo: 'slot_settimana_tipo',
          entitaId: slot.id,
          dettaglio: slot,
        });
        res.status(201).json(slot);
      } catch (err) {
        if (err instanceof ErroreSovrapposizioneSlot) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/stagioni/:stagioneId/slot',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const parsed = schemaQueryListaSlot.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        res.status(200).json(await listaSlotPerStagione(pool, req.params.stagioneId, parsed.data.spazioId));
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/slot/:id', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    try {
      const slot = await trovaSlotPerId(pool, req.params.id);
      if (!slot) {
        res.status(404).json({ errore: 'slot non trovato' });
        return;
      }
      res.status(200).json(slot);
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/slot/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaSlot.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const slot = await aggiornaSlot(pool, req.params.id, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'aggiorna_slot_settimana_tipo',
          entitaTipo: 'slot_settimana_tipo',
          entitaId: slot.id,
          dettaglio: slot,
        });
        res.status(200).json(slot);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreSovrapposizioneSlot) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 9: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`

- [ ] **Step 10: Typecheck + suite intera (due volte, verifica idempotenza)**

Run:
```bash
cd backend-node
pnpm exec tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test "src/**/*.test.ts"
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test "src/**/*.test.ts"
```
Expected: entrambe le esecuzioni verdi (le fixture usano suffissi random, devono restare rieseguibili sul DB persistente).

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/slot.ts backend-node/src/slot.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.backoffice.test.ts backend-node/src/server.ts
git commit -m "feat(backend): CRUD slot settimana tipo (art. B.3, gestione conflitto EXCLUDE)"
```

---

### Task 7: Creazione nuove stagioni (solo admin)

**Files:**
- Modify: `backend-node/src/stagioni.ts`
- Create: `backend-node/src/stagioni.test.ts` (il file esistente è `stagioni.test.ts` — verificare se già presente e nel caso ESTENDERLO, non sovrascriverlo: contiene già il test di `listaStagioni`)
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`
- Modify: `backend-node/src/server.ts`

**Interfaces:**
- Consumes: `Stagione` (già esistente in `stagioni.ts`), errori/middleware/audit condivisi.
- Produces: `creaStagione(db, dati): Promise<Stagione>` aggiunta a `stagioni.ts`.

- [ ] **Step 1: Scrivere il test RED (estendere il file esistente `src/stagioni.test.ts`, non sostituirlo)**

Aggiungere in fondo al file esistente (che oggi contiene un solo `test(...)` per `listaStagioni`):

```typescript
test(
  'creaStagione contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const nome = `stagione-creata-${randomUUID()}`;
      const stagione = await creaStagione(pool, { nome, dataInizio: '2038-09-01', dataFine: '2039-06-30' });
      assert.equal(stagione.nome, nome);
      assert.equal(stagione.stato, 'censimento');
      assert.equal(stagione.dataInizio, '2038-09-01');
    } finally {
      await pool.end();
    }
  },
);
```

Nota: il file esistente non importa ancora `randomUUID` da `node:crypto` né `creaStagione` — aggiungere questi import in cima, accanto a quelli già presenti (`test`, `assert`, `Pool`, `listaStagioni`).

- [ ] **Step 2: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/stagioni.test.ts`
Expected: `creaStagione` non esportata da `./stagioni.ts`.

- [ ] **Step 3: Aggiungere `creaStagione` a `stagioni.ts`**

Aggiungere in fondo al file esistente (che oggi ha solo `Stagione`, `RigaStagione`, `listaStagioni`):

```typescript
export interface DatiCreaStagione {
  nome: string;
  dataInizio: string;
  dataFine: string;
}

export async function creaStagione(pool: Pool, dati: DatiCreaStagione): Promise<Stagione> {
  const r = await pool.query<RigaStagione>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, $2, $3)
     RETURNING id, nome, data_inizio::text, data_fine::text, stato`,
    [dati.nome, dati.dataInizio, dati.dataFine],
  );
  const riga = r.rows[0]!;
  return {
    id: riga.id,
    nome: riga.nome,
    dataInizio: riga.data_inizio,
    dataFine: riga.data_fine,
    stato: riga.stato,
  };
}
```

- [ ] **Step 4: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/stagioni.test.ts`
Expected: `pass 2`, `fail 0`.

- [ ] **Step 5: Schema zod**

Aggiungere a `backofficeSchema.ts`:

```typescript
export const schemaCreaStagione = z.object({
  nome: z.string().min(1),
  dataInizio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFine: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreaStagioneRequest = z.infer<typeof schemaCreaStagione>;
```

- [ ] **Step 6: Scenari HTTP RED (dimostra `richiedeRuolo('admin')` da solo, non `'admin','operatore'`)**

Aggiungere a `server.backoffice.test.ts`:

```typescript
test(
  'creazione stagioni: solo admin (server vero)',
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

    await t.test('admin crea una stagione: 201, log_operazioni scritto', async () => {
      const nome = `stagione-http-${randomUUID()}`;
      const r = await fetch(`${base}/backoffice/stagioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome, dataInizio: '2039-09-01', dataFine: '2040-06-30' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; nome: string };
      assert.equal(body.nome, nome);

      const log = await pool.query(
        `SELECT entita_id FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'crea_stagione'`,
        [admin.id],
      );
      assert.equal(log.rows[0]!.entita_id, body.id);
    });

    await t.test('operatore NON può creare una stagione: 403', async () => {
      const r = await fetch(`${base}/backoffice/stagioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ nome: `stagione-vietata-${randomUUID()}`, dataInizio: '2040-09-01', dataFine: '2041-06-30' }),
      });
      assert.equal(r.status, 403);
    });
  },
);
```

- [ ] **Step 7: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`

- [ ] **Step 8: Wire della route in `server.ts`**

Import (estendere quello già esistente da `./stagioni.ts`):

```typescript
import { listaStagioni, creaStagione } from './stagioni.ts';
import { schemaCreaStagione } from './backofficeSchema.ts';
```

Route (dopo quelle degli slot, PRIMA di `return app;`):

```typescript
  app.post(
    '/backoffice/stagioni',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaStagione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const stagione = await creaStagione(pool, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_stagione',
          entitaTipo: 'stagioni_sportive',
          entitaId: stagione.id,
          dettaglio: stagione,
        });
        res.status(201).json(stagione);
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 9: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`

- [ ] **Step 10: Typecheck + suite intera, due volte**

Run:
```bash
cd backend-node
pnpm exec tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" TEST_SMTP_URL=smtp://localhost:1025 node --test "src/**/*.test.ts"
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" TEST_SMTP_URL=smtp://localhost:1025 node --test "src/**/*.test.ts"
```
Expected: entrambe verdi, nessuna regressione su nessuno dei test esistenti (auth, OIDC, bootstrap, housekeeping).

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/stagioni.ts backend-node/src/stagioni.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.backoffice.test.ts backend-node/src/server.ts
git commit -m "feat(backend): creazione nuove stagioni (solo admin)"
```

---

### Task 8: Aggiornare la documentazione di progetto

**Files:**
- Modify: `docs/SPEC.md`
- Modify: `CLAUDE.md`

**Interfaces:** Nessuna (solo documentazione).

- [ ] **Step 1: Aggiornare `docs/SPEC.md`**

In §3 "Mappatura normativa", riga "1. Quadro delle disponibilità": cambiare `Schema ✅ · CRUD backoffice ❌ · UI ❌ | Solo schema` in `Schema ✅ · CRUD backoffice ✅ (`/backoffice/{istituzioni,impianti,spazi,discipline,slot,stagioni}`) · UI ❌ | **Fatto (backend)**`.

In §4 Fase 4, punto 1 ("Middleware autorizzazione per ruolo") e punto 3 ("CRUD backoffice: stagioni, istituzioni..."): marcare come fatti con `~~...~~` seguito da `✅ **Fatto**: ...` (stesso stile già usato per i punti 2 e 4 di quella lista).

In §5 "Contratto API": aggiungere alla lista "Esistenti" tutte le nuove route wired in questo piano (`POST/GET /backoffice/discipline`, `PUT /backoffice/discipline/:codice`, `POST/GET /backoffice/istituzioni`, `GET/PUT /backoffice/istituzioni/:id`, `POST/GET /backoffice/impianti`, `GET/PUT /backoffice/impianti/:id`, `POST/GET /backoffice/impianti/:impiantoId/spazi`, `GET/PUT /backoffice/spazi/:id`, `POST/GET /backoffice/stagioni/:stagioneId/slot`, `GET/PUT /backoffice/slot/:id`, `POST /backoffice/stagioni`), rimuovendole dalla lista "Previste".

- [ ] **Step 2: Aggiornare `CLAUDE.md`**

Nella sezione "Backend Node (Fase 4 — in corso)", aggiungere un paragrafo "Fatto — **CRUD quadro delle disponibilità** (Allegato B, Fase 1, art. B.2-B.4)" che descrive: middleware `richiedeRuolo`, le 6 entità con CRUD, la gestione dell'errore di sovrapposizione EXCLUDE (`23P01`) e unique (`23505`), la nota su `log_operazioni.entita_id` essere `UUID` (non usabile per `discipline_sportive`, PK testuale), l'audit log su ogni scrittura.

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md CLAUDE.md
git commit -m "docs: mark ruolo+CRUD quadro disponibilità as done"
```

---

## Self-Review (svolta durante la stesura di questo piano)

**Copertura spec**: Task 1 → Fase 4 punto 1 (SPEC.md). Task 2-6 → Fase 4 punto 3 (CRUD backoffice, tutte le entità elencate). Task 7 → creazione stagioni (implicita nel punto 3, "stagioni" è il primo elemento della lista). Task 8 → chiusura documentale, pattern osservato in ogni blocco precedente di questa sessione. Nessun gap noto entro lo scope dichiarato (DELETE hard e validazione incrociata omologazioni/discipline compatibili sono esclusioni esplicite motivate in "Global Constraints", non dimenticanze).

**Scansione placeholder**: nessun "TBD"/"implementare dopo"/"simile al Task N" nei blocchi di codice — ogni step ha codice completo, specifico per l'entità.

**Coerenza dei tipi**: `Db` (da `src/db.ts`) usato ovunque al posto di `Pool` diretto nelle repository. `ErroreValoreDuplicato`/`ErroreNonTrovato` (Task 1) riusate identiche da Task 2-6 (mai ridefinite). `ErroreSovrapposizioneSlot` definita una sola volta in `slot.ts` (Task 6), non duplicata. Firma di `registraOperazione` (attore/azione/entitaTipo/entitaId/dettaglio) usata in modo identico in ogni route di scrittura. `richiedeRuolo(...ruoli)` con la stessa firma variadica in ogni route.
