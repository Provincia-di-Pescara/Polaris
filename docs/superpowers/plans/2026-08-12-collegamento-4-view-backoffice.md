# Collegamento 4 view backoffice residue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collegare `ControlRoomView`, `ParametriSistemaView`, `DelegheAccreditamentiView`, `AuditSorteggioView` (oggi su `mockData.ts`) alle API reali del backend Node, aggiungendo i 4 gruppi di endpoint GET mancanti (deleghe, documenti, log-operazioni, sorteggi).

**Architecture:** Backend: nuove funzioni repository (sola lettura) + nuove route Express, stesso stile try/catch e mapping errori del resto di `server.ts`. Frontend: nuovi moduli `src/api/*.ts` su `apiFetch`, viste riscritte con `useState`/`useEffect` locale (nessuna libreria di data-fetching), stessa struttura CSS/classi esistente.

**Tech Stack:** Express + `pg` (query parametrizzate, niente ORM) lato backend; React 19 + `react-router` (`useOutletContext` per la stagione selezionata) lato frontend; test backend con `node --test` contro Postgres reale (`testutil/dbDedicato.ts`), test frontend con Vitest + Testing Library (mock del modulo `api/*` via `vi.spyOn`, stesso pattern di `ImpiantoForm.test.tsx`).

## Global Constraints

- Aritmetica: valori NUMERIC letti sempre con `::text` + mai binding numerico diretto (coerente col resto del progetto, mai float per valori di dominio decimal).
- Audit log: `registraOperazione` solo su scritture — nessuna delle route di questo blocco (tutte GET) lo chiama.
- Ogni route di scrittura esistente riusata invariata (`PUT /backoffice/deleghe/:id/*`, `POST /backoffice/stagioni/:id/*`, `POST /backoffice/parametrico`) — questo blocco NON le modifica.
- `file_path` di un documento non va mai esposto in JSON (solo l'id, usato per la route di download).
- Verifica HMAC lato client deve ricalcolare per davvero (`SubtleCrypto`), mai una simulazione a tempo.
- Spec di riferimento: `docs/superpowers/specs/2026-08-12-collegamento-4-view-backoffice-design.md`.

---

## Task 1: Backend — `GET /backoffice/deleghe`

**Files:**
- Modify: `backend-node/src/abilitazioni.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.deleghe.test.ts` (nuovo)

**Interfaces:**
- Consumes: `Db` da `./db.ts` (già importato in `abilitazioni.ts`); `COLONNE_SELECT`/`daRiga` esistenti in `abilitazioni.ts`.
- Produces: `listaAbilitazioni(db: Db, filtri: { stato?: string; stagioneId?: string }): Promise<AbilitazioneConDettagli[]>`. `AbilitazioneConDettagli` estende `Abilitazione` con `personaFisicaNome: string`, `personaFisicaCognome: string`, `personaFisicaCodiceFiscale: string`, `associazioneDenominazione: string | null`, `associazioneCodiceFiscalePartitaIva: string | null`. `schemaQueryListaDeleghe` in `backofficeSchema.ts`.

- [ ] **Step 1: Scrivi il test repository che fallisce**

```ts
// backend-node/src/abilitazioni.test.ts — AGGIUNGI in fondo al file esistente (se non esiste, crealo con lo stesso header degli altri test repository: import test/assert, creaDatabaseDedicato)
test(
  'listaAbilitazioni filtra per stato e include dati persona/associazione',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const persona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
      [`RSSMRA80A01H501U-${randomUUID()}`, randomUUID()],
    );
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione test deleghe ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Test', $1) RETURNING id`,
      [randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: persona.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    const tutte = await listaAbilitazioni(pool, {});
    assert.ok(tutte.some((a) => a.personaFisicaCognome === 'Rossi' && a.associazioneDenominazione === 'ASD Test'));

    const inAttesa = await listaAbilitazioni(pool, { stato: 'in_attesa' });
    assert.ok(inAttesa.every((a) => a.stato === 'in_attesa'));

    const approvate = await listaAbilitazioni(pool, { stato: 'approvata' });
    assert.ok(!approvate.some((a) => a.associazioneDenominazione === 'ASD Test'));
  },
);
```

Se `abilitazioni.test.ts` non esiste ancora, crealo con questo import block in testa:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { creaAbilitazionePrincipale, listaAbilitazioni } from './abilitazioni.ts';
```

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/abilitazioni.test.ts`
Expected: FAIL — `listaAbilitazioni is not a function` (o import error).

- [ ] **Step 3: Implementa `listaAbilitazioni` in `abilitazioni.ts`**

Aggiungi in fondo al file (dopo `revocaAbilitazioneConCascata`):

```ts
export interface AbilitazioneConDettagli extends Abilitazione {
  personaFisicaNome: string;
  personaFisicaCognome: string;
  personaFisicaCodiceFiscale: string;
  associazioneDenominazione: string | null;
  associazioneCodiceFiscalePartitaIva: string | null;
}

interface RigaAbilitazioneConDettagli extends RigaAbilitazione {
  persona_nome: string;
  persona_cognome: string;
  persona_codice_fiscale: string;
  associazione_denominazione: string | null;
  associazione_cf_piva: string | null;
}

function daRigaConDettagli(r: RigaAbilitazioneConDettagli): AbilitazioneConDettagli {
  return {
    ...daRiga(r),
    personaFisicaNome: r.persona_nome,
    personaFisicaCognome: r.persona_cognome,
    personaFisicaCodiceFiscale: r.persona_codice_fiscale,
    associazioneDenominazione: r.associazione_denominazione,
    associazioneCodiceFiscalePartitaIva: r.associazione_cf_piva,
  };
}

export async function listaAbilitazioni(
  db: Db,
  filtri: { stato?: string; stagioneId?: string },
): Promise<AbilitazioneConDettagli[]> {
  const condizioni: string[] = [];
  const parametri: unknown[] = [];
  if (filtri.stato) {
    parametri.push(filtri.stato);
    condizioni.push(`a.stato = $${parametri.length}`);
  }
  if (filtri.stagioneId) {
    parametri.push(filtri.stagioneId);
    condizioni.push(`a.stagione_id = $${parametri.length}`);
  }
  const whereClause = condizioni.length > 0 ? `WHERE ${condizioni.join(' AND ')}` : '';
  const r = await db.query<RigaAbilitazioneConDettagli>(
    `SELECT a.id, a.persona_fisica_id, a.associazione_id, a.istituzione_scolastica_id, a.stagione_id,
            a.titolo, a.ruolo, a.stato, a.motivazione, a.creata_da_abilitazione_id,
            p.nome AS persona_nome, p.cognome AS persona_cognome, p.codice_fiscale AS persona_codice_fiscale,
            ass.denominazione AS associazione_denominazione, ass.codice_fiscale_partita_iva AS associazione_cf_piva
     FROM abilitazioni a
     JOIN persone_fisiche p ON p.id = a.persona_fisica_id
     LEFT JOIN associazioni ass ON ass.id = a.associazione_id
     ${whereClause}
     ORDER BY a.richiesta_il DESC`,
    parametri,
  );
  return r.rows.map(daRigaConDettagli);
}
```

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/abilitazioni.test.ts`
Expected: PASS

- [ ] **Step 5: Aggiungi lo schema query in `backofficeSchema.ts`**

Aggiungi dopo `schemaRespingiDelega` (cercalo con grep, è già importato in `server.ts`):

```ts
export const schemaQueryListaDeleghe = z.object({
  stato: z.enum(['in_attesa', 'approvata', 'respinta', 'revocata']).optional(),
  stagioneId: z.string().uuid().optional(),
});
```

- [ ] **Step 6: Aggiungi la route in `server.ts`**

Modifica l'import da `./abilitazioni.ts` (riga ~74-80) aggiungendo `listaAbilitazioni`:
```ts
import {
  creaAbilitazionePrincipale,
  trovaAbilitazioneAttiva,
  creaSubDelega,
  approvaAbilitazione,
  respingiAbilitazione,
  revocaAbilitazioneConCascata,
  listaAbilitazioni,
} from './abilitazioni.ts';
```

Aggiungi `schemaQueryListaDeleghe` all'elenco di import da `./backofficeSchema.ts` (riga 65, stessa lista lunga già presente).

Inserisci la route subito prima di `app.post('/pubblico/deleghe', ...)` (riga ~1177):

```ts
  app.get('/backoffice/deleghe', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    const parsed = schemaQueryListaDeleghe.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      res.status(200).json(await listaAbilitazioni(pool, parsed.data));
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

```

- [ ] **Step 7: Scrivi il test HTTP end-to-end**

Crea `backend-node/src/server.deleghe.test.ts`, stesso schema di `server.parametrico.test.ts` (import `creaApp`, `creaDatabaseDedicato`, `generaAccessToken`, `hashPassword`, funzioni `avviaServerTest`/`creaUtenteTest` locali copiate identiche):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaAbilitazionePrincipale } from './abilitazioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: import('pg').Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteTest(pool: import('pg').Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `deleghe-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Deleghe', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/deleghe',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const operatore = await creaUtenteTest(pool, 'operatore');

    const persona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Anna', 'Verdi', $2, 'spid') RETURNING id`,
      [`VRDNNA80A01H501U-${randomUUID()}`, randomUUID()],
    );
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione deleghe HTTP ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD HTTP Test', $1) RETURNING id`,
      [randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: persona.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    const r = await fetch(`${base}/backoffice/deleghe`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as Array<{ associazioneDenominazione: string; personaFisicaCognome: string }>;
    assert.ok(body.some((a) => a.associazioneDenominazione === 'ASD HTTP Test' && a.personaFisicaCognome === 'Verdi'));

    const filtrata = await fetch(`${base}/backoffice/deleghe?stato=in_attesa`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(filtrata.status, 200);

    const senzaAuth = await fetch(`${base}/backoffice/deleghe`);
    assert.equal(senzaAuth.status, 401);

    const statoInvalido = await fetch(`${base}/backoffice/deleghe?stato=non_esiste`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(statoInvalido.status, 400);
  },
);
```

- [ ] **Step 8: Esegui il test HTTP, verifica che passi**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/server.deleghe.test.ts`
Expected: PASS

- [ ] **Step 9: Typecheck**

Run: `cd backend-node && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore

- [ ] **Step 10: Commit**

```bash
git add backend-node/src/abilitazioni.ts backend-node/src/abilitazioni.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.ts backend-node/src/server.deleghe.test.ts
git commit -m "feat(backend-node): aggiunge GET /backoffice/deleghe (lista abilitazioni con filtro stato/stagione)"
```

---

## Task 2: Backend — lista e download documenti associazione

**Files:**
- Modify: `backend-node/src/associazioni.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.documenti.test.ts` (nuovo)

**Interfaces:**
- Consumes: `percorsoStorageDocumenti()` da `./documenti/storage.ts` (già esistente); `trovaAssociazionePerId` da `./associazioni.ts`.
- Produces: `listaDocumentiPerAssociazione(db: Db, associazioneId: string): Promise<DocumentoAssociazioneMeta[]>`, `trovaDocumentoPerId(db: Db, id: string): Promise<DocumentoAssociazione | null>`. `DocumentoAssociazioneMeta = { id, associazioneId, tipo, caricatoIl }` (mai `filePath`).

- [ ] **Step 1: Scrivi il test repository che fallisce**

Aggiungi a `backend-node/src/associazioni.test.ts` (se non esiste, crealo con l'header standard `import { test } from 'node:test'; import assert ...; import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';`):

```ts
test(
  'listaDocumentiPerAssociazione e trovaDocumentoPerId',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Documenti Test',
      codiceFiscalePartitaIva: randomUUID(),
    });
    const doc = await creaDocumentoAssociazione(pool, {
      associazioneId: associazione.id,
      tipo: 'statuto',
      filePath: 'file-di-test.pdf',
    });

    const lista = await listaDocumentiPerAssociazione(pool, associazione.id);
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.tipo, 'statuto');
    assert.ok(!('filePath' in lista[0]!));

    const trovato = await trovaDocumentoPerId(pool, doc.id);
    assert.equal(trovato?.filePath, 'file-di-test.pdf');

    const inesistente = await trovaDocumentoPerId(pool, randomUUID());
    assert.equal(inesistente, null);
  },
);
```

Import block se il file è nuovo:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { creaAssociazione, creaDocumentoAssociazione, listaDocumentiPerAssociazione, trovaDocumentoPerId } from './associazioni.ts';
```

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/associazioni.test.ts`
Expected: FAIL — `listaDocumentiPerAssociazione is not a function`

- [ ] **Step 3: Implementa in `associazioni.ts`**

Aggiungi in fondo al file:

```ts
export interface DocumentoAssociazioneMeta {
  id: string;
  associazioneId: string;
  tipo: string;
  caricatoIl: string;
}

export async function listaDocumentiPerAssociazione(db: Db, associazioneId: string): Promise<DocumentoAssociazioneMeta[]> {
  const r = await db.query<{ id: string; associazione_id: string; tipo: string; caricato_il: string }>(
    `SELECT id, associazione_id, tipo, caricato_il FROM associazioni_documenti WHERE associazione_id = $1 ORDER BY caricato_il DESC`,
    [associazioneId],
  );
  return r.rows.map((row) => ({ id: row.id, associazioneId: row.associazione_id, tipo: row.tipo, caricatoIl: row.caricato_il }));
}

export async function trovaDocumentoPerId(db: Db, id: string): Promise<DocumentoAssociazione | null> {
  const r = await db.query<RigaDocumento>(
    `SELECT id, associazione_id, tipo, file_path, caricato_il FROM associazioni_documenti WHERE id = $1`,
    [id],
  );
  return r.rows[0] ? daRigaDocumento(r.rows[0]) : null;
}
```

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/associazioni.test.ts`
Expected: PASS

- [ ] **Step 5: Aggiungi le 2 route in `server.ts`**

Modifica l'import da `./associazioni.ts` (riga 68):
```ts
import {
  creaAssociazione,
  trovaAssociazionePerId,
  creaDocumentoAssociazione,
  listaDocumentiPerAssociazione,
  trovaDocumentoPerId,
} from './associazioni.ts';
```

Aggiungi `percorsoStorageDocumenti` all'import esistente da `./documenti/storage.ts` (riga 70):
```ts
import { uploadDocumento, percorsoStorageDocumenti } from './documenti/storage.ts';
```

Aggiungi `import path from 'node:path';` in cima al file (vicino agli altri import `node:*`).

Inserisci le due route subito dopo la route `POST /pubblico/associazioni/:id/documenti` (dopo la riga ~1175, prima di `app.post('/pubblico/deleghe', ...)`):

```ts
  app.get(
    '/backoffice/associazioni/:associazioneId/documenti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const associazioneId = typeof req.params.associazioneId === 'string' ? req.params.associazioneId : '';
        const associazione = await trovaAssociazionePerId(pool, associazioneId);
        if (!associazione) {
          res.status(404).json({ errore: 'associazione non trovata' });
          return;
        }
        res.status(200).json(await listaDocumentiPerAssociazione(pool, associazioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/documenti/:id/scarica',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const documento = await trovaDocumentoPerId(pool, id);
        if (!documento) {
          res.status(404).json({ errore: 'documento non trovato' });
          return;
        }
        const percorsoAssoluto = path.resolve(percorsoStorageDocumenti(), documento.filePath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        res.sendFile(percorsoAssoluto, (err) => {
          if (err && !res.headersSent) {
            res.status(404).json({ errore: 'file non trovato su disco' });
          }
        });
      } catch (err) {
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

- [ ] **Step 6: Scrivi il test HTTP end-to-end**

Crea `backend-node/src/server.documenti.test.ts` (stesso boilerplate `avviaServerTest`/`creaUtenteTest` del Task 1 — copialo identico, cambia solo `email` prefix a `documenti-test-`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaAssociazione, creaDocumentoAssociazione } from './associazioni.ts';
import { percorsoStorageDocumenti } from './documenti/storage.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: import('pg').Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteTest(pool: import('pg').Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `documenti-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Documenti', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/associazioni/:id/documenti e /backoffice/documenti/:id/scarica',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const operatore = await creaUtenteTest(pool, 'operatore');
    const associazione = await creaAssociazione(pool, { denominazione: 'ASD Scarica Test', codiceFiscalePartitaIva: randomUUID() });

    const nomeFile = `${randomUUID()}.pdf`;
    await mkdir(percorsoStorageDocumenti(), { recursive: true });
    await writeFile(path.join(percorsoStorageDocumenti(), nomeFile), '%PDF-1.4 contenuto di test');
    const documento = await creaDocumentoAssociazione(pool, { associazioneId: associazione.id, tipo: 'statuto', filePath: nomeFile });

    const rLista = await fetch(`${base}/backoffice/associazioni/${associazione.id}/documenti`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rLista.status, 200);
    const lista = (await rLista.json()) as Array<{ id: string; tipo: string }>;
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.id, documento.id);

    const rScarica = await fetch(`${base}/backoffice/documenti/${documento.id}/scarica`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rScarica.status, 200);
    assert.equal(rScarica.headers.get('content-type'), 'application/pdf');
    const corpo = await rScarica.text();
    assert.ok(corpo.startsWith('%PDF-'));

    const rInesistente = await fetch(`${base}/backoffice/documenti/${randomUUID()}/scarica`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rInesistente.status, 404);

    const rAssociazioneInesistente = await fetch(`${base}/backoffice/associazioni/${randomUUID()}/documenti`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rAssociazioneInesistente.status, 404);
  },
);
```

- [ ] **Step 7: Esegui il test HTTP, verifica che passi**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/server.documenti.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `cd backend-node && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore

- [ ] **Step 9: Commit**

```bash
git add backend-node/src/associazioni.ts backend-node/src/associazioni.test.ts backend-node/src/server.ts backend-node/src/server.documenti.test.ts
git commit -m "feat(backend-node): aggiunge lista e download documenti associazione (GET /backoffice/associazioni/:id/documenti, /backoffice/documenti/:id/scarica)"
```

---

## Task 3: Backend — `GET /backoffice/log-operazioni`

**Files:**
- Modify: `backend-node/src/repository/logOperazioni.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.logOperazioni.test.ts` (nuovo)

**Interfaces:**
- Consumes: `Db` da `../db.ts`; `zDataIso` da `../schemaComune.ts` (già esistente, valida `YYYY-MM-DD`).
- Produces: `listaOperazioni(db: Db, filtri: FiltriListaOperazioni): Promise<OperazioneConAttore[]>`. `FiltriListaOperazioni = { entitaTipo?: string; azione?: string; dataDa?: string; dataA?: string; limit: number; offset: number }`. `OperazioneConAttore = { id, attoreNome, attoreTipo: 'backoffice'|'pubblico', ruolo, azione, entitaTipo, entitaId, dettaglio, ipAddress, avvenutaIl }`.

- [ ] **Step 1: Scrivi il test repository che fallisce**

Crea `backend-node/src/repository/logOperazioni.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';
import { registraOperazione, listaOperazioni } from './logOperazioni.ts';

test(
  'listaOperazioni filtra per entitaTipo/azione/data e pagina',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const utente = await pool.query<{ id: string }>(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, 'hash', 'Log', 'Test', 'admin', 'attivo') RETURNING id`,
      [`log-test-${randomUUID()}@test.local`],
    );
    const entitaId = randomUUID();

    await registraOperazione(pool, {
      attore: { tipo: 'backoffice', utenteBackofficeId: utente.rows[0]!.id, ruolo: 'admin' },
      azione: 'azione_di_test_log',
      entitaTipo: 'entita_di_test',
      entitaId,
      dettaglio: { chiave: 'valore' },
    });

    const tutte = await listaOperazioni(pool, { limit: 50, offset: 0 });
    assert.ok(tutte.some((o) => o.entitaId === entitaId && o.attoreNome.includes('Log Test')));

    const filtrate = await listaOperazioni(pool, { entitaTipo: 'entita_di_test', azione: 'azione_di_test_log', limit: 50, offset: 0 });
    assert.ok(filtrate.some((o) => o.entitaId === entitaId));

    const nessunMatch = await listaOperazioni(pool, { azione: 'azione_che_non_esiste_mai', limit: 50, offset: 0 });
    assert.ok(!nessunMatch.some((o) => o.entitaId === entitaId));

    const paginaVuota = await listaOperazioni(pool, { entitaTipo: 'entita_di_test', limit: 1, offset: 1000 });
    assert.equal(paginaVuota.length, 0);
  },
);
```

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/repository/logOperazioni.test.ts`
Expected: FAIL — `listaOperazioni is not a function`

- [ ] **Step 3: Implementa `listaOperazioni` in `repository/logOperazioni.ts`**

Aggiungi in fondo al file:

```ts
export interface OperazioneConAttore {
  id: string;
  attoreNome: string;
  attoreTipo: 'backoffice' | 'pubblico';
  ruolo: string | null;
  azione: string;
  entitaTipo: string;
  entitaId: string | null;
  dettaglio: Record<string, unknown> | null;
  ipAddress: string | null;
  avvenutaIl: string;
}

export interface FiltriListaOperazioni {
  entitaTipo?: string | undefined;
  azione?: string | undefined;
  dataDa?: string | undefined;
  dataA?: string | undefined;
  limit: number;
  offset: number;
}

interface RigaOperazione {
  id: string;
  ruolo: string | null;
  azione: string;
  entita_tipo: string;
  entita_id: string | null;
  dettaglio: Record<string, unknown> | null;
  ip_address: string | null;
  avvenuta_il: Date;
  backoffice_email: string | null;
  backoffice_nome: string | null;
  backoffice_cognome: string | null;
  persona_nome: string | null;
  persona_cognome: string | null;
}

function daRigaOperazione(r: RigaOperazione): OperazioneConAttore {
  const attoreNome = r.backoffice_email
    ? `${r.backoffice_nome} ${r.backoffice_cognome} (${r.backoffice_email})`
    : `${r.persona_nome} ${r.persona_cognome}`;
  return {
    id: r.id,
    attoreNome,
    attoreTipo: r.backoffice_email ? 'backoffice' : 'pubblico',
    ruolo: r.ruolo,
    azione: r.azione,
    entitaTipo: r.entita_tipo,
    entitaId: r.entita_id,
    dettaglio: r.dettaglio,
    ipAddress: r.ip_address,
    avvenutaIl: r.avvenuta_il.toISOString(),
  };
}

export async function listaOperazioni(db: Db, filtri: FiltriListaOperazioni): Promise<OperazioneConAttore[]> {
  const condizioni: string[] = [];
  const parametri: unknown[] = [];
  if (filtri.entitaTipo) {
    parametri.push(filtri.entitaTipo);
    condizioni.push(`lo.entita_tipo = $${parametri.length}`);
  }
  if (filtri.azione) {
    parametri.push(filtri.azione);
    condizioni.push(`lo.azione = $${parametri.length}`);
  }
  if (filtri.dataDa) {
    parametri.push(filtri.dataDa);
    condizioni.push(`lo.avvenuta_il::date >= $${parametri.length}::date`);
  }
  if (filtri.dataA) {
    parametri.push(filtri.dataA);
    condizioni.push(`lo.avvenuta_il::date <= $${parametri.length}::date`);
  }
  const whereClause = condizioni.length > 0 ? `WHERE ${condizioni.join(' AND ')}` : '';
  parametri.push(filtri.limit);
  const limitPlaceholder = `$${parametri.length}`;
  parametri.push(filtri.offset);
  const offsetPlaceholder = `$${parametri.length}`;
  const r = await db.query<RigaOperazione>(
    `SELECT lo.id, lo.ruolo, lo.azione, lo.entita_tipo, lo.entita_id, lo.dettaglio, lo.ip_address::text AS ip_address, lo.avvenuta_il,
            ub.email AS backoffice_email, ub.nome AS backoffice_nome, ub.cognome AS backoffice_cognome,
            pf.nome AS persona_nome, pf.cognome AS persona_cognome
     FROM log_operazioni lo
     LEFT JOIN utenti_backoffice ub ON ub.id = lo.utente_backoffice_id
     LEFT JOIN persone_fisiche pf ON pf.id = lo.persona_fisica_id
     ${whereClause}
     ORDER BY lo.avvenuta_il DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    parametri,
  );
  return r.rows.map(daRigaOperazione);
}
```

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/repository/logOperazioni.test.ts`
Expected: PASS

- [ ] **Step 5: Aggiungi lo schema query in `backofficeSchema.ts`**

Aggiungi `import { zDataIso } from './schemaComune.ts';` se non già presente (è già importato, riga 2). Aggiungi lo schema:

```ts
export const schemaQueryListaLogOperazioni = z.object({
  entitaTipo: z.string().min(1).optional(),
  azione: z.string().min(1).optional(),
  dataDa: zDataIso.optional(),
  dataA: zDataIso.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
```

- [ ] **Step 6: Aggiungi la route in `server.ts`**

Modifica l'import esistente `import { registraOperazione } from './repository/logOperazioni.ts';` (riga 38) in:
```ts
import { registraOperazione, listaOperazioni } from './repository/logOperazioni.ts';
```

Aggiungi `schemaQueryListaLogOperazioni` all'elenco import da `./backofficeSchema.ts` (riga 65).

Inserisci la route dopo la route `GET /backoffice/stagioni/:id/elaborazioni` (dopo la riga ~2056, prima del commento `// --- Approvazione settimana tipo definitiva`):

```ts
  app.get('/backoffice/log-operazioni', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    const parsed = schemaQueryListaLogOperazioni.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      const righe = await listaOperazioni(pool, {
        entitaTipo: parsed.data.entitaTipo,
        azione: parsed.data.azione,
        dataDa: parsed.data.dataDa,
        dataA: parsed.data.dataA,
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      });
      res.status(200).json(righe);
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

```

- [ ] **Step 7: Scrivi il test HTTP end-to-end**

Crea `backend-node/src/server.logOperazioni.test.ts` (stesso boilerplate `avviaServerTest`/`creaUtenteTest` del Task 1, prefix email `logop-test-`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { registraOperazione } from './repository/logOperazioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: import('pg').Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteTest(pool: import('pg').Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `logop-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'LogOp', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/log-operazioni',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteTest(pool, 'admin');
    const entitaId = randomUUID();
    await registraOperazione(pool, {
      attore: { tipo: 'backoffice', utenteBackofficeId: admin.id, ruolo: 'admin' },
      azione: 'azione_http_test',
      entitaTipo: 'entita_http_test',
      entitaId,
    });

    const r = await fetch(`${base}/backoffice/log-operazioni?entitaTipo=entita_http_test`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as Array<{ entitaId: string; attoreNome: string }>;
    assert.ok(body.some((o) => o.entitaId === entitaId));

    const conLimite = await fetch(`${base}/backoffice/log-operazioni?limit=1`, { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(conLimite.status, 200);
    assert.equal(((await conLimite.json()) as unknown[]).length, 1);

    const dataInvalida = await fetch(`${base}/backoffice/log-operazioni?dataDa=non-una-data`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(dataInvalida.status, 400);

    const senzaAuth = await fetch(`${base}/backoffice/log-operazioni`);
    assert.equal(senzaAuth.status, 401);
  },
);
```

- [ ] **Step 8: Esegui il test HTTP, verifica che passi**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/server.logOperazioni.test.ts`
Expected: PASS

- [ ] **Step 9: Typecheck**

Run: `cd backend-node && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore

- [ ] **Step 10: Commit**

```bash
git add backend-node/src/repository/logOperazioni.ts backend-node/src/repository/logOperazioni.test.ts backend-node/src/backofficeSchema.ts backend-node/src/server.ts backend-node/src/server.logOperazioni.test.ts
git commit -m "feat(backend-node): aggiunge GET /backoffice/log-operazioni (filtri entita/azione/data, paginazione)"
```

---

## Task 4: Backend — verbali sorteggio (lista per stagione + dettaglio)

**Files:**
- Create: `backend-node/src/sorteggi.ts`
- Create: `backend-node/src/sorteggi.test.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.sorteggi.test.ts` (nuovo)

**Interfaces:**
- Consumes: `Db` da `./db.ts`.
- Produces: `listaSorteggiPerStagione(db: Db, stagioneId: string): Promise<SorteggioSintetico[]>`, `trovaSorteggioConCandidati(db: Db, id: string): Promise<SorteggioDettaglio | null>`. `SorteggioDettaglio` estende `SorteggioSintetico` con `algoritmo`, `algoritmoVersione`, `hashVerbale`, `candidati: CandidatoSorteggio[]` (ordinati per `rank`).

- [ ] **Step 1: Scrivi il test repository che fallisce**

Crea `backend-node/src/sorteggi.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { listaSorteggiPerStagione, trovaSorteggioConCandidati } from './sorteggi.ts';

test(
  'listaSorteggiPerStagione e trovaSorteggioConCandidati',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione sorteggi test ${randomUUID()}`],
    );
    const elaborazione = await pool.query<{ id: string }>(
      `INSERT INTO elaborazioni (stagione_id, tipo, stato) VALUES ($1, 'prima_assegnazione', 'completata') RETURNING id`,
      [stagione.rows[0]!.id],
    );
    const ass1 = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Sorteggio Uno', $1) RETURNING id`,
      [randomUUID()],
    );
    const ass2 = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Sorteggio Due', $1) RETURNING id`,
      [randomUUID()],
    );
    const sorteggio = await pool.query<{ id: string }>(
      `INSERT INTO sorteggi (elaborazione_id, articolo_riferimento, contesto, seme_hex, vincitore_associazione_id, hash_verbale)
       VALUES ($1, 'B.21', 'contesto di test', 'ab12', $2, 'hashdiverbale')
       RETURNING id`,
      [elaborazione.rows[0]!.id, ass1.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO sorteggio_candidati (sorteggio_id, associazione_id, ordine_canonico, hmac_hex, rank) VALUES
       ($1, $2, 1, 'hmac-vincitore', 1),
       ($1, $3, 2, 'hmac-secondo', 2)`,
      [sorteggio.rows[0]!.id, ass1.rows[0]!.id, ass2.rows[0]!.id],
    );

    const lista = await listaSorteggiPerStagione(pool, stagione.rows[0]!.id);
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.id, sorteggio.rows[0]!.id);
    assert.equal(lista[0]!.vincitoreAssociazioneId, ass1.rows[0]!.id);

    const dettaglio = await trovaSorteggioConCandidati(pool, sorteggio.rows[0]!.id);
    assert.equal(dettaglio?.candidati.length, 2);
    assert.equal(dettaglio?.candidati[0]!.rank, 1);
    assert.equal(dettaglio?.hashVerbale, 'hashdiverbale');

    const inesistente = await trovaSorteggioConCandidati(pool, randomUUID());
    assert.equal(inesistente, null);
  },
);
```

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/sorteggi.test.ts`
Expected: FAIL — `Cannot find module './sorteggi.ts'`

- [ ] **Step 3: Crea `sorteggi.ts`**

```ts
import type { Db } from './db.ts';

export interface SorteggioSintetico {
  id: string;
  elaborazioneId: string | null;
  articoloRiferimento: string;
  contesto: string;
  semeHex: string;
  semeGeneratoIl: string;
  vincitoreAssociazioneId: string;
}

export interface CandidatoSorteggio {
  associazioneId: string;
  ordineCanonico: number;
  hmacHex: string;
  rank: number;
}

export interface SorteggioDettaglio extends SorteggioSintetico {
  algoritmo: string;
  algoritmoVersione: string;
  hashVerbale: string;
  candidati: CandidatoSorteggio[];
}

interface RigaSorteggioSintetico {
  id: string;
  elaborazione_id: string | null;
  articolo_riferimento: string;
  contesto: string;
  seme_hex: string;
  seme_generato_il: Date;
  vincitore_associazione_id: string;
}

interface RigaSorteggioCompleto extends RigaSorteggioSintetico {
  algoritmo: string;
  algoritmo_versione: string;
  hash_verbale: string;
}

interface RigaCandidato {
  associazione_id: string;
  ordine_canonico: number;
  hmac_hex: string;
  rank: number;
}

const COLONNE_SINTETICO = `id, elaborazione_id, articolo_riferimento, contesto, seme_hex, seme_generato_il, vincitore_associazione_id`;

function daRigaSintetica(r: RigaSorteggioSintetico): SorteggioSintetico {
  return {
    id: r.id,
    elaborazioneId: r.elaborazione_id,
    articoloRiferimento: r.articolo_riferimento,
    contesto: r.contesto,
    semeHex: r.seme_hex,
    semeGeneratoIl: r.seme_generato_il.toISOString(),
    vincitoreAssociazioneId: r.vincitore_associazione_id,
  };
}

export async function listaSorteggiPerStagione(db: Db, stagioneId: string): Promise<SorteggioSintetico[]> {
  const r = await db.query<RigaSorteggioSintetico>(
    `SELECT s.${COLONNE_SINTETICO.split(', ').join(', s.')}
     FROM sorteggi s
     JOIN elaborazioni e ON e.id = s.elaborazione_id
     WHERE e.stagione_id = $1
     ORDER BY s.seme_generato_il DESC`,
    [stagioneId],
  );
  return r.rows.map(daRigaSintetica);
}

export async function trovaSorteggioConCandidati(db: Db, id: string): Promise<SorteggioDettaglio | null> {
  const r = await db.query<RigaSorteggioCompleto>(
    `SELECT ${COLONNE_SINTETICO}, algoritmo, algoritmo_versione, hash_verbale FROM sorteggi WHERE id = $1`,
    [id],
  );
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  const c = await db.query<RigaCandidato>(
    `SELECT associazione_id, ordine_canonico, hmac_hex, rank FROM sorteggio_candidati WHERE sorteggio_id = $1 ORDER BY rank`,
    [id],
  );
  return {
    ...daRigaSintetica(riga),
    algoritmo: riga.algoritmo,
    algoritmoVersione: riga.algoritmo_versione,
    hashVerbale: riga.hash_verbale,
    candidati: c.rows.map((cr) => ({
      associazioneId: cr.associazione_id,
      ordineCanonico: cr.ordine_canonico,
      hmacHex: cr.hmac_hex,
      rank: cr.rank,
    })),
  };
}
```

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/sorteggi.test.ts`
Expected: PASS

- [ ] **Step 5: Aggiungi le 2 route in `server.ts`**

Aggiungi l'import in cima al file, vicino agli altri import di dominio (dopo `import { creaVariazione, ... } from './variazioni.ts';`, riga 108):
```ts
import { listaSorteggiPerStagione, trovaSorteggioConCandidati } from './sorteggi.ts';
```

Inserisci le route subito dopo la route `GET /backoffice/log-operazioni` aggiunta nel Task 3 (o, se il Task 3 non è ancora applicato in questo worktree, dopo `GET /backoffice/stagioni/:id/elaborazioni`):

```ts
  app.get(
    '/backoffice/stagioni/:id/sorteggi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        validaStagioneIdUuid(stagioneId);
        await verificaStagioneEsiste(pool, stagioneId);
        res.status(200).json(await listaSorteggiPerStagione(pool, stagioneId));
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

  app.get(
    '/backoffice/sorteggi/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const sorteggio = await trovaSorteggioConCandidati(pool, id);
        if (!sorteggio) {
          res.status(404).json({ errore: 'sorteggio non trovato' });
          return;
        }
        res.status(200).json(sorteggio);
      } catch (err) {
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

`validaStagioneIdUuid`/`verificaStagioneEsiste` sono funzioni interne già definite più in alto nello stesso `creaApp` (righe ~1747/1771) — riusale, non ridefinirle.

- [ ] **Step 6: Scrivi il test HTTP end-to-end**

Crea `backend-node/src/server.sorteggi.test.ts` (stesso boilerplate del Task 1, prefix email `sorteggi-test-`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: import('pg').Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteTest(pool: import('pg').Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `sorteggi-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Sorteggi', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/stagioni/:id/sorteggi e /backoffice/sorteggi/:id',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const operatore = await creaUtenteTest(pool, 'operatore');

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione sorteggi HTTP ${randomUUID()}`],
    );
    const elaborazione = await pool.query<{ id: string }>(
      `INSERT INTO elaborazioni (stagione_id, tipo, stato) VALUES ($1, 'prima_assegnazione', 'completata') RETURNING id`,
      [stagione.rows[0]!.id],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Sorteggio HTTP', $1) RETURNING id`,
      [randomUUID()],
    );
    const sorteggio = await pool.query<{ id: string }>(
      `INSERT INTO sorteggi (elaborazione_id, articolo_riferimento, contesto, seme_hex, vincitore_associazione_id, hash_verbale)
       VALUES ($1, 'B.21', 'contesto HTTP', 'cd34', $2, 'hashverbalehttp') RETURNING id`,
      [elaborazione.rows[0]!.id, associazione.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO sorteggio_candidati (sorteggio_id, associazione_id, ordine_canonico, hmac_hex, rank) VALUES ($1, $2, 1, 'hmac-http', 1)`,
      [sorteggio.rows[0]!.id, associazione.rows[0]!.id],
    );

    const rLista = await fetch(`${base}/backoffice/stagioni/${stagione.rows[0]!.id}/sorteggi`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rLista.status, 200);
    const lista = (await rLista.json()) as Array<{ id: string }>;
    assert.equal(lista.length, 1);

    const rDettaglio = await fetch(`${base}/backoffice/sorteggi/${sorteggio.rows[0]!.id}`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rDettaglio.status, 200);
    const dettaglio = (await rDettaglio.json()) as { candidati: unknown[]; hashVerbale: string };
    assert.equal(dettaglio.candidati.length, 1);
    assert.equal(dettaglio.hashVerbale, 'hashverbalehttp');

    const rDettaglioInesistente = await fetch(`${base}/backoffice/sorteggi/${randomUUID()}`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rDettaglioInesistente.status, 404);

    const rStagioneInesistente = await fetch(`${base}/backoffice/stagioni/${randomUUID()}/sorteggi`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rStagioneInesistente.status, 404);
  },
);
```

- [ ] **Step 7: Esegui il test HTTP, verifica che passi**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test src/server.sorteggi.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `cd backend-node && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore

- [ ] **Step 9: Commit**

```bash
git add backend-node/src/sorteggi.ts backend-node/src/sorteggi.test.ts backend-node/src/server.ts backend-node/src/server.sorteggi.test.ts
git commit -m "feat(backend-node): aggiunge lista/dettaglio verbali sorteggio (GET /backoffice/stagioni/:id/sorteggi, /backoffice/sorteggi/:id)"
```

---

## Task 5: Frontend — `DelegheAccreditamentiView` collegata alle API reali

**Files:**
- Create: `frontend-backoffice/src/api/deleghe.ts`
- Modify: `frontend-backoffice/src/components/DelegheAccreditamentiView.tsx`
- Test: `frontend-backoffice/src/components/DelegheAccreditamentiView.test.tsx` (nuovo)

**Interfaces:**
- Consumes: `apiFetch` da `../api/client.ts`, `richiedi`/`ErroreRichiestaApi` pattern come in `api/impiantiSpazi.ts` (nuovo modulo, non riusa quello import — stesso pattern replicato, coerente con "un modulo per gruppo di endpoint" già stabilito).
- Produces: `AbilitazioneConDettagli` (stesso shape del backend, camelCase), `listaDeleghe(filtri)`, `approvaDelega(id)`, `respingiDelega(id, motivazione)`, `revocaDelega(id)`, `listaDocumenti(associazioneId)`, `urlScaricaDocumento(id)`.

- [ ] **Step 1: Crea `frontend-backoffice/src/api/deleghe.ts`**

```ts
import { apiFetch, baseUrl } from './client.ts';

export interface AbilitazioneConDettagli {
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
  personaFisicaNome: string;
  personaFisicaCognome: string;
  personaFisicaCodiceFiscale: string;
  associazioneDenominazione: string | null;
  associazioneCodiceFiscalePartitaIva: string | null;
}

export interface DocumentoAssociazioneMeta {
  id: string;
  associazioneId: string;
  tipo: string;
  caricatoIl: string;
}

export class ErroreRichiestaApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function richiedi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
  return (await r.json()) as T;
}

function corpoJsonPut(dati: unknown): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dati) };
}

export function listaDeleghe(filtri: { stato?: string } = {}): Promise<AbilitazioneConDettagli[]> {
  const query = filtri.stato ? `?stato=${encodeURIComponent(filtri.stato)}` : '';
  return richiedi(`/backoffice/deleghe${query}`);
}

export function approvaDelega(id: string): Promise<AbilitazioneConDettagli> {
  return richiedi(`/backoffice/deleghe/${encodeURIComponent(id)}/approva`, corpoJsonPut({}));
}

export function respingiDelega(id: string, motivazione: string): Promise<AbilitazioneConDettagli> {
  return richiedi(`/backoffice/deleghe/${encodeURIComponent(id)}/respingi`, corpoJsonPut({ motivazione }));
}

export function revocaDelega(id: string): Promise<AbilitazioneConDettagli[]> {
  return richiedi(`/backoffice/deleghe/${encodeURIComponent(id)}/revoca`, corpoJsonPut({}));
}

export function listaDocumenti(associazioneId: string): Promise<DocumentoAssociazioneMeta[]> {
  return richiedi(`/backoffice/associazioni/${encodeURIComponent(associazioneId)}/documenti`);
}

// Non passa da apiFetch: consumato da un <iframe src=...>, non da fetch — il browser
// non allegherebbe comunque l'header Authorization a una navigazione iframe. Il token
// va come query param, letto server-side allo stesso modo dell'header (vedi Task 5
// Step 5 sotto per la nota sul middleware di auth). baseUrl() è la stessa funzione già
// usata da client.ts per risolvere l'origin nei test.
export function urlScaricaDocumento(id: string): string {
  return `${baseUrl()}/backoffice/documenti/${encodeURIComponent(id)}/scarica`;
}
```

**Nota per lo Step successivo**: `richiedeAutenticazione` (backend) legge il token SOLO dall'header `Authorization` — un `<iframe>` non lo invia. Serve quindi scaricare il PDF via `fetch` autenticato e trasformarlo in un `Blob URL` lato client, non un URL diretto in `src`. Correggi quanto sopra: rimuovi `urlScaricaDocumento` e sostituiscilo con una funzione che scarica il blob:

```ts
export async function scaricaDocumentoBlob(id: string): Promise<string> {
  const r = await apiFetch(`/backoffice/documenti/${encodeURIComponent(id)}/scarica`);
  if (!r.ok) {
    throw new ErroreRichiestaApi(r.status, 'impossibile scaricare il documento');
  }
  const blob = await r.blob();
  return URL.createObjectURL(blob);
}
```

(Rimuovi anche l'import di `baseUrl` se non più usato altrove nel file.)

- [ ] **Step 2: Scrivi il test del componente che fallisce**

Crea `frontend-backoffice/src/components/DelegheAccreditamentiView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api/deleghe.ts';
import { DelegheAccreditamentiView } from './DelegheAccreditamentiView.tsx';

const DELEGA_IN_ATTESA: api.AbilitazioneConDettagli = {
  id: 'del-1',
  personaFisicaId: 'pf-1',
  associazioneId: 'ass-1',
  istituzioneScolasticaId: null,
  stagioneId: 'stag-1',
  titolo: 'legale_rappresentante',
  ruolo: 'rappresentante',
  stato: 'in_attesa',
  motivazione: null,
  creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario',
  personaFisicaCognome: 'Rossi',
  personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test',
  associazioneCodiceFiscalePartitaIva: '01234567890',
};

describe('DelegheAccreditamentiView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listaDeleghe').mockResolvedValue([DELEGA_IN_ATTESA]);
    vi.spyOn(api, 'listaDocumenti').mockResolvedValue([]);
  });

  it('mostra le deleghe caricate dal backend', async () => {
    render(<DelegheAccreditamentiView />);
    expect(await screen.findByText('Rossi Mario')).toBeInTheDocument();
    expect(screen.getByText('ASD Test')).toBeInTheDocument();
  });

  it('approva chiama approvaDelega e ricarica la lista', async () => {
    const approvaSpy = vi.spyOn(api, 'approvaDelega').mockResolvedValue({ ...DELEGA_IN_ATTESA, stato: 'approvata' });
    render(<DelegheAccreditamentiView />);
    await screen.findByText('Rossi Mario');

    await userEvent.click(screen.getByRole('button', { name: /valuta delega/i }));
    await userEvent.click(screen.getByRole('button', { name: /approva delega/i }));

    expect(approvaSpy).toHaveBeenCalledWith('del-1');
  });

  it('respingi richiede una motivazione e chiama respingiDelega', async () => {
    const respingiSpy = vi.spyOn(api, 'respingiDelega').mockResolvedValue({ ...DELEGA_IN_ATTESA, stato: 'respinta' });
    render(<DelegheAccreditamentiView />);
    await screen.findByText('Rossi Mario');

    await userEvent.click(screen.getByRole('button', { name: /valuta delega/i }));
    await userEvent.type(screen.getByLabelText(/motivazione/i), 'documentazione incompleta');
    await userEvent.click(screen.getByRole('button', { name: /respingi delega/i }));

    expect(respingiSpy).toHaveBeenCalledWith('del-1', 'documentazione incompleta');
  });
});
```

- [ ] **Step 3: Esegui il test, verifica che fallisca**

Run: `cd frontend-backoffice && npx vitest run src/components/DelegheAccreditamentiView.test.tsx`
Expected: FAIL — `screen.findByText('Rossi Mario')` non trova nulla (la vista è ancora su `mockData.ts`)

- [ ] **Step 4: Riscrivi `DelegheAccreditamentiView.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import {
  listaDeleghe,
  approvaDelega,
  respingiDelega,
  revocaDelega,
  listaDocumenti,
  scaricaDocumentoBlob,
  type AbilitazioneConDettagli,
  type DocumentoAssociazioneMeta,
  ErroreRichiestaApi,
} from '../api/deleghe.ts';
import { FileCheck2, Check, X, Eye, FileText, User, Building } from 'lucide-react';

export const DelegheAccreditamentiView: React.FC = () => {
  const [deleghe, setDeleghe] = useState<AbilitazioneConDettagli[]>([]);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [selezionata, setSelezionata] = useState<AbilitazioneConDettagli | null>(null);
  const [documenti, setDocumenti] = useState<DocumentoAssociazioneMeta[]>([]);
  const [urlDocumentoAttivo, setUrlDocumentoAttivo] = useState<string | null>(null);
  const [motivazione, setMotivazione] = useState('');
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [filtro, setFiltro] = useState<'tutte' | 'in_attesa' | 'approvata'>('tutte');

  const ricarica = (): void => {
    listaDeleghe(filtro === 'tutte' ? {} : { stato: filtro })
      .then(setDeleghe)
      .catch(() => setErroreCaricamento('Impossibile caricare le deleghe.'));
  };

  useEffect(ricarica, [filtro]);

  const apriValutazione = (d: AbilitazioneConDettagli): void => {
    setSelezionata(d);
    setMotivazione('');
    setErroreAzione(null);
    setDocumenti([]);
    setUrlDocumentoAttivo(null);
    if (d.associazioneId) {
      listaDocumenti(d.associazioneId).then(setDocumenti).catch(() => setDocumenti([]));
    }
  };

  const apriDocumento = async (id: string): Promise<void> => {
    try {
      const url = await scaricaDocumentoBlob(id);
      setUrlDocumentoAttivo(url);
    } catch {
      setErroreAzione('Impossibile scaricare il documento.');
    }
  };

  const handleApprova = async (): Promise<void> => {
    if (!selezionata) return;
    setInCorso(true);
    setErroreAzione(null);
    try {
      await approvaDelega(selezionata.id);
      setSelezionata(null);
      ricarica();
    } catch (err) {
      setErroreAzione(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  const handleRespingi = async (): Promise<void> => {
    if (!selezionata) return;
    setInCorso(true);
    setErroreAzione(null);
    try {
      await respingiDelega(selezionata.id, motivazione);
      setSelezionata(null);
      ricarica();
    } catch (err) {
      setErroreAzione(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  const handleRevoca = async (id: string): Promise<void> => {
    setInCorso(true);
    setErroreAzione(null);
    try {
      await revocaDelega(id);
      setSelezionata(null);
      ricarica();
    } catch (err) {
      setErroreAzione(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Gestione Deleghe & Accreditamenti (Art. 3 Doc. Principale)</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Verifica operatore delle associazioni delle persone fisiche (autenticate via SPID/CIE) alle ASD/SSD titolari
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setFiltro('tutte')} className={`btn btn-sm ${filtro === 'tutte' ? 'btn-primary' : 'btn-secondary'}`}>
            Tutte
          </button>
          <button onClick={() => setFiltro('in_attesa')} className={`btn btn-sm ${filtro === 'in_attesa' ? 'btn-primary' : 'btn-secondary'}`}>
            In Attesa
          </button>
          <button onClick={() => setFiltro('approvata')} className={`btn btn-sm ${filtro === 'approvata' ? 'btn-primary' : 'btn-secondary'}`}>
            Approvate
          </button>
        </div>
      </div>

      {erroreCaricamento && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {erroreCaricamento}
        </div>
      )}

      <div className="pa-card">
        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Persona Fisica</th>
                <th>Associazione</th>
                <th>Ruolo</th>
                <th>Stato</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              {deleghe.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <User size={16} color="var(--pa-blue-primary)" />
                      <div>
                        <div style={{ fontWeight: 700 }}>{d.personaFisicaCognome} {d.personaFisicaNome}</div>
                        <div style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>CF: {d.personaFisicaCodiceFiscale}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Building size={16} color="var(--pa-text-muted)" />
                      <div style={{ fontWeight: 700 }}>{d.associazioneDenominazione ?? '—'}</div>
                    </div>
                  </td>
                  <td><span className="badge badge-info">{d.ruolo}</span></td>
                  <td>
                    {d.stato === 'approvata' && <span className="badge badge-success">Approvata</span>}
                    {d.stato === 'in_attesa' && <span className="badge badge-warning">In Attesa</span>}
                    {d.stato === 'respinta' && <span className="badge badge-danger">Respinta</span>}
                    {d.stato === 'revocata' && <span className="badge badge-neutral">Revocata</span>}
                  </td>
                  <td>
                    <button onClick={() => apriValutazione(d)} className="btn btn-primary btn-sm">
                      Valuta Delega
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selezionata && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Valutazione Delega</h3>
              <button onClick={() => setSelezionata(null)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700 }}>{selezionata.personaFisicaCognome} {selezionata.personaFisicaNome}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>{selezionata.associazioneDenominazione}</div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Documenti caricati</div>
              {documenti.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>Nessun documento.</div>}
              {documenti.map((doc) => (
                <button key={doc.id} onClick={() => apriDocumento(doc.id)} className="btn btn-secondary btn-sm" style={{ marginRight: '0.5rem' }}>
                  <Eye size={14} />
                  <span>{doc.tipo}</span>
                </button>
              ))}
              {urlDocumentoAttivo && (
                <iframe src={urlDocumentoAttivo} title="Documento associazione" style={{ width: '100%', height: '360px', marginTop: '0.75rem', border: '1px solid var(--pa-border)' }} />
              )}
            </div>

            <div className="form-group">
              <label htmlFor="delega-motivazione" className="form-label">Motivazione (per rigetto):</label>
              <textarea
                id="delega-motivazione"
                value={motivazione}
                onChange={(e) => setMotivazione(e.target.value)}
                className="form-control"
                style={{ height: '80px' }}
              />
            </div>

            {erroreAzione && (
              <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginTop: '0.5rem' }}>
                {erroreAzione}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => handleRevoca(selezionata.id)} className="btn btn-secondary" disabled={inCorso}>
                Revoca
              </button>
              <button onClick={handleRespingi} className="btn btn-danger" disabled={inCorso}>
                <X size={16} />
                <span>Respingi Delega</span>
              </button>
              <button onClick={handleApprova} className="btn btn-success" disabled={inCorso}>
                <Check size={16} />
                <span>Approva Delega</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 5: Esegui il test, verifica che passi**

Run: `cd frontend-backoffice && npx vitest run src/components/DelegheAccreditamentiView.test.tsx`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `cd frontend-backoffice && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore. Se `FileCheck2`/`FileText` risultano import inutilizzati dopo la riscrittura, rimuovili.

- [ ] **Step 7: Commit**

```bash
git add frontend-backoffice/src/api/deleghe.ts frontend-backoffice/src/components/DelegheAccreditamentiView.tsx frontend-backoffice/src/components/DelegheAccreditamentiView.test.tsx
git commit -m "feat(frontend-backoffice): collega DelegheAccreditamentiView alle API reali (lista/approva/respingi/revoca + documenti)"
```

---

## Task 6: Frontend — `ParametriSistemaView` collegata alle API reali

**Files:**
- Create: `frontend-backoffice/src/api/parametrico.ts`
- Create: `frontend-backoffice/src/components/impianti/VersioneParametricaForm.tsx` (riusa la cartella `impianti/` per coerenza con gli altri form dedicati, anche se semanticamente non è "impianti" — alternativa: nuova cartella `parametrico/`; usa `parametrico/VersioneParametricaForm.tsx` se preferisci separare, aggiornando il path negli step sotto)
- Modify: `frontend-backoffice/src/components/ParametriSistemaView.tsx`
- Test: `frontend-backoffice/src/components/ParametriSistemaView.test.tsx` (nuovo)
- Test: `frontend-backoffice/src/components/parametrico/VersioneParametricaForm.test.tsx` (nuovo)

**Interfaces:**
- Consumes: `apiFetch` da `../api/client.ts`.
- Produces: `VersioneParametrica`, `VersioneParametricaSintetica`, `ScaglioneCsd`, `DatiCreaVersione` (stesso shape camelCase del backend — vedi `backend-node/src/repository/parametrico.ts`), `leggiVersioneAttiva()`, `listaVersioni()`, `leggiVersionePerId(id)`, `creaVersione(dati)`.

- [ ] **Step 1: Crea `frontend-backoffice/src/api/parametrico.ts`**

```ts
import { apiFetch } from './client.ts';

export interface ScaglioneCsd {
  rapportoFdFrMin: string;
  rapportoFdFrMax: string | null;
  coefficiente: string;
}

export interface VersioneParametrica {
  id: string;
  validaDal: string;
  pubblicataDa: string | null;
  note: string | null;
  moltiplicatoreMinutiPerPunto: string;
  pesoFasciaPregiata: string;
  minutiSettimanaliMax: string;
  slotMaxStessoImpianto: number;
  fascePregiateMax: number;
  giornateGaraMax: number;
  incrementoSquadreNeutro: number;
  caaNeutro: string;
  csdNeutro: string;
  tolleranzaIsfPct: string;
  sogliaMancatiUtilizziDiffida: number;
  sogliaMancatiUtilizziDecadenza: number;
  sogliaScostamentoDichiaratoPct: string;
  sogliaIsfCompensazione: string;
  retentionLogOperazioniGiorni: number;
  quotaNuoveAssociazioniPct: string;
  termineGiustificazioneGiorni: number;
  creataIl: string;
  csdScaglioni: ScaglioneCsd[];
}

export interface VersioneParametricaSintetica {
  id: string;
  validaDal: string;
  pubblicataDa: string | null;
  note: string | null;
}

// Definito esplicitamente (non via Omit<VersioneParametrica, ...>): VersioneParametrica.note
// è `string | null` (valore già salvato, può essere assente), ma lo zod schema backend
// (schemaCreaVersioneParametrico) ha `note` come `.optional()` — accetta undefined, MAI
// null esplicito. Un Omit erediterebbe `string | null` e produrrebbe un payload che il
// backend rifiuta con 400 se il form invia `note: null`.
export interface DatiCreaVersione {
  note?: string | undefined;
  moltiplicatoreMinutiPerPunto: string;
  pesoFasciaPregiata: string;
  minutiSettimanaliMax: string;
  slotMaxStessoImpianto: number;
  fascePregiateMax: number;
  giornateGaraMax: number;
  incrementoSquadreNeutro: number;
  caaNeutro: string;
  csdNeutro: string;
  tolleranzaIsfPct: string;
  sogliaMancatiUtilizziDiffida: number;
  sogliaMancatiUtilizziDecadenza: number;
  sogliaScostamentoDichiaratoPct: string;
  sogliaIsfCompensazione: string;
  retentionLogOperazioniGiorni: number;
  quotaNuoveAssociazioniPct: string;
  termineGiustificazioneGiorni: number;
  csdScaglioni: Array<{ rapportoFdFrMin: string; rapportoFdFrMax: string | null; coefficiente: string }>;
}

export class ErroreRichiestaApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function richiedi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
  return (await r.json()) as T;
}

export function leggiVersioneAttiva(): Promise<VersioneParametrica> {
  return richiedi('/backoffice/parametrico');
}

export function listaVersioni(): Promise<VersioneParametricaSintetica[]> {
  return richiedi('/backoffice/parametrico/versioni');
}

export function leggiVersionePerId(id: string): Promise<VersioneParametrica> {
  return richiedi(`/backoffice/parametrico/versioni/${encodeURIComponent(id)}`);
}

export function creaVersione(dati: DatiCreaVersione): Promise<VersioneParametrica> {
  return richiedi('/backoffice/parametrico', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}
```

- [ ] **Step 2: Scrivi il test del form `VersioneParametricaForm` che fallisce**

Crea la cartella `frontend-backoffice/src/components/parametrico/` e il file `VersioneParametricaForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../../api/parametrico.ts';
import { VersioneParametricaForm } from './VersioneParametricaForm.tsx';

const VERSIONE_ATTIVA: api.VersioneParametrica = {
  id: 'v-1',
  validaDal: '2026-01-01T00:00:00.000Z',
  pubblicataDa: null,
  note: null,
  moltiplicatoreMinutiPerPunto: '60.000',
  pesoFasciaPregiata: '1.250',
  minutiSettimanaliMax: '600.000',
  slotMaxStessoImpianto: 4,
  fascePregiateMax: 2,
  giornateGaraMax: 1,
  incrementoSquadreNeutro: 0,
  caaNeutro: '1.000',
  csdNeutro: '1.000',
  tolleranzaIsfPct: '0.0050',
  sogliaMancatiUtilizziDiffida: 2,
  sogliaMancatiUtilizziDecadenza: 3,
  sogliaScostamentoDichiaratoPct: '0.2000',
  sogliaIsfCompensazione: '0.2000',
  retentionLogOperazioniGiorni: 30,
  quotaNuoveAssociazioniPct: '0.0000',
  termineGiustificazioneGiorni: 7,
  creataIl: '2026-01-01T00:00:00.000Z',
  csdScaglioni: [{ rapportoFdFrMin: '0', rapportoFdFrMax: null, coefficiente: '1.000' }],
};

describe('VersioneParametricaForm', () => {
  it('precompila i campi con la versione attiva', () => {
    render(<VersioneParametricaForm versioneAttuale={VERSIONE_ATTIVA} onSalvata={() => {}} onAnnulla={() => {}} />);
    expect((screen.getByLabelText(/moltiplicatore minuti/i) as HTMLInputElement).value).toBe('60.000');
    expect((screen.getByLabelText(/limite minuti settimanali/i) as HTMLInputElement).value).toBe('600.000');
  });

  it('submit chiama creaVersione con i valori del form', async () => {
    const nuovaVersione = { ...VERSIONE_ATTIVA, id: 'v-2' };
    const creaSpy = vi.spyOn(api, 'creaVersione').mockResolvedValue(nuovaVersione);
    const onSalvata = vi.fn();

    render(<VersioneParametricaForm versioneAttuale={VERSIONE_ATTIVA} onSalvata={onSalvata} onAnnulla={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /salva e pubblica/i }));

    expect(creaSpy).toHaveBeenCalled();
    expect(onSalvata).toHaveBeenCalledWith(nuovaVersione);
  });

  it('errore dal backend mostrato nel form', async () => {
    vi.spyOn(api, 'creaVersione').mockRejectedValue(new api.ErroreRichiestaApi(400, 'csdScaglioni non può essere vuoto'));
    render(<VersioneParametricaForm versioneAttuale={VERSIONE_ATTIVA} onSalvata={() => {}} onAnnulla={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /salva e pubblica/i }));
    expect(await screen.findByText('csdScaglioni non può essere vuoto')).toBeInTheDocument();
  });

  it('permette di aggiungere e rimuovere uno scaglione CSD', async () => {
    render(<VersioneParametricaForm versioneAttuale={VERSIONE_ATTIVA} onSalvata={() => {}} onAnnulla={() => {}} />);
    expect(screen.getAllByLabelText(/coefficiente scaglione/i)).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /aggiungi scaglione/i }));
    expect(screen.getAllByLabelText(/coefficiente scaglione/i)).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: /rimuovi scaglione/i })[0]!);
    expect(screen.getAllByLabelText(/coefficiente scaglione/i)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Esegui il test, verifica che fallisca**

Run: `cd frontend-backoffice && npx vitest run src/components/parametrico/VersioneParametricaForm.test.tsx`
Expected: FAIL — `Cannot find module './VersioneParametricaForm.tsx'`

- [ ] **Step 4: Crea `VersioneParametricaForm.tsx`**

```tsx
import React, { useState } from 'react';
import { creaVersione, type VersioneParametrica, type DatiCreaVersione, type ScaglioneCsd, ErroreRichiestaApi } from '../../api/parametrico.ts';

interface VersioneParametricaFormProps {
  versioneAttuale: VersioneParametrica;
  onSalvata: (v: VersioneParametrica) => void;
  onAnnulla: () => void;
}

const REGEX_DECIMALE = /^\d{1,3}(\.\d{1,3})?$/;
const REGEX_DECIMALE_ESTESO = /^\d{1,7}(\.\d{1,3})?$/;
const REGEX_RAPPORTO_01 = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/;

function campoLabelStyle(): React.CSSProperties {
  return { fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' };
}

export function VersioneParametricaForm({ versioneAttuale, onSalvata, onAnnulla }: VersioneParametricaFormProps): React.ReactElement {
  const [dati, setDati] = useState<DatiCreaVersione>({
    note: versioneAttuale.note ?? undefined,
    moltiplicatoreMinutiPerPunto: versioneAttuale.moltiplicatoreMinutiPerPunto,
    pesoFasciaPregiata: versioneAttuale.pesoFasciaPregiata,
    minutiSettimanaliMax: versioneAttuale.minutiSettimanaliMax,
    slotMaxStessoImpianto: versioneAttuale.slotMaxStessoImpianto,
    fascePregiateMax: versioneAttuale.fascePregiateMax,
    giornateGaraMax: versioneAttuale.giornateGaraMax,
    incrementoSquadreNeutro: versioneAttuale.incrementoSquadreNeutro,
    caaNeutro: versioneAttuale.caaNeutro,
    csdNeutro: versioneAttuale.csdNeutro,
    tolleranzaIsfPct: versioneAttuale.tolleranzaIsfPct,
    sogliaMancatiUtilizziDiffida: versioneAttuale.sogliaMancatiUtilizziDiffida,
    sogliaMancatiUtilizziDecadenza: versioneAttuale.sogliaMancatiUtilizziDecadenza,
    sogliaScostamentoDichiaratoPct: versioneAttuale.sogliaScostamentoDichiaratoPct,
    sogliaIsfCompensazione: versioneAttuale.sogliaIsfCompensazione,
    retentionLogOperazioniGiorni: versioneAttuale.retentionLogOperazioniGiorni,
    quotaNuoveAssociazioniPct: versioneAttuale.quotaNuoveAssociazioniPct,
    termineGiustificazioneGiorni: versioneAttuale.termineGiustificazioneGiorni,
    csdScaglioni: versioneAttuale.csdScaglioni,
  });
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const campoTesto = (
    chiave: keyof DatiCreaVersione,
    etichetta: string,
    regex: RegExp,
    id: string,
  ): React.ReactElement => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <label htmlFor={id} style={campoLabelStyle()}>{etichetta}</label>
      <input
        id={id}
        className="form-control"
        value={String(dati[chiave])}
        onChange={(e) => setDati((prev) => ({ ...prev, [chiave]: e.target.value }))}
        pattern={regex.source}
        required
      />
    </div>
  );

  const campoNumero = (chiave: keyof DatiCreaVersione, etichetta: string, id: string): React.ReactElement => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <label htmlFor={id} style={campoLabelStyle()}>{etichetta}</label>
      <input
        id={id}
        type="number"
        className="form-control"
        value={dati[chiave] as number}
        onChange={(e) => setDati((prev) => ({ ...prev, [chiave]: Number(e.target.value) }))}
        required
      />
    </div>
  );

  const aggiornaScaglione = (indice: number, campo: keyof ScaglioneCsd, valore: string): void => {
    setDati((prev) => ({
      ...prev,
      csdScaglioni: prev.csdScaglioni.map((s, i) =>
        i === indice ? { ...s, [campo]: campo === 'rapportoFdFrMax' && valore === '' ? null : valore } : s,
      ),
    }));
  };

  const aggiungiScaglione = (): void => {
    setDati((prev) => ({ ...prev, csdScaglioni: [...prev.csdScaglioni, { rapportoFdFrMin: '', rapportoFdFrMax: null, coefficiente: '' }] }));
  };

  const rimuoviScaglione = (indice: number): void => {
    setDati((prev) => ({ ...prev, csdScaglioni: prev.csdScaglioni.filter((_, i) => i !== indice) }));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      const risultato = await creaVersione(dati);
      onSalvata(risultato);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {campoTesto('moltiplicatoreMinutiPerPunto', 'Moltiplicatore Minuti / Peso (Art. A.5)', REGEX_DECIMALE_ESTESO, 'pv-moltiplicatore')}
        {campoTesto('pesoFasciaPregiata', 'Peso Ponderazione Fasce Pregiate (Art. A.9)', REGEX_DECIMALE, 'pv-peso-pregiate')}
        {campoTesto('minutiSettimanaliMax', 'Limite Minuti Settimanali (Art. B.19)', REGEX_DECIMALE_ESTESO, 'pv-minuti-max')}
        {campoNumero('slotMaxStessoImpianto', 'Limite Slot Stesso Impianto', 'pv-slot-max')}
        {campoNumero('fascePregiateMax', 'Limite Fasce Pregiate', 'pv-fasce-pregiate-max')}
        {campoNumero('giornateGaraMax', 'Limite Giornate Gara', 'pv-giornate-gara-max')}
        {campoNumero('incrementoSquadreNeutro', 'Incremento Squadre Neutro', 'pv-incremento-squadre')}
        {campoTesto('caaNeutro', 'CAA Neutro', REGEX_DECIMALE, 'pv-caa-neutro')}
        {campoTesto('csdNeutro', 'CSD Neutro', REGEX_DECIMALE, 'pv-csd-neutro')}
        {campoTesto('tolleranzaIsfPct', 'Tolleranza Parità ISF (Art. B.20)', REGEX_RAPPORTO_01, 'pv-tolleranza-isf')}
        {campoNumero('sogliaMancatiUtilizziDiffida', 'Soglia Diffida (mancati utilizzi)', 'pv-soglia-diffida')}
        {campoNumero('sogliaMancatiUtilizziDecadenza', 'Soglia Decadenza (mancati utilizzi)', 'pv-soglia-decadenza')}
        {campoTesto('sogliaScostamentoDichiaratoPct', 'Soglia Scostamento Dichiarato', REGEX_RAPPORTO_01, 'pv-soglia-scostamento')}
        {campoTesto('sogliaIsfCompensazione', 'Soglia ISF Compensazione', REGEX_RAPPORTO_01, 'pv-soglia-isf-compensazione')}
        {campoNumero('retentionLogOperazioniGiorni', 'Retention Log Operazioni (giorni)', 'pv-retention-log')}
        {campoTesto('quotaNuoveAssociazioniPct', 'Quota Nuove Associazioni (Art. 12)', REGEX_RAPPORTO_01, 'pv-quota-nuove')}
        {campoNumero('termineGiustificazioneGiorni', 'Termine Giustificazione (giorni)', 'pv-termine-giustificazione')}
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Scaglioni CSD (Art. A.11)</div>
        {dati.csdScaglioni.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <input
              aria-label={`rapporto minimo scaglione ${i + 1}`}
              className="form-control"
              value={s.rapportoFdFrMin}
              onChange={(e) => aggiornaScaglione(i, 'rapportoFdFrMin', e.target.value)}
            />
            <input
              aria-label={`rapporto massimo scaglione ${i + 1}`}
              className="form-control"
              value={s.rapportoFdFrMax ?? ''}
              placeholder="infinito"
              onChange={(e) => aggiornaScaglione(i, 'rapportoFdFrMax', e.target.value)}
            />
            <input
              aria-label={`coefficiente scaglione ${i + 1}`}
              className="form-control"
              value={s.coefficiente}
              onChange={(e) => aggiornaScaglione(i, 'coefficiente', e.target.value)}
            />
            <button type="button" aria-label={`rimuovi scaglione ${i + 1}`} className="btn btn-secondary btn-sm" onClick={() => rimuoviScaglione(i)}>
              Rimuovi
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={aggiungiScaglione}>
          Aggiungi scaglione
        </button>
      </div>

      {errore && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {errore}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button type="submit" className="btn btn-success" disabled={inCorso}>
          {inCorso ? 'Salvataggio...' : 'Salva e Pubblica'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onAnnulla}>
          Annulla
        </button>
      </div>
    </form>
  );
}
```

Nota accessibilità test: gli `aria-label` `rimuovi scaglione N`/`coefficiente scaglione N` nel test usano match case-insensitive parziale (`/coefficiente scaglione/i`, `/rimuovi scaglione/i`) — coerenti con gli `aria-label` sopra.

- [ ] **Step 5: Esegui il test del form, verifica che passi**

Run: `cd frontend-backoffice && npx vitest run src/components/parametrico/VersioneParametricaForm.test.tsx`
Expected: PASS

- [ ] **Step 6: Scrivi il test della vista che fallisce**

Crea `frontend-backoffice/src/components/ParametriSistemaView.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as api from '../api/parametrico.ts';
import { ParametriSistemaView } from './ParametriSistemaView.tsx';
import type { VersioneParametrica, VersioneParametricaSintetica } from '../api/parametrico.ts';

const VERSIONE: VersioneParametrica = {
  id: 'v-1',
  validaDal: '2026-01-01T00:00:00.000Z',
  pubblicataDa: null,
  note: null,
  moltiplicatoreMinutiPerPunto: '60.000',
  pesoFasciaPregiata: '1.250',
  minutiSettimanaliMax: '600.000',
  slotMaxStessoImpianto: 4,
  fascePregiateMax: 2,
  giornateGaraMax: 1,
  incrementoSquadreNeutro: 0,
  caaNeutro: '1.000',
  csdNeutro: '1.000',
  tolleranzaIsfPct: '0.0050',
  sogliaMancatiUtilizziDiffida: 2,
  sogliaMancatiUtilizziDecadenza: 3,
  sogliaScostamentoDichiaratoPct: '0.2000',
  sogliaIsfCompensazione: '0.2000',
  retentionLogOperazioniGiorni: 30,
  quotaNuoveAssociazioniPct: '0.0000',
  termineGiustificazioneGiorni: 7,
  creataIl: '2026-01-01T00:00:00.000Z',
  csdScaglioni: [{ rapportoFdFrMin: '0', rapportoFdFrMax: null, coefficiente: '1.000' }],
};

const STORICO: VersioneParametricaSintetica[] = [{ id: 'v-1', validaDal: VERSIONE.validaDal, pubblicataDa: null, note: null }];

describe('ParametriSistemaView', () => {
  it('mostra la versione attiva e lo storico', async () => {
    vi.spyOn(api, 'leggiVersioneAttiva').mockResolvedValue(VERSIONE);
    vi.spyOn(api, 'listaVersioni').mockResolvedValue(STORICO);

    render(<ParametriSistemaView />);

    expect(await screen.findByText(/60\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Storico Versioni/i)).toBeInTheDocument();
  });

  it('errore di caricamento mostrato', async () => {
    vi.spyOn(api, 'leggiVersioneAttiva').mockRejectedValue(new api.ErroreRichiestaApi(404, 'nessuna versione parametrica trovata'));
    vi.spyOn(api, 'listaVersioni').mockResolvedValue([]);

    render(<ParametriSistemaView />);
    expect(await screen.findByText('nessuna versione parametrica trovata')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Esegui il test, verifica che fallisca**

Run: `cd frontend-backoffice && npx vitest run src/components/ParametriSistemaView.test.tsx`
Expected: FAIL

- [ ] **Step 8: Riscrivi `ParametriSistemaView.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { leggiVersioneAttiva, listaVersioni, type VersioneParametrica, type VersioneParametricaSintetica, ErroreRichiestaApi } from '../api/parametrico.ts';
import { VersioneParametricaForm } from './parametrico/VersioneParametricaForm.tsx';
import { Plus, History, Lock } from 'lucide-react';

export const ParametriSistemaView: React.FC = () => {
  const [versioneAttiva, setVersioneAttiva] = useState<VersioneParametrica | null>(null);
  const [storico, setStorico] = useState<VersioneParametricaSintetica[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const ricarica = (): void => {
    leggiVersioneAttiva()
      .then((v) => {
        setVersioneAttiva(v);
        setErrore(null);
      })
      .catch((err) => setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare la versione attiva.'));
    listaVersioni()
      .then(setStorico)
      .catch(() => {
        // storico non essenziale al rendering principale: nessun blocco della vista
      });
  };

  useEffect(ricarica, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Parametri di Sistema (`allegato_parametrico`)</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Valori normativi modificabili esclusivamente dall'Amministratore e versionati su DB
          </p>
        </div>
        {versioneAttiva && (
          <button onClick={() => setIsEditing(true)} disabled={isEditing} className="btn btn-primary">
            <Plus size={16} />
            <span>Pubblica Nuova Versione Parametrica</span>
          </button>
        )}
      </div>

      <div className="pa-card" style={{ backgroundColor: '#FEF9E7', borderLeft: '4px solid #F39C12' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Lock size={22} color="#D68910" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, color: '#B7950B' }}>Garanzia di Riproducibilità Storica (Art. B.1 - Allegato B)</div>
            <div style={{ fontSize: '0.825rem', color: '#7D6608', marginTop: '2px' }}>
              I parametri non vengono mai sovrascritti <em>in place</em>. Ogni nuova modifica genera un nuovo record versionato.
            </div>
          </div>
        </div>
      </div>

      {errore && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {errore}
        </div>
      )}

      {versioneAttiva && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.25rem' }}>
          <div className="pa-card">
            {isEditing ? (
              <VersioneParametricaForm
                versioneAttuale={versioneAttiva}
                onSalvata={(v) => {
                  setVersioneAttiva(v);
                  setIsEditing(false);
                  ricarica();
                }}
                onAnnulla={() => setIsEditing(false)}
              />
            ) : (
              <>
                <span className="badge badge-success" style={{ marginBottom: '0.35rem' }}>Versione Attiva Ora</span>
                <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)', marginBottom: '1rem' }}>
                  Valida dal: {versioneAttiva.validaDal}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div>Moltiplicatore Minuti/Peso: <strong>{versioneAttiva.moltiplicatoreMinutiPerPunto}</strong></div>
                  <div>Peso Fasce Pregiate: <strong>{versioneAttiva.pesoFasciaPregiata}</strong></div>
                  <div>Limite Minuti Settimanali: <strong>{versioneAttiva.minutiSettimanaliMax}</strong></div>
                  <div>Limite Slot Stesso Impianto: <strong>{versioneAttiva.slotMaxStessoImpianto}</strong></div>
                  <div>Tolleranza ISF: <strong>{versioneAttiva.tolleranzaIsfPct}</strong></div>
                  <div>Quota Nuove Associazioni: <strong>{versioneAttiva.quotaNuoveAssociazioniPct}</strong></div>
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'var(--pa-blue-dark)' }}>
              <History size={18} color="var(--pa-blue-primary)" />
              <span>Storico Versioni ({storico.length})</span>
            </div>
            {storico.map((v) => (
              <div key={v.id} className="pa-card" style={{ borderLeft: v.id === versioneAttiva.id ? '4px solid var(--pa-success)' : '1px solid var(--pa-border)', padding: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '0.875rem' }}>{v.validaDal}</strong>
                  {v.id === versioneAttiva.id ? (
                    <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>ATTIVA</span>
                  ) : (
                    <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>ARCHIVIATA</span>
                  )}
                </div>
                {v.note && <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)', marginTop: '0.2rem' }}>{v.note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 9: Esegui il test, verifica che passi**

Run: `cd frontend-backoffice && npx vitest run src/components/ParametriSistemaView.test.tsx`
Expected: PASS

- [ ] **Step 10: Typecheck**

Run: `cd frontend-backoffice && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore

- [ ] **Step 11: Commit**

```bash
git add frontend-backoffice/src/api/parametrico.ts frontend-backoffice/src/components/parametrico/VersioneParametricaForm.tsx frontend-backoffice/src/components/parametrico/VersioneParametricaForm.test.tsx frontend-backoffice/src/components/ParametriSistemaView.tsx frontend-backoffice/src/components/ParametriSistemaView.test.tsx
git commit -m "feat(frontend-backoffice): collega ParametriSistemaView alle API reali (versione attiva/storico + form crea versione con scaglioni CSD)"
```

---

## Task 7: Frontend — `ControlRoomView` collegata alla coda motore Go reale

**Files:**
- Create: `frontend-backoffice/src/api/motore.ts`
- Modify: `frontend-backoffice/src/components/ControlRoomView.tsx`
- Test: `frontend-backoffice/src/components/ControlRoomView.test.tsx` (nuovo)

**Interfaces:**
- Consumes: `apiFetch` da `../api/client.ts`; stagione da `useOutletContext<string>()` (stesso pattern di `ImpiantiSpaziView`).
- Produces: `Elaborazione`, `RisultatoIstruttoria`, `RisultatoBlocchiGara`, `RisultatoPrimaAssegnazione`, `RisultatoRiassegnazioneResidua`, `RisultatoApprovaDefinitiva`, `eseguiIstruttoria(stagioneId)`, `eseguiBlocchiGara(stagioneId)`, `eseguiPrimaAssegnazione(stagioneId)`, `eseguiRiassegnazioneResidua(stagioneId)`, `approvaDefinitiva(stagioneId)`, `listaElaborazioni(stagioneId)`.

- [ ] **Step 1: Crea `frontend-backoffice/src/api/motore.ts`**

```ts
import { apiFetch } from './client.ts';

export interface Elaborazione {
  id: string;
  stagioneId: string;
  tipo: string;
  parametricoVersioneId: string | null;
  iniziataIl: string;
  conclusaIl: string | null;
  stato: 'in_corso' | 'completata' | 'fallita';
  numeroRoundEseguiti: number | null;
  logDettaglio: unknown;
}

export interface RisultatoIstruttoria {
  domandeCalcolate: number;
}

export interface RisultatoBlocchiGara {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  richiesteNonAssegnate: number;
}

export interface RisultatoPrimaAssegnazione {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  roundEseguiti: number;
}

export interface RisultatoRiassegnazioneResidua {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  roundEseguiti: number;
}

export interface RisultatoApprovaDefinitiva {
  convenzioniCreate: number;
  assegnazioniSenzaIstituzioneSaltate: number;
}

export class ErroreRichiestaApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function richiedi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
  return (await r.json()) as T;
}

function post(path: string): Promise<unknown> {
  return richiedi(path, { method: 'POST' });
}

export function eseguiIstruttoria(stagioneId: string): Promise<RisultatoIstruttoria> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/istruttoria`) as Promise<RisultatoIstruttoria>;
}

export function eseguiBlocchiGara(stagioneId: string): Promise<RisultatoBlocchiGara> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/blocchi-gara`) as Promise<RisultatoBlocchiGara>;
}

export function eseguiPrimaAssegnazione(stagioneId: string): Promise<RisultatoPrimaAssegnazione> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/prima-assegnazione`) as Promise<RisultatoPrimaAssegnazione>;
}

export function eseguiRiassegnazioneResidua(stagioneId: string): Promise<RisultatoRiassegnazioneResidua> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/riassegnazione-residua`) as Promise<RisultatoRiassegnazioneResidua>;
}

export function approvaDefinitiva(stagioneId: string): Promise<RisultatoApprovaDefinitiva> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/approva-definitiva`) as Promise<RisultatoApprovaDefinitiva>;
}

export function listaElaborazioni(stagioneId: string): Promise<Elaborazione[]> {
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/elaborazioni`);
}
```

- [ ] **Step 2: Scrivi il test della vista che fallisce**

Crea `frontend-backoffice/src/components/ControlRoomView.test.tsx`. `useOutletContext` richiede un router attorno al componente: usa `createMemoryRouter`/`RouterProvider` con un `Outlet` fittizio che passa il context, stesso approccio minimale già visto in `App.test.tsx` (verificane l'import esatto prima di scrivere — se `App.test.tsx` monta l'intero albero `routes.tsx`, replica lì lo stesso schema invece di reinventarne uno nuovo qui):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import * as api from '../api/motore.ts';
import { ControlRoomView } from './ControlRoomView.tsx';

function renderConStagione(stagioneId: string) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={stagioneId} />,
      children: [{ index: true, element: <ControlRoomView /> }],
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('ControlRoomView', () => {
  it('carica le elaborazioni della stagione selezionata', async () => {
    vi.spyOn(api, 'listaElaborazioni').mockResolvedValue([
      {
        id: 'el-1',
        stagioneId: 'stag-1',
        tipo: 'istruttoria',
        parametricoVersioneId: null,
        iniziataIl: '2026-08-01T10:00:00.000Z',
        conclusaIl: '2026-08-01T10:00:05.000Z',
        stato: 'completata',
        numeroRoundEseguiti: null,
        logDettaglio: null,
      },
    ]);

    renderConStagione('stag-1');

    expect(await screen.findByText(/istruttoria/i)).toBeInTheDocument();
  });

  it('esegue istruttoria e mostra il risultato', async () => {
    vi.spyOn(api, 'listaElaborazioni').mockResolvedValue([]);
    const spy = vi.spyOn(api, 'eseguiIstruttoria').mockResolvedValue({ domandeCalcolate: 5 });

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /istruttoria/i }));

    expect(spy).toHaveBeenCalledWith('stag-1');
    expect(await screen.findByText(/5/)).toBeInTheDocument();
  });

  it('mostra l\'errore reale del backend (409 elaborazione in corso)', async () => {
    vi.spyOn(api, 'listaElaborazioni').mockResolvedValue([]);
    vi.spyOn(api, 'eseguiIstruttoria').mockRejectedValue(new api.ErroreRichiestaApi(409, 'elaborazione già in corso per questa stagione'));

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /istruttoria/i }));

    expect(await screen.findByText('elaborazione già in corso per questa stagione')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Esegui il test, verifica che fallisca**

Run: `cd frontend-backoffice && npx vitest run src/components/ControlRoomView.test.tsx`
Expected: FAIL

- [ ] **Step 4: Riscrivi `ControlRoomView.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import {
  eseguiIstruttoria,
  eseguiBlocchiGara,
  eseguiPrimaAssegnazione,
  eseguiRiassegnazioneResidua,
  approvaDefinitiva,
  listaElaborazioni,
  type Elaborazione,
  ErroreRichiestaApi,
} from '../api/motore.ts';
import { Cpu, Calculator, ShieldCheck, Play, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

type TipoAzione = 'istruttoria' | 'blocchi_gara' | 'prima_assegnazione' | 'riassegnazione_residua' | 'approva_definitiva';

export const ControlRoomView: React.FC = () => {
  const stagioneId = useOutletContext<string>() ?? '';
  const [elaborazioni, setElaborazioni] = useState<Elaborazione[]>([]);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [azioneInCorso, setAzioneInCorso] = useState<TipoAzione | null>(null);
  const [ultimoRisultato, setUltimoRisultato] = useState<string | null>(null);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);

  const ricarica = (): void => {
    if (!stagioneId) return;
    listaElaborazioni(stagioneId)
      .then(setElaborazioni)
      .catch((err) => setErroreCaricamento(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare le elaborazioni.'));
  };

  useEffect(ricarica, [stagioneId]);

  const eseguiAzione = async (tipo: TipoAzione): Promise<void> => {
    setAzioneInCorso(tipo);
    setErroreAzione(null);
    setUltimoRisultato(null);
    try {
      switch (tipo) {
        case 'istruttoria': {
          const r = await eseguiIstruttoria(stagioneId);
          setUltimoRisultato(`Istruttoria completata: ${r.domandeCalcolate} domande calcolate.`);
          break;
        }
        case 'blocchi_gara': {
          const r = await eseguiBlocchiGara(stagioneId);
          setUltimoRisultato(`Blocchi gara: ${r.numeroAssegnazioni} assegnazioni, ${r.richiesteNonAssegnate} richieste non assegnate.`);
          break;
        }
        case 'prima_assegnazione': {
          const r = await eseguiPrimaAssegnazione(stagioneId);
          setUltimoRisultato(`Prima assegnazione: ${r.numeroAssegnazioni} assegnazioni in ${r.roundEseguiti} round.`);
          break;
        }
        case 'riassegnazione_residua': {
          const r = await eseguiRiassegnazioneResidua(stagioneId);
          setUltimoRisultato(`Riassegnazione residua: ${r.numeroAssegnazioni} assegnazioni in ${r.roundEseguiti} round.`);
          break;
        }
        case 'approva_definitiva': {
          const r = await approvaDefinitiva(stagioneId);
          setUltimoRisultato(`Settimana tipo definitiva approvata: ${r.convenzioniCreate} convenzioni create.`);
          break;
        }
      }
      ricarica();
    } catch (err) {
      setErroreAzione(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setAzioneInCorso(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Control Room Procedura & Algoritmo</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>Orchestrazione della coda verso il motore Go — Provincia di Pescara</p>
      </div>

      {!stagioneId && <div style={{ color: 'var(--pa-text-muted)' }}>Seleziona una stagione nell'Header per iniziare.</div>}

      {stagioneId && (
        <>
          <div className="pa-card" style={{ background: 'linear-gradient(135deg, #002B55 0%, #0056B3 100%)', color: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <Cpu size={20} />
              <h3 style={{ color: 'white', margin: 0 }}>Azioni di Avanzamento Algoritmico</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button onClick={() => eseguiAzione('istruttoria')} disabled={azioneInCorso !== null} className="btn btn-sm">
                <Calculator size={16} /><span>Istruttoria</span>
              </button>
              <button onClick={() => eseguiAzione('blocchi_gara')} disabled={azioneInCorso !== null} className="btn btn-sm">
                <ShieldCheck size={16} /><span>Blocchi Gara</span>
              </button>
              <button onClick={() => eseguiAzione('prima_assegnazione')} disabled={azioneInCorso !== null} className="btn btn-success btn-sm">
                <Play size={16} /><span>{azioneInCorso === 'prima_assegnazione' ? 'Esecuzione...' : 'Prima Assegnazione'}</span>
              </button>
              <button onClick={() => eseguiAzione('riassegnazione_residua')} disabled={azioneInCorso !== null} className="btn btn-sm">
                <Play size={16} /><span>Riassegnazione Residua</span>
              </button>
              <button onClick={() => eseguiAzione('approva_definitiva')} disabled={azioneInCorso !== null} className="btn btn-sm">
                <CheckCircle2 size={16} /><span>Approva Definitiva</span>
              </button>
            </div>
            {ultimoRisultato && <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>{ultimoRisultato}</div>}
            {erroreAzione && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <AlertCircle size={16} /><span>{erroreAzione}</span>
              </div>
            )}
          </div>

          {erroreCaricamento && (
            <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
              {erroreCaricamento}
            </div>
          )}

          <div className="pa-card">
            <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>Storico Elaborazioni</h3>
            <div className="pa-table-container">
              <table className="pa-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Iniziata Il</th>
                    <th>Conclusa Il</th>
                    <th>Stato</th>
                    <th>Round Eseguiti</th>
                  </tr>
                </thead>
                <tbody>
                  {elaborazioni.map((e) => (
                    <tr key={e.id}>
                      <td>{e.tipo}</td>
                      <td>{e.iniziataIl}</td>
                      <td>{e.conclusaIl ?? '—'}</td>
                      <td>
                        {e.stato === 'completata' && <span className="badge badge-success"><CheckCircle2 size={12} /> Completata</span>}
                        {e.stato === 'in_corso' && <span className="badge badge-info"><Clock size={12} /> In Corso</span>}
                        {e.stato === 'fallita' && <span className="badge badge-danger">Fallita</span>}
                      </td>
                      <td>{e.numeroRoundEseguiti ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 5: Esegui il test, verifica che passi**

Run: `cd frontend-backoffice && npx vitest run src/components/ControlRoomView.test.tsx`
Expected: PASS

- [ ] **Step 6: Aggiorna `routes.tsx` se necessario**

Verifica che `{ index: true, element: <ControlRoomView /> }` in `routes.tsx` (riga 23) resti dentro l'albero con `BackofficeLayout` come genitore (già così, vedi file letto in fase di design) — nessuna modifica necessaria qui, solo verifica che il typecheck del Task non lo rompa.

- [ ] **Step 7: Typecheck**

Run: `cd frontend-backoffice && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore

- [ ] **Step 8: Commit**

```bash
git add frontend-backoffice/src/api/motore.ts frontend-backoffice/src/components/ControlRoomView.tsx frontend-backoffice/src/components/ControlRoomView.test.tsx
git commit -m "feat(frontend-backoffice): collega ControlRoomView alla coda motore Go reale (istruttoria/blocchi-gara/prima-assegnazione/riassegnazione/approva-definitiva + storico elaborazioni)"
```

---

## Task 8: Frontend — `AuditSorteggioView` collegata alle API reali + verifica HMAC vera

**Files:**
- Create: `frontend-backoffice/src/api/audit.ts`
- Modify: `frontend-backoffice/src/components/AuditSorteggioView.tsx`
- Test: `frontend-backoffice/src/components/AuditSorteggioView.test.tsx` (nuovo)

**Interfaces:**
- Consumes: `apiFetch` da `../api/client.ts`; stagione da `useOutletContext<string>()`.
- Produces: `OperazioneConAttore`, `SorteggioSintetico`, `SorteggioDettaglio`, `CandidatoSorteggio` (stesso shape camelCase del backend), `listaLogOperazioni(filtri)`, `listaSorteggiPerStagione(stagioneId)`, `trovaSorteggio(id)`, `verificaHmac(semeHex, associazioneId): Promise<string>`.

- [ ] **Step 1: Crea `frontend-backoffice/src/api/audit.ts`**

```ts
import { apiFetch } from './client.ts';

export interface OperazioneConAttore {
  id: string;
  attoreNome: string;
  attoreTipo: 'backoffice' | 'pubblico';
  ruolo: string | null;
  azione: string;
  entitaTipo: string;
  entitaId: string | null;
  dettaglio: Record<string, unknown> | null;
  ipAddress: string | null;
  avvenutaIl: string;
}

export interface SorteggioSintetico {
  id: string;
  elaborazioneId: string | null;
  articoloRiferimento: string;
  contesto: string;
  semeHex: string;
  semeGeneratoIl: string;
  vincitoreAssociazioneId: string;
}

export interface CandidatoSorteggio {
  associazioneId: string;
  ordineCanonico: number;
  hmacHex: string;
  rank: number;
}

export interface SorteggioDettaglio extends SorteggioSintetico {
  algoritmo: string;
  algoritmoVersione: string;
  hashVerbale: string;
  candidati: CandidatoSorteggio[];
}

export class ErroreRichiestaApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function richiedi<T>(path: string): Promise<T> {
  const r = await apiFetch(path);
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
  return (await r.json()) as T;
}

export interface FiltriLogOperazioni {
  entitaTipo?: string;
  azione?: string;
  dataDa?: string;
  dataA?: string;
  limit?: number;
  offset?: number;
}

export function listaLogOperazioni(filtri: FiltriLogOperazioni = {}): Promise<OperazioneConAttore[]> {
  const params = new URLSearchParams();
  if (filtri.entitaTipo) params.set('entitaTipo', filtri.entitaTipo);
  if (filtri.azione) params.set('azione', filtri.azione);
  if (filtri.dataDa) params.set('dataDa', filtri.dataDa);
  if (filtri.dataA) params.set('dataA', filtri.dataA);
  if (filtri.limit) params.set('limit', String(filtri.limit));
  if (filtri.offset) params.set('offset', String(filtri.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return richiedi(`/backoffice/log-operazioni${query}`);
}

export function listaSorteggiPerStagione(stagioneId: string): Promise<SorteggioSintetico[]> {
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/sorteggi`);
}

export function trovaSorteggio(id: string): Promise<SorteggioDettaglio> {
  return richiedi(`/backoffice/sorteggi/${encodeURIComponent(id)}`);
}

// Ricalcolo REALE dell'HMAC lato browser (art. B.38: "riproducibile da terzi con solo
// seme + lista candidati + HMAC-SHA256 standard", vedi CLAUDE.md). Stesso algoritmo del
// motore Go: HMAC-SHA256(key = decode_hex(seme), message = UTF8(associazione_id)), hex
// lowercase.
function hexABytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesAHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verificaHmac(semeHex: string, associazioneId: string): Promise<string> {
  const chiave = await crypto.subtle.importKey('raw', hexABytes(semeHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', chiave, new TextEncoder().encode(associazioneId));
  return bytesAHex(new Uint8Array(firma));
}
```

- [ ] **Step 2: Scrivi il test della vista che fallisce**

Crea `frontend-backoffice/src/components/AuditSorteggioView.test.tsx` (stesso pattern router del Task 7 per `useOutletContext`):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import * as api from '../api/audit.ts';
import { AuditSorteggioView } from './AuditSorteggioView.tsx';

function renderConStagione(stagioneId: string) {
  const router = createMemoryRouter([
    { path: '/', element: <Outlet context={stagioneId} />, children: [{ index: true, element: <AuditSorteggioView /> }] },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('AuditSorteggioView', () => {
  it('mostra il registro log-operazioni e i sorteggi della stagione', async () => {
    vi.spyOn(api, 'listaLogOperazioni').mockResolvedValue([
      { id: 'log-1', attoreNome: 'Admin Test (admin@test.local)', attoreTipo: 'backoffice', ruolo: 'admin', azione: 'crea_versione_parametrico', entitaTipo: 'parametrico_versioni', entitaId: 'v-1', dettaglio: null, ipAddress: null, avvenutaIl: '2026-08-01T10:00:00.000Z' },
    ]);
    vi.spyOn(api, 'listaSorteggiPerStagione').mockResolvedValue([
      { id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z', vincitoreAssociazioneId: 'ass-1' },
    ]);

    renderConStagione('stag-1');

    expect(await screen.findByText(/crea_versione_parametrico/i)).toBeInTheDocument();
    expect(await screen.findByText(/B\.21/)).toBeInTheDocument();
  });

  it('verifica HMAC reale: candidato genuino mostra esito positivo', async () => {
    vi.spyOn(api, 'listaLogOperazioni').mockResolvedValue([]);
    vi.spyOn(api, 'listaSorteggiPerStagione').mockResolvedValue([
      { id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z', vincitoreAssociazioneId: 'ass-1' },
    ]);
    const hmacGenuino = await api.verificaHmac('ab', 'ass-1');
    vi.spyOn(api, 'trovaSorteggio').mockResolvedValue({
      id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z',
      vincitoreAssociazioneId: 'ass-1', algoritmo: 'hmac-sha256-rank-asc', algoritmoVersione: 'v1', hashVerbale: 'x',
      candidati: [{ associazioneId: 'ass-1', ordineCanonico: 1, hmacHex: hmacGenuino, rank: 1 }],
    });

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /B\.21/i }));
    await userEvent.click(await screen.findByRole('button', { name: /ricalcola.*verifica/i }));

    expect(await screen.findByText(/verific/i)).toBeInTheDocument();
  });

  it('verifica HMAC reale: candidato manomesso mostra esito negativo', async () => {
    vi.spyOn(api, 'listaLogOperazioni').mockResolvedValue([]);
    vi.spyOn(api, 'listaSorteggiPerStagione').mockResolvedValue([
      { id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z', vincitoreAssociazioneId: 'ass-1' },
    ]);
    vi.spyOn(api, 'trovaSorteggio').mockResolvedValue({
      id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z',
      vincitoreAssociazioneId: 'ass-1', algoritmo: 'hmac-sha256-rank-asc', algoritmoVersione: 'v1', hashVerbale: 'x',
      candidati: [{ associazioneId: 'ass-1', ordineCanonico: 1, hmacHex: 'hmac-manomesso-non-corrispondente', rank: 1 }],
    });

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /B\.21/i }));
    await userEvent.click(await screen.findByRole('button', { name: /ricalcola.*verifica/i }));

    expect(await screen.findByText(/non corrisponde|manomess|non valid/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Esegui il test, verifica che fallisca**

Run: `cd frontend-backoffice && npx vitest run src/components/AuditSorteggioView.test.tsx`
Expected: FAIL

- [ ] **Step 4: Riscrivi `AuditSorteggioView.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import {
  listaLogOperazioni,
  listaSorteggiPerStagione,
  trovaSorteggio,
  verificaHmac,
  type OperazioneConAttore,
  type SorteggioSintetico,
  type SorteggioDettaglio,
  ErroreRichiestaApi,
} from '../api/audit.ts';
import { ShieldCheck, KeyRound, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';

interface EsitoVerificaCandidato {
  associazioneId: string;
  hmacRicalcolato: string;
  corrisponde: boolean;
}

export const AuditSorteggioView: React.FC = () => {
  const stagioneId = useOutletContext<string>() ?? '';
  const [log, setLog] = useState<OperazioneConAttore[]>([]);
  const [sorteggi, setSorteggi] = useState<SorteggioSintetico[]>([]);
  const [dettaglio, setDettaglio] = useState<SorteggioDettaglio | null>(null);
  const [esitiVerifica, setEsitiVerifica] = useState<EsitoVerificaCandidato[] | null>(null);
  const [verificaInCorso, setVerificaInCorso] = useState(false);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [filtroEntita, setFiltroEntita] = useState('');
  const [filtroAzione, setFiltroAzione] = useState('');

  const ricaricaLog = (): void => {
    listaLogOperazioni({ entitaTipo: filtroEntita || undefined, azione: filtroAzione || undefined })
      .then(setLog)
      .catch((err) => setErroreCaricamento(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare il log operazioni.'));
  };

  useEffect(ricaricaLog, [filtroEntita, filtroAzione]);

  useEffect(() => {
    if (!stagioneId) return;
    listaSorteggiPerStagione(stagioneId)
      .then(setSorteggi)
      .catch(() => setErroreCaricamento('Impossibile caricare i verbali di sorteggio.'));
  }, [stagioneId]);

  const apriVerbale = (id: string): void => {
    setEsitiVerifica(null);
    trovaSorteggio(id).then(setDettaglio).catch(() => setErroreCaricamento('Impossibile caricare il verbale.'));
  };

  const eseguiVerifica = async (): Promise<void> => {
    if (!dettaglio) return;
    setVerificaInCorso(true);
    try {
      const esiti = await Promise.all(
        dettaglio.candidati.map(async (c) => {
          const ricalcolato = await verificaHmac(dettaglio.semeHex, c.associazioneId);
          return { associazioneId: c.associazioneId, hmacRicalcolato: ricalcolato, corrisponde: ricalcolato === c.hmacHex };
        }),
      );
      setEsitiVerifica(esiti);
    } finally {
      setVerificaInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Audit Log & Verbali Sorteggio Tracciato HMAC</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Tracciabilità delle scritture (Art. B.39) e riproducibilità deterministica da terzi (Art. B.38)
        </p>
      </div>

      {erroreCaricamento && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {erroreCaricamento}
        </div>
      )}

      <div className="pa-card" style={{ borderTop: '4px solid var(--pa-accent)', backgroundColor: '#F0FDFA' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <KeyRound size={20} color="#0D9488" />
          <h3 style={{ margin: 0, color: '#0F766E' }}>Verbali di Sorteggio (HMAC-SHA256)</h3>
        </div>
        {!stagioneId && <div style={{ fontSize: '0.85rem', color: 'var(--pa-text-muted)' }}>Seleziona una stagione nell'Header.</div>}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {sorteggi.map((s) => (
            <button key={s.id} onClick={() => apriVerbale(s.id)} className="btn btn-secondary btn-sm">
              {s.articoloRiferimento} — {s.contesto}
            </button>
          ))}
        </div>
      </div>

      <div className="pa-card">
        <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '0.75rem' }}>Registro Tracciabilità Scritture (`log_operazioni`)</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input
            aria-label="Filtra per entità"
            className="form-control"
            placeholder="entità (es. domande)"
            value={filtroEntita}
            onChange={(e) => setFiltroEntita(e.target.value)}
          />
          <input
            aria-label="Filtra per azione"
            className="form-control"
            placeholder="azione (es. ammetti_domanda)"
            value={filtroAzione}
            onChange={(e) => setFiltroAzione(e.target.value)}
          />
        </div>
        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Data & Ora</th>
                <th>Attore</th>
                <th>Operazione</th>
                <th>Entità</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td>{l.avvenutaIl}</td>
                  <td><strong>{l.attoreNome}</strong></td>
                  <td><span className="badge badge-info">{l.azione}</span></td>
                  <td>{l.entitaTipo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {dettaglio && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '750px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Verbale — {dettaglio.articoloRiferimento}</h3>
              <button onClick={() => setDettaglio(null)} className="btn btn-secondary btn-sm">Chiudi</button>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700 }}>SEME CSPRNG:</div>
              <code style={{ fontSize: '0.75rem', wordBreak: 'break-all', display: 'block' }}>{dettaglio.semeHex}</code>
            </div>

            <table className="pa-table" style={{ marginBottom: '1.25rem' }}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Associazione</th>
                  <th>HMAC salvato</th>
                  <th>Esito verifica</th>
                </tr>
              </thead>
              <tbody>
                {dettaglio.candidati.map((c) => {
                  const esito = esitiVerifica?.find((e) => e.associazioneId === c.associazioneId);
                  return (
                    <tr key={c.associazioneId}>
                      <td>#{c.rank}</td>
                      <td>{c.associazioneId}</td>
                      <td><code style={{ fontSize: '0.7rem' }}>{c.hmacHex.substring(0, 24)}...</code></td>
                      <td>
                        {esito && esito.corrisponde && (
                          <span className="badge badge-success"><CheckCircle2 size={12} /> Verificato</span>
                        )}
                        {esito && !esito.corrisponde && (
                          <span className="badge badge-danger"><XCircle size={12} /> Non corrisponde</span>
                        )}
                        {!esito && <span className="badge badge-neutral">Non ancora verificato</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <button onClick={eseguiVerifica} disabled={verificaInCorso} className="btn btn-primary">
              <RefreshCw size={16} className={verificaInCorso ? 'spin' : ''} />
              <span>{verificaInCorso ? 'Ricalcolo in corso...' : 'Ricalcola & Verifica HMAC'}</span>
            </button>
            {esitiVerifica && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                {esitiVerifica.every((e) => e.corrisponde) ? (
                  <span style={{ color: 'var(--pa-success)', fontWeight: 700 }}><ShieldCheck size={16} /> Ricalcolo verificato: tutti gli HMAC corrispondono.</span>
                ) : (
                  <span style={{ color: 'var(--pa-danger)', fontWeight: 700 }}>Attenzione: uno o più HMAC ricalcolati non corrispondono — verbale potenzialmente manomesso.</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 5: Esegui il test, verifica che passi**

Run: `cd frontend-backoffice && npx vitest run src/components/AuditSorteggioView.test.tsx`
Expected: PASS. Se il test dell'esito genuino/manomesso non trova il testo (dipende dal wording esatto usato sopra), aggiusta i selettori dei test per farli combaciare col markup reale invece di cambiare il markup — i due devono restare in sync ma il testo esatto è a discrezione di chi implementa.

- [ ] **Step 6: Typecheck**

Run: `cd frontend-backoffice && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore

- [ ] **Step 7: Commit**

```bash
git add frontend-backoffice/src/api/audit.ts frontend-backoffice/src/components/AuditSorteggioView.tsx frontend-backoffice/src/components/AuditSorteggioView.test.tsx
git commit -m "feat(frontend-backoffice): collega AuditSorteggioView alle API reali (log-operazioni filtrato + verbali sorteggio con verifica HMAC reale via SubtleCrypto)"
```

---

## Task 9: Pulizia finale — rimozione dati mock ora inutilizzati

**Files:**
- Modify: `frontend-backoffice/src/mockData.ts`
- Modify: `frontend-backoffice/src/types.ts`

**Interfaces:**
- Consumes: nessuna (task di sola pulizia, dopo che gli 8 task precedenti hanno rimosso ogni `import` da `mockData.ts`/i tipi mock nelle 4 view).

- [ ] **Step 1: Verifica che nessun componente importi più da `mockData.ts`**

Run: `cd frontend-backoffice && grep -rl "from '../mockData'" src/components/ ; grep -rl "from './mockData'" src/`
Expected: nessun risultato (0 file) — se compare ancora qualcosa, torna al task corrispondente e completa il collegamento prima di procedere qui.

- [ ] **Step 2: Rimuovi da `mockData.ts` gli export non più referenziati da nessun file**

Per ciascun export di `mockData.ts` (`mockProcedurePhases`, `mockDomande`, `mockDelegateRequests`, `mockParametricVersions`, `mockAuditLogs`, `mockHMACVerbali`, e ogni altro export residuo — es. `mockSeasons`, già rimosso nel blocco precedente se presente), esegui `grep -rn "<nomeExport>" frontend-backoffice/src` e cancella l'export dal file solo se lo trovi referenziato unicamente nella propria definizione. Non toccare export ancora usati da `StatisticheView.tsx` (fuori scope di questo blocco, vedi spec).

- [ ] **Step 3: Rimuovi da `types.ts` le interfacce non più referenziate**

Stessa verifica grep per `DelegateRequest`, `Domanda`, `ParametricVersion`, `AuditLogItem`, `HMACSorteggioVerbale` — rimuovi solo quelle con zero riferimenti fuori da `types.ts` stesso. `Season`/`Facility`/`Space`/`Slot` restano (già rimossi/non toccati dal blocco Impianti/Spazi precedente se non referenziati — verifica comunque, non assumere).

- [ ] **Step 4: Typecheck**

Run: `cd frontend-backoffice && ./node_modules/.bin/tsc --noEmit`
Expected: nessun errore (nessun import rotto)

- [ ] **Step 5: Esegui l'intera suite frontend**

Run: `cd frontend-backoffice && npx vitest run`
Expected: PASS, nessuna regressione

- [ ] **Step 6: Commit**

```bash
git add frontend-backoffice/src/mockData.ts frontend-backoffice/src/types.ts
git commit -m "chore(frontend-backoffice): rimuove dati/tipi mock non più referenziati dopo il collegamento delle 4 view"
```

---

## Verifica finale (dopo Task 9)

- [ ] Backend: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable node --test "src/**/*.test.ts"` — tutta la suite passa, nessuna regressione sui blocchi precedenti.
- [ ] Backend typecheck: `cd backend-node && ./node_modules/.bin/tsc --noEmit`
- [ ] Frontend: `cd frontend-backoffice && npx vitest run` — tutta la suite passa.
- [ ] Frontend typecheck: `cd frontend-backoffice && ./node_modules/.bin/tsc --noEmit`
- [ ] Avvio manuale reale (backend + frontend) e verifica visiva delle 4 view nel browser con un utente admin e uno operatore, coerente con la regola CLAUDE.md "per modifiche UI, avviare il dev server e testare nel browser prima di dichiarare completato".
