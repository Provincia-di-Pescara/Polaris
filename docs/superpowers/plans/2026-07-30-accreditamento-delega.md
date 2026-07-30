# Accreditamento associazione + deleghe gerarchiche — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere a una persona fisica autenticata (SPID/CIE) di accreditare un'associazione (soggetta ad approvazione operatore), caricare documenti di supporto, e delegare altre persone fisiche con auto-approvazione e cascata di revoca gerarchica.

**Architecture:** Backend Node esistente (`backend-node/src`), stesso stile del CRUD backoffice già in produzione: repository con query parametrizzate (`pg`, niente ORM), zod per la validazione, `eseguiInTransazione` per atomicità entità+audit-log, `registraOperazione` per l'audit (art. B.39), mapping errori Postgres condiviso (`erroriDominio.ts`). Due entità pubbliche nuove a livello applicativo (`associazioni.ts`, `abilitazioni.ts`) più un modulo storage file (`documenti/storage.ts`, multer su disco). Nessuna nuova dipendenza infrastrutturale oltre a `multer` e un volume Docker named.

**Tech Stack:** Node.js 24, TypeScript 7.0.2 (no build step), Express 5, zod, `pg`, `multer` (nuova dipendenza), `node --test` contro Postgres 18 reale.

## Global Constraints

- Niente ORM: query SQL parametrizzate dirette, stesso stile di ogni repository esistente (`istituzioni.ts`, `slot.ts`, ecc.).
- Ogni scrittura (CREATE/UPDATE) passa da `registraOperazione` (audit log art. B.39), nella stessa transazione dell'entità via `eseguiInTransazione`.
- Mapping errori: 23505 → `ErroreValoreDuplicato` (409); nessuna riga trovata da repository → `ErroreNonTrovato` (404); 22P02/23503 → `comeErroreRiferimentoNonValido` (400); zod fallito → 400. Mai un SQLSTATE Postgres grezzo esposto al client.
- Test con `node --test` contro Postgres reale (`TEST_DATABASE_URL`), fixture con suffisso `randomUUID()` per evitare collisioni su DB persistente, server HTTP vero (`app.listen(0)` + `fetch`), mai mock del DB.
- `exactOptionalPropertyTypes: true` in `tsconfig.json`: campi opzionali nelle interfacce `Dati*` dichiarati `campo?: T | undefined` esplicito.
- File non ancora `git add`ati per una migration: verificare sempre `up` **e** `down` contro Postgres reale prima di committare (vedi CLAUDE.md sezione Schema DB).
- Niente bind mount nel compose di produzione — solo volumi named.

---

### Task 1: Migration 000007 — catena deleghe + persone_fisiche shell

**Files:**
- Create: `db/migrations/000007_catena_deleghe.up.sql`
- Create: `db/migrations/000007_catena_deleghe.down.sql`

**Interfaces:**
- Produces: colonna `abilitazioni.creata_da_abilitazione_id UUID NULL REFERENCES abilitazioni(id)`; `persone_fisiche.oidc_subject`/`oidc_provider` diventano nullable (erano `NOT NULL`).

- [ ] **Step 1: Scrivere la migration up**

`db/migrations/000007_catena_deleghe.up.sql`:
```sql
-- Catena di sub-deleghe (Doc Principale art. 3-4): una persona già abilitata su
-- un'associazione può delegarne altre senza passare da approvazione operatore
-- (auto-approvata — il delegante è già stato verificato). NULL = prima abilitazione
-- di un'associazione (quella creata insieme all'associazione, l'unica che passa da
-- approvazione operatore). Nessun ON DELETE CASCADE: le abilitazioni non si
-- cancellano mai, solo si marcano 'revocata' (storico sempre presente).
ALTER TABLE abilitazioni
    ADD COLUMN creata_da_abilitazione_id UUID REFERENCES abilitazioni(id);
CREATE INDEX abilitazioni_creata_da_idx ON abilitazioni (creata_da_abilitazione_id);

-- Una persona fisica può essere pre-delegata (creata come "shell" da chi la delega,
-- via codice fiscale) prima di essersi mai autenticata via OIDC. oidc_subject/provider
-- restano NULL finché non fa il primo login reale (repository/personeFisiche.ts la
-- completa per match su codice_fiscale, logica già esistente).
ALTER TABLE persone_fisiche ALTER COLUMN oidc_subject DROP NOT NULL;
ALTER TABLE persone_fisiche ALTER COLUMN oidc_provider DROP NOT NULL;
```

- [ ] **Step 2: Scrivere la migration down**

`db/migrations/000007_catena_deleghe.down.sql`:
```sql
ALTER TABLE persone_fisiche ALTER COLUMN oidc_provider SET NOT NULL;
ALTER TABLE persone_fisiche ALTER COLUMN oidc_subject SET NOT NULL;
DROP INDEX IF EXISTS abilitazioni_creata_da_idx;
ALTER TABLE abilitazioni DROP COLUMN creata_da_abilitazione_id;
```

- [ ] **Step 3: Verificare up/down/up contro Postgres reale**

Con `pg-palestre-dev` (container persistente, porta 5433) già in esecuzione:
```bash
psql postgresql://postgres:test@localhost:5433/palestre -f db/migrations/000007_catena_deleghe.up.sql
psql postgresql://postgres:test@localhost:5433/palestre -c "\d abilitazioni" | grep creata_da
psql postgresql://postgres:test@localhost:5433/palestre -f db/migrations/000007_catena_deleghe.down.sql
psql postgresql://postgres:test@localhost:5433/palestre -f db/migrations/000007_catena_deleghe.up.sql
```
Expected: nessun errore su nessuno dei tre comandi, la colonna compare/scompare come atteso.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/000007_catena_deleghe.up.sql db/migrations/000007_catena_deleghe.down.sql
git commit -m "feat(db): catena sub-deleghe (creata_da_abilitazione_id) + persone_fisiche shell-compatibile"
```

---

### Task 2: Accreditamento associazione (`POST /pubblico/associazioni`)

**Files:**
- Create: `backend-node/src/associazioni.ts`
- Create: `backend-node/src/associazioni.test.ts`
- Modify: `backend-node/src/backofficeSchema.ts` (rinominare mentalmente non serve: gli schemi pubblici vanno in un file nuovo, vedi sotto)
- Create: `backend-node/src/pubblicoSchema.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.pubblico.test.ts` (nuovo file, mirror di `server.backoffice.test.ts` ma per audience `pubblico`)

**Interfaces:**
- Consumes: `Db` da `./db.ts`; `ErroreValoreDuplicato`, `comeErroreRiferimentoNonValido` da `./erroriDominio.ts`; `richiedeAutenticazionePubblico`, `RequestAutenticataPubblico` da `./auth/middleware.ts`; `eseguiInTransazione` (già in `server.ts`); `registraOperazione` da `./repository/logOperazioni.ts`; `generaAccessTokenPubblico` da `./auth/jwtPubblico.ts` (solo nei test).
- Produces: `creaAssociazione(db: Db, dati: DatiCreaAssociazione): Promise<Associazione>`, `trovaAssociazionePerId(db: Db, id: string): Promise<Associazione | null>`, `creaAbilitazionePrincipale(db: Db, dati: { personaFisicaId: string; associazioneId: string; stagioneId: string }): Promise<Abilitazione>` (quest'ultima in `abilitazioni.ts`, Task 4 — qui basta la firma, l'implementazione arriva dopo: per questo task, l'INSERT dell'abilitazione principale si scrive **inline** in `associazioni.ts`, poi Task 4 lo rifattorizza a riusare `abilitazioni.ts` una volta che esiste — vedi Step 3).

- [ ] **Step 1: Scrivere il test RED della repository**

`backend-node/src/associazioni.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaAssociazione, trovaAssociazionePerId } from './associazioni.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'creaAssociazione contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const piva = `PIVA-${randomUUID().slice(0, 8)}`;
      const associazione = await creaAssociazione(pool, {
        denominazione: 'ASD Test Calcio',
        codiceFiscalePartitaIva: piva,
      });
      assert.equal(associazione.denominazione, 'ASD Test Calcio');
      assert.equal(associazione.codiceFiscalePartitaIva, piva);
      assert.equal(associazione.rnaNumeroIscrizione, null);

      const trovata = await trovaAssociazionePerId(pool, associazione.id);
      assert.equal(trovata?.id, associazione.id);

      await assert.rejects(
        () => creaAssociazione(pool, { denominazione: 'Altra', codiceFiscalePartitaIva: piva }),
        ErroreValoreDuplicato,
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'trovaAssociazionePerId su id inesistente ritorna null',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const risultato = await trovaAssociazionePerId(pool, randomUUID());
      assert.equal(risultato, null);
    } finally {
      await pool.end();
    }
  },
);
```

- [ ] **Step 2: Eseguire il test, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/associazioni.test.ts`
Expected: FAIL — `Cannot find module './associazioni.ts'` (o `undefined` su `creaAssociazione`).

- [ ] **Step 3: Implementare `associazioni.ts`**

`backend-node/src/associazioni.ts`:
```ts
import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

export interface Associazione {
  id: string;
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione: string | null;
  dataCostituzione: string | null;
}

interface RigaAssociazione {
  id: string;
  denominazione: string;
  codice_fiscale_partita_iva: string;
  rna_numero_iscrizione: string | null;
  data_costituzione: string | null;
}

function daRiga(r: RigaAssociazione): Associazione {
  return {
    id: r.id,
    denominazione: r.denominazione,
    codiceFiscalePartitaIva: r.codice_fiscale_partita_iva,
    rnaNumeroIscrizione: r.rna_numero_iscrizione,
    dataCostituzione: r.data_costituzione,
  };
}

const COLONNE_SELECT = 'id, denominazione, codice_fiscale_partita_iva, rna_numero_iscrizione, data_costituzione';

export interface DatiCreaAssociazione {
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione?: string | undefined;
  dataCostituzione?: string | undefined;
}

export async function creaAssociazione(db: Db, dati: DatiCreaAssociazione): Promise<Associazione> {
  try {
    const r = await db.query<RigaAssociazione>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva, rna_numero_iscrizione, data_costituzione)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLONNE_SELECT}`,
      [dati.denominazione, dati.codiceFiscalePartitaIva, dati.rnaNumeroIscrizione ?? null, dati.dataCostituzione ?? null],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('associazione già accreditata con questo codice fiscale/partita IVA');
    }
    throw err;
  }
}

export async function trovaAssociazionePerId(db: Db, id: string): Promise<Associazione | null> {
  const r = await db.query<RigaAssociazione>(`SELECT ${COLONNE_SELECT} FROM associazioni WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}
```

- [ ] **Step 4: Eseguire il test, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/associazioni.test.ts`
Expected: PASS, entrambi i test.

- [ ] **Step 5: Creare gli schemi zod pubblici**

`backend-node/src/pubblicoSchema.ts`:
```ts
import { z } from 'zod';

export const schemaCreaAssociazione = z.object({
  denominazione: z.string().min(1),
  codiceFiscalePartitaIva: z.string().min(11).max(16),
  rnaNumeroIscrizione: z.string().min(1).optional(),
  dataCostituzione: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  stagioneId: z.string().uuid(),
});
export type CreaAssociazioneRequest = z.infer<typeof schemaCreaAssociazione>;
```

- [ ] **Step 6: Scrivere lo scenario HTTP RED**

`backend-node/src/server.pubblico.test.ts` (nuovo file):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';

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

async function creaPersonaFisicaTest(pool: Pool): Promise<{ id: string; token: string }> {
  const cf = `TSTPUB${randomUUID().slice(0, 10).toUpperCase()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessTokenPubblico({ sub: id, codiceFiscale: cf, nome: 'Mario', cognome: 'Rossi' });
  return { id, token };
}

async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-pubblico-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

test(
  'POST /pubblico/associazioni crea associazione + abilitazione in_attesa',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const persona = await creaPersonaFisicaTest(pool);
    const stagioneId = await creaStagioneTest(pool);

    await t.test('senza token: 401', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, { method: 'POST' });
      assert.equal(r.status, 401);
    });

    await t.test('con token valido: 201, abilitazione in_attesa creata, log scritto', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify({
          denominazione: 'ASD Volley Pescara',
          codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
          stagioneId,
        }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; denominazione: string };
      assert.equal(body.denominazione, 'ASD Volley Pescara');

      const abilitazione = await pool.query(
        `SELECT stato, titolo, ruolo, creata_da_abilitazione_id FROM abilitazioni
         WHERE persona_fisica_id = $1 AND associazione_id = $2`,
        [persona.id, body.id],
      );
      assert.equal(abilitazione.rows[0]?.stato, 'in_attesa');
      assert.equal(abilitazione.rows[0]?.titolo, 'legale_rappresentante');
      assert.equal(abilitazione.rows[0]?.ruolo, 'rappresentante');
      assert.equal(abilitazione.rows[0]?.creata_da_abilitazione_id, null);

      const log = await pool.query(
        `SELECT azione FROM log_operazioni WHERE persona_fisica_id = $1 AND azione = 'accreditamento_associazione'`,
        [persona.id],
      );
      assert.equal(log.rows.length, 1);
    });

    await t.test('codice fiscale/partita IVA duplicato: 409', async () => {
      const piva = `PIVA-${randomUUID().slice(0, 8)}`;
      const dati = { denominazione: 'ASD Duplicata', codiceFiscalePartitaIva: piva, stagioneId };
      await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(dati),
      });
      const r2 = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(dati),
      });
      assert.equal(r2.status, 409);
    });

    await t.test('stagioneId inesistente: 400', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify({
          denominazione: 'ASD Fantasma',
          codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
          stagioneId: randomUUID(),
        }),
      });
      assert.equal(r.status, 400);
    });
  },
);
```

- [ ] **Step 7: Eseguire il test HTTP, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.pubblico.test.ts`
Expected: FAIL — 404 (rotta non esiste ancora) sui test che si aspettano 201/409/400.

- [ ] **Step 8: Wire della route in `server.ts`**

Aggiungere in cima a `server.ts`, negli import esistenti:
```ts
import { creaAssociazione } from './associazioni.ts';
import { schemaCreaAssociazione } from './pubblicoSchema.ts';
```

Aggiungere la route (prima di `return app;`, dopo l'ultima route esistente):
```ts
  app.post(
    '/pubblico/associazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaAssociazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const associazione = await eseguiInTransazione(pool, async (client) => {
          const a = await creaAssociazione(client, parsed.data);
          await client.query(
            `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
             VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'in_attesa')`,
            [req.persona!.sub, a.id, parsed.data.stagioneId],
          );
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: a.id, ruolo: 'rappresentante' },
            azione: 'accreditamento_associazione',
            entitaTipo: 'associazioni',
            entitaId: a.id,
            dettaglio: a as unknown as Record<string, unknown>,
          });
          return a;
        });
        res.status(201).json(associazione);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

Nota: l'INSERT dell'abilitazione resta inline qui (non ancora in `abilitazioni.ts`, che non esiste finché non arriva il Task 4) — il Task 4 lo rifattorizzerà a chiamare `creaAbilitazionePrincipale` da `abilitazioni.ts` una volta creato, per non duplicare la query SQL tra i due punti.

- [ ] **Step 9: Eseguire il test HTTP, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.pubblico.test.ts`
Expected: PASS, tutti gli scenari.

- [ ] **Step 10: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```
Expected: typecheck pulito, nessuna regressione sulla suite esistente.

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/associazioni.ts backend-node/src/associazioni.test.ts backend-node/src/pubblicoSchema.ts backend-node/src/server.ts backend-node/src/server.pubblico.test.ts
git commit -m "feat(backend): accreditamento associazione (POST /pubblico/associazioni)"
```

---

### Task 3: Upload documenti associazione (`POST /pubblico/associazioni/:id/documenti`)

**Files:**
- Modify: `backend-node/package.json` (dipendenza `multer`)
- Create: `backend-node/src/documenti/storage.ts`
- Modify: `backend-node/src/associazioni.ts` (funzione `creaDocumentoAssociazione`)
- Modify: `backend-node/src/associazioni.test.ts`
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/server.pubblico.test.ts`

**Interfaces:**
- Consumes: `Db`, `Associazione`/`trovaAssociazionePerId` da `./associazioni.ts` (Task 2).
- Produces: `uploadDocumento` (middleware Express, campo multipart `file`) da `./documenti/storage.ts`; `creaDocumentoAssociazione(db: Db, dati: { associazioneId: string; tipo: string; filePath: string }): Promise<DocumentoAssociazione>`.

- [ ] **Step 1: Aggiungere `multer` alle dipendenze**

```bash
cd backend-node
npm pkg set dependencies.multer="^2.0.1"
npm pkg set devDependencies.@types/multer="^1.4.13"
pnpm install
```
Verificare che `pnpm-lock.yaml` sia stato aggiornato (`git status` la mostra come modificata).

- [ ] **Step 2: Scrivere il test RED della repository (documenti)**

Aggiungere in fondo a `backend-node/src/associazioni.test.ts`:
```ts
import { creaDocumentoAssociazione } from './associazioni.ts';

test(
  'creaDocumentoAssociazione contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const piva = `PIVA-${randomUUID().slice(0, 8)}`;
      const associazione = await creaAssociazione(pool, { denominazione: 'ASD Doc Test', codiceFiscalePartitaIva: piva });

      const documento = await creaDocumentoAssociazione(pool, {
        associazioneId: associazione.id,
        tipo: 'statuto',
        filePath: `${randomUUID()}.pdf`,
      });
      assert.equal(documento.associazioneId, associazione.id);
      assert.equal(documento.tipo, 'statuto');

      await assert.rejects(
        () => creaDocumentoAssociazione(pool, { associazioneId: randomUUID(), tipo: 'statuto', filePath: 'x.pdf' }),
      );
    } finally {
      await pool.end();
    }
  },
);
```
(l'import `creaDocumentoAssociazione` va aggiunto alla riga di import esistente in cima al file, non duplicato)

- [ ] **Step 3: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/associazioni.test.ts`
Expected: FAIL — `creaDocumentoAssociazione` non esiste.

- [ ] **Step 4: Implementare `creaDocumentoAssociazione` in `associazioni.ts`**

Aggiungere in fondo a `backend-node/src/associazioni.ts` (import `comeErroreRiferimentoNonValido` da aggiungere alla riga di import esistente):
```ts
export interface DocumentoAssociazione {
  id: string;
  associazioneId: string;
  tipo: string;
  filePath: string;
  caricatoIl: string;
}

interface RigaDocumento {
  id: string;
  associazione_id: string;
  tipo: string;
  file_path: string;
  caricato_il: string;
}

function daRigaDocumento(r: RigaDocumento): DocumentoAssociazione {
  return { id: r.id, associazioneId: r.associazione_id, tipo: r.tipo, filePath: r.file_path, caricatoIl: r.caricato_il };
}

export async function creaDocumentoAssociazione(
  db: Db,
  dati: { associazioneId: string; tipo: string; filePath: string },
): Promise<DocumentoAssociazione> {
  const r = await db.query<RigaDocumento>(
    `INSERT INTO associazioni_documenti (associazione_id, tipo, file_path)
     VALUES ($1, $2, $3)
     RETURNING id, associazione_id, tipo, file_path, caricato_il`,
    [dati.associazioneId, dati.tipo, dati.filePath],
  );
  return daRigaDocumento(r.rows[0]!);
}
```
Nota: `db.query` propaga direttamente l'errore 23503 (FK verso `associazioni` inesistente) — il chiamante (route in `server.ts`) lo mappa con `comeErroreRiferimentoNonValido`, stesso pattern del resto del CRUD; non serve un try/catch qui.

- [ ] **Step 5: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/associazioni.test.ts`
Expected: PASS.

- [ ] **Step 6: Creare il modulo storage**

`backend-node/src/documenti/storage.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';

// Volume Docker named in produzione (mai bind mount, vedi CLAUDE.md), directory locale
// di sviluppo/test di default. Creata a caricamento modulo: multer non la crea da sé.
export function percorsoStorageDocumenti(): string {
  return process.env.DOCUMENTI_STORAGE_PATH ?? path.join(process.cwd(), 'data', 'documenti');
}
mkdirSync(percorsoStorageDocumenti(), { recursive: true });

const MIME_CONSENTITI = new Set(['application/pdf']);
const LIMITE_BYTE = 10 * 1024 * 1024;

// Nome file mai quello dichiarato dal client (path traversal, collisioni): UUID generato
// server-side, estensione presa dal mimetype dichiarato (comunque riverificata sui byte
// reali nella route, vedi Step 8 — il mimetype qui serve solo a scartare subito upload
// palesemente sbagliati prima di scrivere su disco).
export const uploadDocumento = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, percorsoStorageDocumenti()),
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.pdf`),
  }),
  limits: { fileSize: LIMITE_BYTE },
  fileFilter: (_req, file, cb) => {
    cb(null, MIME_CONSENTITI.has(file.mimetype));
  },
}).single('file');
```

- [ ] **Step 7: Aggiungere lo schema zod per il campo `tipo`**

Aggiungere a `backend-node/src/pubblicoSchema.ts`:
```ts
export const schemaCaricaDocumento = z.object({
  tipo: z.enum(['statuto', 'atto_costitutivo', 'altro']),
});
```

- [ ] **Step 8: Scrivere gli scenari HTTP RED**

Aggiungere a `backend-node/src/server.pubblico.test.ts` (import `readFileSync`/`writeFileSync`/`mkdtempSync` da `node:fs` e `tmpdir` da `node:os` in cima al file; impostare `process.env.DOCUMENTI_STORAGE_PATH` a una dir temporanea PRIMA di importare `./server.ts`, perché `documenti/storage.ts` legge la env al load — va fatto con un secondo file `server.pubblico.documenti.test.ts` separato per non condizionare gli altri test che importano `server.ts` per primi. Vedi Step 8b):

- [ ] **Step 8b: Creare `server.pubblico.documenti.test.ts` (file separato per l'env `DOCUMENTI_STORAGE_PATH`)**

`backend-node/src/server.pubblico.documenti.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DOCUMENTI_STORAGE_PATH = mkdtempSync(path.join(tmpdir(), 'polaris-documenti-test-'));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { creaAssociazione } from './associazioni.ts';

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

async function creaPersonaFisicaTest(pool: Pool): Promise<{ id: string; token: string }> {
  const cf = `TSTDOC${randomUUID().slice(0, 10).toUpperCase()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Anna', 'Verdi', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessTokenPubblico({ sub: id, codiceFiscale: cf, nome: 'Anna', cognome: 'Verdi' });
  return { id, token };
}

test(
  'POST /pubblico/associazioni/:id/documenti',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const persona = await creaPersonaFisicaTest(pool);
    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Documenti Test',
      codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
    });
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       SELECT $1, $2, id, 'legale_rappresentante', 'rappresentante', 'in_attesa' FROM stagioni_sportive LIMIT 1`,
      [persona.id, associazione.id],
    );

    const pdfValido = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenuto finto')]);
    const pathPdf = path.join(process.env.DOCUMENTI_STORAGE_PATH!, `sorgente-${randomUUID()}.pdf`);
    writeFileSync(pathPdf, pdfValido);

    await t.test('upload PDF valido: 201, riga in associazioni_documenti', async () => {
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([pdfValido], { type: 'application/pdf' }), 'statuto.pdf');
      const r = await fetch(`${base}/pubblico/associazioni/${associazione.id}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${persona.token}` },
        body: form,
      });
      assert.equal(r.status, 201);

      const doc = await pool.query(`SELECT tipo FROM associazioni_documenti WHERE associazione_id = $1`, [associazione.id]);
      assert.equal(doc.rows[0]?.tipo, 'statuto');
    });

    await t.test('mimetype non PDF: 415', async () => {
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([Buffer.from('non un pdf')], { type: 'text/plain' }), 'file.txt');
      const r = await fetch(`${base}/pubblico/associazioni/${associazione.id}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${persona.token}` },
        body: form,
      });
      assert.equal(r.status, 415);
    });

    await t.test('utente senza abilitazione su quell\'associazione: 403', async () => {
      const estraneo = await creaPersonaFisicaTest(pool);
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([pdfValido], { type: 'application/pdf' }), 'statuto.pdf');
      const r = await fetch(`${base}/pubblico/associazioni/${associazione.id}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${estraneo.token}` },
        body: form,
      });
      assert.equal(r.status, 403);
    });

    await t.test('associazione inesistente: 404', async () => {
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([pdfValido], { type: 'application/pdf' }), 'statuto.pdf');
      const r = await fetch(`${base}/pubblico/associazioni/${randomUUID()}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${persona.token}` },
        body: form,
      });
      assert.equal(r.status, 404);
    });
  },
);
```
(aggiungere `import path from 'node:path';` in cima al file, insieme agli altri import node: già presenti)

- [ ] **Step 9: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.pubblico.documenti.test.ts`
Expected: FAIL — 404 sulla rotta non wired.

- [ ] **Step 10: Wire della route in `server.ts`**

Import da aggiungere:
```ts
import { creaAssociazione, trovaAssociazionePerId, creaDocumentoAssociazione } from './associazioni.ts';
import { schemaCreaAssociazione, schemaCaricaDocumento } from './pubblicoSchema.ts';
import { uploadDocumento } from './documenti/storage.ts';
import { readFile, unlink } from 'node:fs/promises';
```

Route (dopo `POST /pubblico/associazioni`):
```ts
  app.post(
    '/pubblico/associazioni/:id/documenti',
    richiedeAutenticazionePubblico,
    uploadDocumento,
    async (req: RequestAutenticataPubblico, res) => {
      const associazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const file = req.file;
      if (!file) {
        res.status(415).json({ errore: 'file mancante o mimetype non consentito (solo application/pdf)' });
        return;
      }
      const parsed = schemaCaricaDocumento.safeParse(req.body);
      if (!parsed.success) {
        await unlink(file.path).catch(() => {});
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const associazione = await trovaAssociazionePerId(pool, associazioneId);
        if (!associazione) {
          await unlink(file.path).catch(() => {});
          res.status(404).json({ errore: 'associazione non trovata' });
          return;
        }
        const abilitazione = await pool.query(
          `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato IN ('in_attesa', 'approvata') LIMIT 1`,
          [req.persona!.sub, associazioneId],
        );
        if (abilitazione.rows.length === 0) {
          await unlink(file.path).catch(() => {});
          res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione' });
          return;
        }
        // Il mimetype dichiarato dal client non è fidato (fileFilter di multer lo usa solo
        // per scartare subito i casi ovvi): verifica sui primi byte reali del file salvato.
        const intestazione = (await readFile(file.path)).subarray(0, 5).toString('utf8');
        if (intestazione !== '%PDF-') {
          await unlink(file.path).catch(() => {});
          res.status(415).json({ errore: 'il contenuto del file non è un PDF valido' });
          return;
        }
        const documento = await eseguiInTransazione(pool, async (client) => {
          const d = await creaDocumentoAssociazione(client, {
            associazioneId,
            tipo: parsed.data.tipo,
            filePath: file.filename,
          });
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId, ruolo: null },
            azione: 'carica_documento_associazione',
            entitaTipo: 'associazioni_documenti',
            entitaId: d.id,
            dettaglio: d as unknown as Record<string, unknown>,
          });
          return d;
        });
        res.status(201).json(documento);
      } catch (err) {
        await unlink(file.path).catch(() => {});
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```
Nota: multer con `fileFilter` che ritorna `cb(null, false)` (mimetype scartato) fa arrivare la richiesta al gestore comunque, ma con `req.file` `undefined` — da qui il controllo `if (!file)` che copre sia "nessun file allegato" sia "mimetype scartato", stesso 415 per entrambi (distinzione non rilevante per il client).

- [ ] **Step 11: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.pubblico.documenti.test.ts`
Expected: PASS, tutti gli scenari.

- [ ] **Step 12: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```
Expected: pulito, nessuna regressione.

- [ ] **Step 13: Commit**

```bash
git add backend-node/package.json backend-node/pnpm-lock.yaml backend-node/src/documenti backend-node/src/associazioni.ts backend-node/src/associazioni.test.ts backend-node/src/pubblicoSchema.ts backend-node/src/server.ts backend-node/src/server.pubblico.documenti.test.ts
git commit -m "feat(backend): upload documenti associazione (multer, volume named, verifica PDF sui byte)"
```

---

### Task 4: Sub-delega auto-approvata (`POST /pubblico/deleghe`)

**Files:**
- Create: `backend-node/src/abilitazioni.ts`
- Create: `backend-node/src/abilitazioni.test.ts`
- Modify: `backend-node/src/repository/personeFisiche.ts` (nuova funzione shell)
- Modify: `backend-node/src/repository/personeFisiche.test.ts` (se esiste; altrimenti creare i test nello stesso file di `abilitazioni.test.ts`, vedi Step 3)
- Modify: `backend-node/src/pubblicoSchema.ts`
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/server.pubblico.test.ts`

**Interfaces:**
- Consumes: `Db`; `ErroreValoreDuplicato`, `comeErroreRiferimentoNonValido`, `ErroreNonTrovato` da `./erroriDominio.ts`.
- Produces: `creaAbilitazionePrincipale(db, dati): Promise<Abilitazione>`, `trovaAbilitazioneAttiva(db, personaFisicaId, associazioneId, stagioneId): Promise<Abilitazione | null>`, `creaSubDelega(db, dati): Promise<Abilitazione>`, `trovaAbilitazionePerId(db, id): Promise<Abilitazione | null>` in `abilitazioni.ts`; `trovaPersonaFisicaPerCf(pool, cf): Promise<PersonaFisica | null>` e `creaPersonaFisicaShell(pool, dati): Promise<PersonaFisica>` in `repository/personeFisiche.ts`.

- [ ] **Step 1: Verificare che `trovaOCreaPersonaFisica` già gestisca lo shell (nessuna modifica necessaria lì)**

Leggere `backend-node/src/repository/personeFisiche.ts`: il ramo "match per codice_fiscale" (righe con `perCf`) già fa `UPDATE ... SET oidc_subject = $3, oidc_provider = $4 ...` quando trova una riga per CF — questo è esattamente il comportamento che serve per completare uno shell al primo login reale. **Nessuna modifica a questa funzione.** Serve solo aggiungere le due funzioni nuove sotto.

- [ ] **Step 2: Scrivere il test RED per lo shell**

Aggiungere in fondo a `backend-node/src/repository/personeFisiche.test.ts` (se il file non esiste ancora, crearlo con questo contenuto più gli import standard `node:test`/`assert`/`Pool`/`randomUUID`):
```ts
import { creaPersonaFisicaShell, trovaPersonaFisicaPerCf, trovaOCreaPersonaFisica } from './personeFisiche.ts';

test(
  'creaPersonaFisicaShell + completamento al primo login reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const cf = `TSTSHL${randomUUID().slice(0, 10).toUpperCase()}`;
      const shell = await creaPersonaFisicaShell(pool, { codiceFiscale: cf, nome: 'Luca', cognome: 'Bianchi' });
      assert.equal(shell.codiceFiscale, cf);

      const trovato = await trovaPersonaFisicaPerCf(pool, cf);
      assert.equal(trovato?.id, shell.id);

      const dopoLogin = await trovaOCreaPersonaFisica(pool, {
        codiceFiscale: cf,
        nome: 'Luca',
        cognome: 'Bianchi',
        oidcSubject: randomUUID(),
        oidcProvider: 'spid',
      });
      assert.equal(dopoLogin.id, shell.id, 'il login reale deve completare lo shell esistente, non crearne uno nuovo');
    } finally {
      await pool.end();
    }
  },
);
```
(se il file `personeFisiche.test.ts` non esiste, aggiungere anche in cima: `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { randomUUID } from 'node:crypto'; import { Pool } from 'pg'; const dsn = process.env.TEST_DATABASE_URL;`)

- [ ] **Step 3: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/repository/personeFisiche.test.ts`
Expected: FAIL — `creaPersonaFisicaShell`/`trovaPersonaFisicaPerCf` non esistono.

- [ ] **Step 4: Implementare le due funzioni in `repository/personeFisiche.ts`**

Aggiungere in fondo al file (riusa `RigaPersona`/`daRiga` già definiti):
```ts
export async function trovaPersonaFisicaPerCf(pool: Pool, codiceFiscale: string): Promise<PersonaFisica | null> {
  const r = await pool.query<RigaPersona>(
    'SELECT id, codice_fiscale, nome, cognome FROM persone_fisiche WHERE codice_fiscale = $1',
    [codiceFiscale],
  );
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

// Crea una persona fisica "shell": nessun login OIDC ancora avvenuto (oidc_subject/
// oidc_provider NULL, colonne resa nullable dalla migration 000007). Usata quando una
// persona già abilitata delega qualcuno che non si è mai autenticato sulla piattaforma.
// trovaOCreaPersonaFisica completa questa riga al primo login reale per match su CF
// (logica già esistente in quella funzione, invariata).
export async function creaPersonaFisicaShell(
  pool: Pool,
  dati: { codiceFiscale: string; nome: string; cognome: string },
): Promise<PersonaFisica> {
  const r = await pool.query<RigaPersona>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome)
     VALUES ($1, $2, $3)
     RETURNING id, codice_fiscale, nome, cognome`,
    [dati.codiceFiscale, dati.nome, dati.cognome],
  );
  return daRiga(r.rows[0]!);
}
```

- [ ] **Step 5: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/repository/personeFisiche.test.ts`
Expected: PASS.

- [ ] **Step 6: Scrivere il test RED della repository `abilitazioni.ts`**

`backend-node/src/abilitazioni.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaAssociazione } from './associazioni.ts';
import { creaPersonaFisicaShell } from './repository/personeFisiche.ts';
import {
  creaAbilitazionePrincipale,
  trovaAbilitazioneAttiva,
  creaSubDelega,
  trovaAbilitazionePerId,
} from './abilitazioni.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function fixture(pool: Pool) {
  const associazione = await creaAssociazione(pool, {
    denominazione: 'ASD Abilitazioni Test',
    codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
  });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2031-09-01', '2032-06-30') RETURNING id`,
    [`stagione-abilitazioni-${randomUUID()}`],
  );
  const rappresentante = await creaPersonaFisicaShell(pool, {
    codiceFiscale: `TSTRPR${randomUUID().slice(0, 10).toUpperCase()}`,
    nome: 'Giulia',
    cognome: 'Neri',
  });
  return { associazioneId: associazione.id, stagioneId: stagione.rows[0]!.id, rappresentanteId: rappresentante.id };
}

test(
  'creaAbilitazionePrincipale + trovaAbilitazioneAttiva',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const f = await fixture(pool);
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: f.rappresentanteId,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
      });
      assert.equal(principale.stato, 'in_attesa');
      assert.equal(principale.titolo, 'legale_rappresentante');
      assert.equal(principale.creataDaAbilitazioneId, null);

      const nonAttiva = await trovaAbilitazioneAttiva(pool, f.rappresentanteId, f.associazioneId, f.stagioneId);
      assert.equal(nonAttiva, null, 'in_attesa non è attiva finché non approvata');

      await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [principale.id]);
      const attiva = await trovaAbilitazioneAttiva(pool, f.rappresentanteId, f.associazioneId, f.stagioneId);
      assert.equal(attiva?.id, principale.id);
    } finally {
      await pool.end();
    }
  },
);

test(
  'creaSubDelega: auto-approvata, catena tracciata, duplicato 409',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const f = await fixture(pool);
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: f.rappresentanteId,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
      });
      await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [principale.id]);

      const delegato = await creaPersonaFisicaShell(pool, {
        codiceFiscale: `TSTDEL${randomUUID().slice(0, 10).toUpperCase()}`,
        nome: 'Marco',
        cognome: 'Blu',
      });
      const subDelega = await creaSubDelega(pool, {
        personaFisicaId: delegato.id,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
        ruolo: 'operatore',
        creataDaAbilitazioneId: principale.id,
      });
      assert.equal(subDelega.stato, 'approvata');
      assert.equal(subDelega.titolo, 'delegato');
      assert.equal(subDelega.creataDaAbilitazioneId, principale.id);

      const trovata = await trovaAbilitazionePerId(pool, subDelega.id);
      assert.equal(trovata?.id, subDelega.id);

      await assert.rejects(
        () =>
          creaSubDelega(pool, {
            personaFisicaId: delegato.id,
            associazioneId: f.associazioneId,
            stagioneId: f.stagioneId,
            ruolo: 'rappresentante',
            creataDaAbilitazioneId: principale.id,
          }),
        ErroreValoreDuplicato,
      );
    } finally {
      await pool.end();
    }
  },
);
```

- [ ] **Step 7: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/abilitazioni.test.ts`
Expected: FAIL — modulo `abilitazioni.ts` non esiste.

- [ ] **Step 8: Implementare `abilitazioni.ts`**

`backend-node/src/abilitazioni.ts`:
```ts
import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

export interface Abilitazione {
  id: string;
  personaFisicaId: string;
  associazioneId: string | null;
  istituzioneScolasticaId: string | null;
  stagioneId: string;
  titolo: 'legale_rappresentante' | 'delegato';
  ruolo: 'rappresentante' | 'operatore';
  stato: 'in_attesa' | 'approvata' | 'respinta' | 'revocata';
  motivazione: string | null;
  creataDaAbilitazioneId: string | null;
}

interface RigaAbilitazione {
  id: string;
  persona_fisica_id: string;
  associazione_id: string | null;
  istituzione_scolastica_id: string | null;
  stagione_id: string;
  titolo: 'legale_rappresentante' | 'delegato';
  ruolo: 'rappresentante' | 'operatore';
  stato: 'in_attesa' | 'approvata' | 'respinta' | 'revocata';
  motivazione: string | null;
  creata_da_abilitazione_id: string | null;
}

function daRiga(r: RigaAbilitazione): Abilitazione {
  return {
    id: r.id,
    personaFisicaId: r.persona_fisica_id,
    associazioneId: r.associazione_id,
    istituzioneScolasticaId: r.istituzione_scolastica_id,
    stagioneId: r.stagione_id,
    titolo: r.titolo,
    ruolo: r.ruolo,
    stato: r.stato,
    motivazione: r.motivazione,
    creataDaAbilitazioneId: r.creata_da_abilitazione_id,
  };
}

const COLONNE_SELECT = `id, persona_fisica_id, associazione_id, istituzione_scolastica_id, stagione_id,
  titolo, ruolo, stato, motivazione, creata_da_abilitazione_id`;

export async function creaAbilitazionePrincipale(
  db: Db,
  dati: { personaFisicaId: string; associazioneId: string; stagioneId: string },
): Promise<Abilitazione> {
  const r = await db.query<RigaAbilitazione>(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'in_attesa')
     RETURNING ${COLONNE_SELECT}`,
    [dati.personaFisicaId, dati.associazioneId, dati.stagioneId],
  );
  return daRiga(r.rows[0]!);
}

export async function trovaAbilitazioneAttiva(
  db: Db,
  personaFisicaId: string,
  associazioneId: string,
  stagioneId: string,
): Promise<Abilitazione | null> {
  const r = await db.query<RigaAbilitazione>(
    `SELECT ${COLONNE_SELECT} FROM abilitazioni
     WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stagione_id = $3 AND stato = 'approvata'`,
    [personaFisicaId, associazioneId, stagioneId],
  );
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function creaSubDelega(
  db: Db,
  dati: {
    personaFisicaId: string;
    associazioneId: string;
    stagioneId: string;
    ruolo: 'rappresentante' | 'operatore';
    creataDaAbilitazioneId: string;
  },
): Promise<Abilitazione> {
  try {
    const r = await db.query<RigaAbilitazione>(
      `INSERT INTO abilitazioni
         (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato, decisa_il, creata_da_abilitazione_id)
       VALUES ($1, $2, $3, 'delegato', $4, 'approvata', now(), $5)
       RETURNING ${COLONNE_SELECT}`,
      [dati.personaFisicaId, dati.associazioneId, dati.stagioneId, dati.ruolo, dati.creataDaAbilitazioneId],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('la persona ha già un\'abilitazione attiva su questa associazione per questa stagione');
    }
    throw err;
  }
}

export async function trovaAbilitazionePerId(db: Db, id: string): Promise<Abilitazione | null> {
  const r = await db.query<RigaAbilitazione>(`SELECT ${COLONNE_SELECT} FROM abilitazioni WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}
```

- [ ] **Step 9: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/abilitazioni.test.ts`
Expected: PASS.

- [ ] **Step 10: Rifattorizzare la route `POST /pubblico/associazioni` (Task 2) a riusare `creaAbilitazionePrincipale`**

In `server.ts`, sostituire l'`INSERT` inline nella route `POST /pubblico/associazioni` (Step 8 del Task 2) con:
```ts
          const a = await creaAssociazione(client, parsed.data);
          await creaAbilitazionePrincipale(client, {
            personaFisicaId: req.persona!.sub,
            associazioneId: a.id,
            stagioneId: parsed.data.stagioneId,
          });
```
Aggiungere `creaAbilitazionePrincipale` all'import da `./abilitazioni.ts` (nuova riga di import, insieme alle altre funzioni di questo task).

Rieseguire `node --test src/server.pubblico.test.ts` per conferma nessuna regressione (Expected: PASS, invariato rispetto a prima).

- [ ] **Step 11: Aggiungere lo schema zod per la delega**

Aggiungere a `backend-node/src/pubblicoSchema.ts`:
```ts
export const schemaCreaDelega = z.object({
  codiceFiscale: z.string().min(11).max(16),
  nome: z.string().min(1),
  cognome: z.string().min(1),
  associazioneId: z.string().uuid(),
  stagioneId: z.string().uuid(),
  ruolo: z.enum(['rappresentante', 'operatore']),
});
export type CreaDelegaRequest = z.infer<typeof schemaCreaDelega>;
```

- [ ] **Step 12: Aggiungere gli scenari HTTP RED**

Aggiungere a `backend-node/src/server.pubblico.test.ts` un nuovo blocco `test(...)`:
```ts
test(
  'POST /pubblico/deleghe: sub-delega auto-approvata, catena tracciata',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const rappresentante = await creaPersonaFisicaTest(pool);
    const stagioneId = await creaStagioneTest(pool);
    const rAss = await fetch(`${base}/pubblico/associazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
      body: JSON.stringify({
        denominazione: 'ASD Delega Test',
        codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
        stagioneId,
      }),
    });
    const associazione = (await rAss.json()) as { id: string };
    await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE associazione_id = $1`, [associazione.id]);

    await t.test('rappresentante senza abilitazione attiva su un\'altra associazione: 403', async () => {
      const altraStagione = await creaStagioneTest(pool);
      const r = await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify({
          codiceFiscale: `TSTX${randomUUID().slice(0, 12).toUpperCase()}`,
          nome: 'X',
          cognome: 'Y',
          associazioneId: associazione.id,
          stagioneId: altraStagione,
          ruolo: 'operatore',
        }),
      });
      assert.equal(r.status, 403);
    });

    await t.test('rappresentante approvato delega una persona nuova (mai autenticata): 201, auto-approvata', async () => {
      const cfDelegato = `TSTDEL${randomUUID().slice(0, 10).toUpperCase()}`;
      const r = await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify({
          codiceFiscale: cfDelegato,
          nome: 'Nuovo',
          cognome: 'Delegato',
          associazioneId: associazione.id,
          stagioneId,
          ruolo: 'operatore',
        }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; stato: string; creataDaAbilitazioneId: string | null };
      assert.equal(body.stato, 'approvata');
      assert.ok(body.creataDaAbilitazioneId, 'deve tracciare da quale abilitazione discende');

      const persona = await pool.query(`SELECT id FROM persone_fisiche WHERE codice_fiscale = $1`, [cfDelegato]);
      assert.equal(persona.rows.length, 1, 'deve aver creato la persona fisica shell');
    });

    await t.test('stesso delegato di nuovo sulla stessa associazione+stagione: 409', async () => {
      const cfDelegato = `TSTDUP${randomUUID().slice(0, 10).toUpperCase()}`;
      const dati = {
        codiceFiscale: cfDelegato,
        nome: 'Dup',
        cognome: 'Licato',
        associazioneId: associazione.id,
        stagioneId,
        ruolo: 'operatore',
      };
      await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify(dati),
      });
      const r2 = await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify(dati),
      });
      assert.equal(r2.status, 409);
    });
  },
);
```

- [ ] **Step 13: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.pubblico.test.ts`
Expected: FAIL — 404 sulla rotta non wired.

- [ ] **Step 14: Wire della route `POST /pubblico/deleghe` in `server.ts`**

Import da aggiungere:
```ts
import {
  creaAbilitazionePrincipale,
  trovaAbilitazioneAttiva,
  creaSubDelega,
} from './abilitazioni.ts';
import { schemaCreaAssociazione, schemaCaricaDocumento, schemaCreaDelega } from './pubblicoSchema.ts';
import { trovaPersonaFisicaPerCf, creaPersonaFisicaShell } from './repository/personeFisiche.ts';
```

Route:
```ts
  app.post(
    '/pubblico/deleghe',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaDelega.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const delegante = await trovaAbilitazioneAttiva(
          pool,
          req.persona!.sub,
          parsed.data.associazioneId,
          parsed.data.stagioneId,
        );
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        const subDelega = await eseguiInTransazione(pool, async (client) => {
          let target = await trovaPersonaFisicaPerCf(client as unknown as Parameters<typeof trovaPersonaFisicaPerCf>[0], parsed.data.codiceFiscale);
          if (!target) {
            target = await creaPersonaFisicaShell(client as unknown as Parameters<typeof creaPersonaFisicaShell>[0], {
              codiceFiscale: parsed.data.codiceFiscale,
              nome: parsed.data.nome,
              cognome: parsed.data.cognome,
            });
          }
          const sub = await creaSubDelega(client, {
            personaFisicaId: target.id,
            associazioneId: parsed.data.associazioneId,
            stagioneId: parsed.data.stagioneId,
            ruolo: parsed.data.ruolo,
            creataDaAbilitazioneId: delegante.id,
          });
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'delega_creata',
            entitaTipo: 'abilitazioni',
            entitaId: sub.id,
            dettaglio: sub as unknown as Record<string, unknown>,
          });
          return sub;
        });
        res.status(201).json(subDelega);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```
Nota sul cast `client as unknown as Parameters<...>[0]`: `trovaPersonaFisicaPerCf`/`creaPersonaFisicaShell` sono tipizzate su `Pool` (come tutto `repository/personeFisiche.ts` esistente), ma qui vanno chiamate con un `PoolClient` dentro la transazione per restare atomiche con `creaSubDelega`+`registraOperazione`. **Alternativa più pulita, da preferire se il tempo lo consente**: cambiare la firma di `trovaPersonaFisicaPerCf`/`creaPersonaFisicaShell` per accettare `Db` (l'interfaccia minima in `db.ts`, già soddisfatta sia da `Pool` che da `PoolClient`) invece di `Pool` — coerente con come tutte le altre repository di questo blocco sono tipizzate, e senza cast. Applicare questa alternativa: modificare le firme in `repository/personeFisiche.ts` (Step 4 di questo task) da `pool: Pool` a `db: Db` (import `Db` da `../db.ts`), poi qui chiamarle passando `client` direttamente, nessun cast:
```ts
          let target = await trovaPersonaFisicaPerCf(client, parsed.data.codiceFiscale);
          if (!target) {
            target = await creaPersonaFisicaShell(client, {
              codiceFiscale: parsed.data.codiceFiscale,
              nome: parsed.data.nome,
              cognome: parsed.data.cognome,
            });
          }
```
(questo richiede tornare allo Step 4 e cambiare `pool: Pool` → `db: Db` nelle due firme, e il test dello Step 2 continua a passare invariato perché `Pool` soddisfa `Db`)

- [ ] **Step 15: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.pubblico.test.ts`
Expected: PASS, tutti gli scenari incluso quelli del Task 2.

- [ ] **Step 16: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```
Expected: pulito, nessuna regressione.

- [ ] **Step 17: Commit**

```bash
git add backend-node/src/abilitazioni.ts backend-node/src/abilitazioni.test.ts backend-node/src/repository/personeFisiche.ts backend-node/src/repository/personeFisiche.test.ts backend-node/src/pubblicoSchema.ts backend-node/src/server.ts backend-node/src/server.pubblico.test.ts
git commit -m "feat(backend): sub-delega gerarchica auto-approvata (POST /pubblico/deleghe)"
```

---

### Task 5: Approvazione/rigetto operatore (`PUT /backoffice/deleghe/:id/approva|respingi`)

**Files:**
- Modify: `backend-node/src/abilitazioni.ts` (funzioni `approvaAbilitazione`/`respingiAbilitazione`)
- Modify: `backend-node/src/abilitazioni.test.ts`
- Modify: `backend-node/src/backofficeSchema.ts` (schema rigetto)
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`

**Interfaces:**
- Consumes: `ErroreNonTrovato` da `./erroriDominio.ts`; `richiedeRuolo('admin','operatore')` da `./auth/middleware.ts`.
- Produces: `approvaAbilitazione(db, id, decisaDa): Promise<Abilitazione>`, `respingiAbilitazione(db, id, decisaDa, motivazione): Promise<Abilitazione>`.

- [ ] **Step 1: Aggiungere i test RED delle due funzioni**

Aggiungere in fondo a `backend-node/src/abilitazioni.test.ts`:
```ts
import { approvaAbilitazione, respingiAbilitazione } from './abilitazioni.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

test(
  'approvaAbilitazione: solo prime abilitazioni in_attesa, sub-deleghe escluse',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const f = await fixture(pool);
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: f.rappresentanteId,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
      });
      const operatoreId = randomUUID();

      const approvata = await approvaAbilitazione(pool, principale.id, operatoreId);
      assert.equal(approvata.stato, 'approvata');

      await assert.rejects(() => approvaAbilitazione(pool, principale.id, operatoreId), ErroreNonTrovato, 'non ri-approvabile');

      await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [principale.id]);
      const delegato = await creaPersonaFisicaShell(pool, {
        codiceFiscale: `TSTAPR${randomUUID().slice(0, 10).toUpperCase()}`,
        nome: 'Sara',
        cognome: 'Gialli',
      });
      const subDelega = await creaSubDelega(pool, {
        personaFisicaId: delegato.id,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
        ruolo: 'operatore',
        creataDaAbilitazioneId: principale.id,
      });
      await assert.rejects(
        () => approvaAbilitazione(pool, subDelega.id, operatoreId),
        ErroreNonTrovato,
        'le sub-deleghe non passano da qui, sono già approvata',
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'respingiAbilitazione richiede motivazione',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const f = await fixture(pool);
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: f.rappresentanteId,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
      });
      const respinta = await respingiAbilitazione(pool, principale.id, randomUUID(), 'documentazione incompleta');
      assert.equal(respinta.stato, 'respinta');
      assert.equal(respinta.motivazione, 'documentazione incompleta');
    } finally {
      await pool.end();
    }
  },
);
```

- [ ] **Step 2: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/abilitazioni.test.ts`
Expected: FAIL — `approvaAbilitazione`/`respingiAbilitazione` non esistono.

- [ ] **Step 3: Implementare le due funzioni**

Aggiungere in fondo a `backend-node/src/abilitazioni.ts` (import `ErroreNonTrovato` da aggiungere alla riga di import esistente):
```ts
export async function approvaAbilitazione(db: Db, id: string, decisaDa: string): Promise<Abilitazione> {
  const r = await db.query<RigaAbilitazione>(
    `UPDATE abilitazioni SET stato = 'approvata', decisa_il = now(), decisa_da = $2
     WHERE id = $1 AND creata_da_abilitazione_id IS NULL AND stato = 'in_attesa'
     RETURNING ${COLONNE_SELECT}`,
    [id, decisaDa],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('abilitazione non trovata o non in attesa di approvazione');
  }
  return daRiga(riga);
}

export async function respingiAbilitazione(
  db: Db,
  id: string,
  decisaDa: string,
  motivazione: string,
): Promise<Abilitazione> {
  const r = await db.query<RigaAbilitazione>(
    `UPDATE abilitazioni SET stato = 'respinta', decisa_il = now(), decisa_da = $2, motivazione = $3
     WHERE id = $1 AND creata_da_abilitazione_id IS NULL AND stato = 'in_attesa'
     RETURNING ${COLONNE_SELECT}`,
    [id, decisaDa, motivazione],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('abilitazione non trovata o non in attesa di approvazione');
  }
  return daRiga(riga);
}
```

- [ ] **Step 4: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/abilitazioni.test.ts`
Expected: PASS.

- [ ] **Step 5: Aggiungere lo schema zod per il rigetto**

Aggiungere a `backend-node/src/backofficeSchema.ts`:
```ts
export const schemaRespingiDelega = z.object({
  motivazione: z.string().min(1),
});
export type RespingiDelegaRequest = z.infer<typeof schemaRespingiDelega>;
```

- [ ] **Step 6: Aggiungere gli scenari HTTP RED**

Aggiungere a `backend-node/src/server.backoffice.test.ts` un nuovo blocco `test(...)` (riusa `creaUtenteBackofficeTest`/`avviaServerTest` già definiti in cima al file):
```ts
import { creaAssociazione } from './associazioni.ts';
import { creaAbilitazionePrincipale } from './abilitazioni.ts';

test(
  'PUT /backoffice/deleghe/:id/approva|respingi',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Approvazione Test',
      codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
    });
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2032-09-01', '2033-06-30') RETURNING id`,
      [`stagione-approva-${randomUUID()}`],
    );
    const personaId = randomUUID();
    await pool.query(
      `INSERT INTO persone_fisiche (id, codice_fiscale, nome, cognome) VALUES ($1, $2, 'Test', 'Persona')`,
      [personaId, `TSTPRS${randomUUID().slice(0, 10).toUpperCase()}`],
    );

    await t.test('approva: 200, stato approvata', async () => {
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: personaId,
        associazioneId: associazione.id,
        stagioneId: stagione.rows[0]!.id,
      });
      const r = await fetch(`${base}/backoffice/deleghe/${principale.id}/approva`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { stato: string };
      assert.equal(body.stato, 'approvata');
    });

    await t.test('respingi senza motivazione: 400', async () => {
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: personaId,
        associazioneId: associazione.id,
        stagioneId: stagione.rows[0]!.id,
      });
      const r = await fetch(`${base}/backoffice/deleghe/${principale.id}/respingi`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({}),
      });
      assert.equal(r.status, 400);
    });

    await t.test('respingi con motivazione: 200, stato respinta', async () => {
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: personaId,
        associazioneId: associazione.id,
        stagioneId: stagione.rows[0]!.id,
      });
      const r = await fetch(`${base}/backoffice/deleghe/${principale.id}/respingi`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ motivazione: 'documentazione mancante' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { stato: string; motivazione: string };
      assert.equal(body.stato, 'respinta');
      assert.equal(body.motivazione, 'documentazione mancante');
    });

    await t.test('id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/deleghe/${randomUUID()}/approva`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 404);
    });
  },
);
```

- [ ] **Step 7: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: FAIL — 404 sulle rotte non wired.

- [ ] **Step 8: Wire delle route in `server.ts`**

Import da aggiungere:
```ts
import { approvaAbilitazione, respingiAbilitazione } from './abilitazioni.ts';
import { schemaRespingiDelega } from './backofficeSchema.ts'; // aggiungere alla riga di import esistente da questo file
```

Route:
```ts
  app.put(
    '/backoffice/deleghe/:id/approva',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const abilitazione = await eseguiInTransazione(pool, async (client) => {
          const a = await approvaAbilitazione(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'approva_delega',
            entitaTipo: 'abilitazioni',
            entitaId: a.id,
            dettaglio: a as unknown as Record<string, unknown>,
          });
          return a;
        });
        res.status(200).json(abilitazione);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/deleghe/:id/respingi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaRespingiDelega.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const abilitazione = await eseguiInTransazione(pool, async (client) => {
          const a = await respingiAbilitazione(client, id, req.utente!.sub, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'respingi_delega',
            entitaTipo: 'abilitazioni',
            entitaId: a.id,
            dettaglio: a as unknown as Record<string, unknown>,
          });
          return a;
        });
        res.status(200).json(abilitazione);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 9: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: PASS.

- [ ] **Step 10: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```

- [ ] **Step 11: Commit**

```bash
git add backend-node/src/abilitazioni.ts backend-node/src/abilitazioni.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.ts backend-node/src/server.backoffice.test.ts
git commit -m "feat(backend): approvazione/rigetto prima abilitazione (PUT /backoffice/deleghe/:id/approva|respingi)"
```

---

### Task 6: Revoca con cascata (`PUT /backoffice/deleghe/:id/revoca`)

**Files:**
- Modify: `backend-node/src/abilitazioni.ts` (funzione `revocaAbilitazioneConCascata`)
- Modify: `backend-node/src/abilitazioni.test.ts`
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`

**Interfaces:**
- Produces: `revocaAbilitazioneConCascata(db, id): Promise<Abilitazione[]>` (lancia `ErroreNonTrovato` se `id` non esiste affatto).

- [ ] **Step 1: Scrivere il test RED**

Aggiungere in fondo a `backend-node/src/abilitazioni.test.ts`:
```ts
import { revocaAbilitazioneConCascata } from './abilitazioni.ts';

test(
  'revocaAbilitazioneConCascata: cascata su 3 livelli, idempotente, 404 su id inesistente',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const f = await fixture(pool);
      const livello1 = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: f.rappresentanteId,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
      });
      await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [livello1.id]);

      const personaA = await creaPersonaFisicaShell(pool, {
        codiceFiscale: `TSTCSC1${randomUUID().slice(0, 9).toUpperCase()}`,
        nome: 'A',
        cognome: 'Livello2',
      });
      const livello2 = await creaSubDelega(pool, {
        personaFisicaId: personaA.id,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
        ruolo: 'operatore',
        creataDaAbilitazioneId: livello1.id,
      });

      const personaB = await creaPersonaFisicaShell(pool, {
        codiceFiscale: `TSTCSC2${randomUUID().slice(0, 9).toUpperCase()}`,
        nome: 'B',
        cognome: 'Livello3',
      });
      const livello3 = await creaSubDelega(pool, {
        personaFisicaId: personaB.id,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
        ruolo: 'operatore',
        creataDaAbilitazioneId: livello2.id,
      });

      const revocate = await revocaAbilitazioneConCascata(pool, livello1.id);
      assert.equal(revocate.length, 3, 'deve revocare padre + entrambi i discendenti');
      assert.ok(revocate.every((a) => a.stato === 'revocata'));

      const rilette = await pool.query(`SELECT id, stato FROM abilitazioni WHERE id IN ($1, $2, $3)`, [
        livello1.id,
        livello2.id,
        livello3.id,
      ]);
      assert.ok(rilette.rows.every((r) => r.stato === 'revocata'));

      const secondaVolta = await revocaAbilitazioneConCascata(pool, livello1.id);
      assert.equal(secondaVolta.length, 0, 'idempotente: già tutto revocato, nessuna riga da aggiornare');

      await assert.rejects(() => revocaAbilitazioneConCascata(pool, randomUUID()), ErroreNonTrovato);
    } finally {
      await pool.end();
    }
  },
);
```

- [ ] **Step 2: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/abilitazioni.test.ts`
Expected: FAIL — `revocaAbilitazioneConCascata` non esiste.

- [ ] **Step 3: Implementare la funzione**

Aggiungere in fondo a `backend-node/src/abilitazioni.ts`:
```ts
export async function revocaAbilitazioneConCascata(db: Db, id: string): Promise<Abilitazione[]> {
  const esiste = await db.query('SELECT 1 FROM abilitazioni WHERE id = $1', [id]);
  if (esiste.rows.length === 0) {
    throw new ErroreNonTrovato('abilitazione non trovata');
  }
  const r = await db.query<RigaAbilitazione>(
    `WITH RECURSIVE catena AS (
       SELECT id FROM abilitazioni WHERE id = $1
       UNION ALL
       SELECT a.id FROM abilitazioni a JOIN catena c ON a.creata_da_abilitazione_id = c.id
     )
     UPDATE abilitazioni SET stato = 'revocata', revocata_il = now()
     WHERE id IN (SELECT id FROM catena) AND stato IN ('in_attesa', 'approvata')
     RETURNING ${COLONNE_SELECT}`,
    [id],
  );
  return r.rows.map(daRiga);
}
```

- [ ] **Step 4: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/abilitazioni.test.ts`
Expected: PASS.

- [ ] **Step 5: Aggiungere lo scenario HTTP RED**

Aggiungere a `backend-node/src/server.backoffice.test.ts`:
```ts
test(
  'PUT /backoffice/deleghe/:id/revoca: cascata sulle sub-deleghe',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Revoca Test',
      codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
    });
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2033-09-01', '2034-06-30') RETURNING id`,
      [`stagione-revoca-${randomUUID()}`],
    );
    const personaId = randomUUID();
    await pool.query(
      `INSERT INTO persone_fisiche (id, codice_fiscale, nome, cognome) VALUES ($1, $2, 'Test', 'Revoca')`,
      [personaId, `TSTREV${randomUUID().slice(0, 10).toUpperCase()}`],
    );
    const principale = await creaAbilitazionePrincipale(pool, {
      personaFisicaId: personaId,
      associazioneId: associazione.id,
      stagioneId: stagione.rows[0]!.id,
    });
    await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [principale.id]);

    await t.test('revoca: 200, log_operazioni tracciato', async () => {
      const r = await fetch(`${base}/backoffice/deleghe/${principale.id}/revoca`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);

      const log = await pool.query(
        `SELECT azione FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'revoca_delega'`,
        [operatore.id],
      );
      assert.equal(log.rows.length, 1);
    });

    await t.test('id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/deleghe/${randomUUID()}/revoca`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 404);
    });
  },
);
```

- [ ] **Step 6: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: FAIL — 404 (rotta non wired).

- [ ] **Step 7: Wire della route in `server.ts`**

Import da aggiungere: `revocaAbilitazioneConCascata` alla riga di import esistente da `./abilitazioni.ts`.

Route:
```ts
  app.put(
    '/backoffice/deleghe/:id/revoca',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const revocate = await eseguiInTransazione(pool, async (client) => {
          const lista = await revocaAbilitazioneConCascata(client, id);
          for (const a of lista) {
            await registraOperazione(client, {
              attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
              azione: 'revoca_delega',
              entitaTipo: 'abilitazioni',
              entitaId: a.id,
              dettaglio: a as unknown as Record<string, unknown>,
            });
          }
          return lista;
        });
        res.status(200).json(revocate);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  return app;
}
```
(sostituisce il precedente `return app; }` in fondo al file — questa è l'ultima route del blocco)

- [ ] **Step 8: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck + suite intera completa (tutti i file toccati in questo blocco)**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```
Expected: pulito, nessuna regressione su nessuno dei file esistenti.

- [ ] **Step 10: Commit**

```bash
git add backend-node/src/abilitazioni.ts backend-node/src/abilitazioni.test.ts backend-node/src/server.ts backend-node/src/server.backoffice.test.ts
git commit -m "feat(backend): revoca abilitazione con cascata sulle sub-deleghe (PUT /backoffice/deleghe/:id/revoca)"
```

---

### Task 7: Volume Docker documenti nel compose

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.override.yml`
- Modify: `.env.example`

**Interfaces:**
- Nessuna (solo configurazione infrastrutturale).

- [ ] **Step 1: Aggiungere env + volume a `docker-compose.yml` (produzione)**

In `docker-compose.yml`, dentro `services.backend.environment` (dopo `BACKOFFICE_BASE_URL`):
```yaml
      DOCUMENTI_STORAGE_PATH: /data/documenti
```
Dentro `services.backend` (stesso livello di `environment`/`depends_on`), aggiungere:
```yaml
    volumes:
      - documenti_associazioni:/data/documenti
```
In fondo al file, aggiungere alla sezione `volumes:` di primo livello:
```yaml
  documenti_associazioni:
```

- [ ] **Step 2: Aggiungere il volume anche in sviluppo**

In `docker-compose.override.yml`, dentro `services.backend.volumes` (che già esiste con i bind mount per hot-reload), aggiungere una riga:
```yaml
      - documenti_associazioni_dev:/data/documenti
```
In fondo al file, aggiungere alla sezione `volumes:` di primo livello (che già esiste con `go_mod_cache`/`backend_node_modules`):
```yaml
  documenti_associazioni_dev:
```
(volume separato dal named di produzione — `docker-compose.yml`+`.override.yml` uniti dichiarano entrambi i nomi, non c'è conflitto, e i dati di sviluppo restano isolati da quelli di produzione anche se per errore si esegue lo stack unito su una macchina che ha già uno dei due volumi da un run precedente)

- [ ] **Step 3: Documentare la env in `.env.example`**

Aggiungere in fondo a `.env.example` (o nella sezione più affine, es. vicino a `BACKOFFICE_BASE_URL` se già presente):
```bash
# Path interno al container dove il backend salva i documenti caricati dagli utenti
# (statuti, atti costitutivi — vedi docs/superpowers/specs/2026-07-30-accreditamento-delega-design.md).
# Volume named, mai bind mount in produzione.
DOCUMENTI_STORAGE_PATH=/data/documenti
```

- [ ] **Step 4: Validare la sintassi del compose**

```bash
docker compose -f docker-compose.yml config --quiet
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml docker compose config --quiet
```
Expected: nessun errore su entrambi i comandi (Windows/Git Bash: `COMPOSE_FILE` con `:` come separatore, non `;` — verificare quale funziona in questa shell, `docker compose config` fallisce rumorosamente se sbagliato).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker-compose.override.yml .env.example
git commit -m "feat(compose): volume named per i documenti caricati dagli utenti pubblici"
```

---

### Task 8: Aggiornare la documentazione di progetto

**Files:**
- Modify: `docs/SPEC.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Nessuna (solo documentazione).

- [ ] **Step 1: Aggiornare `docs/SPEC.md`**

Nella sezione "Fase 4 — Backend Node", punto 5 ("Flusso pubblico"), segnare il primo sotto-blocco come fatto:
```markdown
5. **Flusso pubblico** (🔶 in corso, blocco 1/4 fatto): ~~accreditamento associazione + richiesta delega (art. 3-4), approvazione deleghe lato operatore~~ ✅ **Fatto**: `POST /pubblico/associazioni` (+ upload documenti su volume named, verifica PDF sui byte reali), `POST /pubblico/deleghe` (sub-delega gerarchica auto-approvata, catena tracciata via `creata_da_abilitazione_id`, cascata di revoca), `PUT /backoffice/deleghe/:id/{approva,respingi,revoca}`. Design: `docs/superpowers/specs/2026-07-30-accreditamento-delega-design.md`. Restano: domanda con fabbisogni/preferenze/blocchi/giornate gara (B.5-B.6), osservazioni (B.11).
```

Nella sezione "5. Contratto API (superficie prevista)", spostare da "Previste" a "Esistenti": `POST /pubblico/associazioni`, `POST /pubblico/associazioni/:id/documenti`, `POST /pubblico/deleghe`, `PUT /backoffice/deleghe/:id/approva|respingi|revoca`.

- [ ] **Step 2: Aggiornare `CLAUDE.md`**

Nella sezione "Backend Node (Fase 4 — in corso)", dopo il blocco "Fatto — **CRUD quadro delle disponibilità**", aggiungere un nuovo blocco "Fatto" che descriva: entità nuove (`associazioni.ts`, `abilitazioni.ts`), catena di sub-deleghe con `creata_da_abilitazione_id` e cascata di revoca (query ricorsiva), `persone_fisiche` shell (CF senza login OIDC ancora avvenuto, completate al primo login reale dalla logica già esistente in `trovaOCreaPersonaFisica`), upload documenti su volume Docker named con verifica PDF sui byte reali (non solo mimetype dichiarato). Includere eventuali gotcha reali incontrati durante l'esecuzione del piano (da scrivere quando effettivamente trovati, non anticipabili qui).

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md CLAUDE.md
git commit -m "docs: mark accreditamento+delega block done, record CLAUDE.md learnings"
```

---

## Self-Review (fatto in fase di scrittura del piano)

**Copertura spec**: creazione associazione ✅ (Task 2), upload documenti ✅ (Task 3), sub-delega auto-approvata ✅ (Task 4), shell `persone_fisiche` ✅ (Task 4), approvazione/rigetto prima abilitazione ✅ (Task 5), revoca con cascata ✅ (Task 6), volume Docker ✅ (Task 7). PDND/Camera di Commercio: esplicitamente fuori scope, annotato nello spec come evoluzione futura — nessun task qui, va in `docs/SPEC.md` §8 quando si scrive il Task 8 (Step 1, aggiungere anche una riga in "Decisioni aperte" se non già presente).

**Placeholder**: nessun TBD/TODO nei passi di codice; l'unica nota "da preferire se il tempo lo consente" (Task 4, Step 14) è stata risolta esplicitamente con l'alternativa raccomandata scritta per intero (cambiare le firme a `Db`), non lasciata come scelta aperta.

**Coerenza tipi**: `Abilitazione.creataDaAbilitazioneId` (Task 4) usato in modo identico in Task 5/6; `COLONNE_SELECT` di `abilitazioni.ts` definita una sola volta nel Task 4 e riusata (mai ridefinita) nei Task 5/6; `trovaPersonaFisicaPerCf`/`creaPersonaFisicaShell` firmate `Db` fin dal Task 4 (nessun disallineamento con l'uso in transazione del Task 4 stesso).
