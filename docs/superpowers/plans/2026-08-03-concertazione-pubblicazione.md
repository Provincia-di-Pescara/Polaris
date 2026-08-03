# Pubblicazione proposta + concertazione (B.23-28) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare pubblicazione della proposta provvisoria (art. B.23), proposte di concertazione tra associazioni (art. B.24-B.26) e validazione/approvazione (art. B.27-B.28), in `backend-node`, riusando lo schema Postgres già esistente (`concertazione_proposte`/`_parti`/`_slot`).

**Architettura:** Nessuna modifica al motore Go — la concertazione è workflow/negoziazione con verifiche strutturali, non calcolo algoritmico. Due repository nuove (`propostaProvvisoria.ts` per B.23, `concertazione.ts` per B.24-28), una migration (`assegnazioni.concertazione_proposta_id`), route in `server.ts` che seguono esattamente il pattern già in uso per domande/osservazioni (transazione esplicita + `registraOperazione`, guardie di stato dentro la `WHERE` dell'`UPDATE`, mapping errori consolidato).

**Tech Stack:** Node.js 24 + TypeScript 7 (`.ts` nativo, niente build step), `pg` diretto senza ORM, `zod` per validazione HTTP, `node --test` contro Postgres reale (no mock).

## Global Constraints

- Tutti i valori NUMERIC letti da Postgres sempre con `::text` + mai binding numerico diretto (coerente col resto del progetto e col motore Go).
- Arrotondamento/confronti su valori decimal: mai `float`/`Math`, solo confronti diretti su stringhe convertite con `Number()` per i soli controlli di soglia (stesso pattern già usato nelle `.refine()` zod del progetto — non persistenza di calcoli, solo gating).
- Ogni scrittura passa da `registraOperazione` (art. B.39) dentro la stessa transazione (`eseguiInTransazione`).
- Ogni route nuova mappa `ErroreNonTrovato`→404, `ErroreStatoNonValidoPerTransizione`/`ErroreConflittoFifoConcertazione`→409, `comeErroreRiferimentoNonValido`→400, altrimenti 500.
- Test sempre con `TEST_DATABASE_URL`, skip pulito se assente (`{ skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }`), fixture con suffissi `randomUUID()` per evitare collisioni su DB persistente.
- Nessuna modifica alla UI (Fase 5, non esiste ancora).

---

## File Structure

- **Create** `db/migrations/000012_concertazione_link_assegnazioni.up.sql` / `.down.sql` — colonna di collegamento assegnazione→proposta.
- **Create** `backend-node/src/propostaProvvisoria.ts` — B.23: pubblicazione + lettura proposta provvisoria.
- **Create** `backend-node/src/propostaProvvisoria.test.ts` — test repository.
- **Create** `backend-node/src/concertazione.ts` — B.24-B.28: CRUD proposte, ciclo vita, validazione.
- **Create** `backend-node/src/concertazione.test.ts` — test repository.
- **Modify** `backend-node/src/domande.ts` — esporta `validaSlotAppartengonoAStagione` (riuso, evita duplicazione della stessa logica anti-cross-stagione).
- **Modify** `backend-node/src/erroriDominio.ts` — nuova `ErroreConflittoFifoConcertazione`.
- **Modify** `backend-node/src/pubblicoSchema.ts` — `schemaCreaProposta`, `schemaAccettaProposta`.
- **Modify** `backend-node/src/backofficeSchema.ts` — riuso `schemaRespingiDelega` per il rigetto manuale (nessuna modifica se già generico; verificato al Task 3).
- **Modify** `backend-node/src/server.ts` — route pubblicazione/lettura proposta, route proposte pubbliche, route validazione backoffice.
- **Create** `backend-node/src/server.concertazione.publish.test.ts` — HTTP test B.23.
- **Create** `backend-node/src/server.concertazione.proposte.test.ts` — HTTP test B.24-26.
- **Create** `backend-node/src/server.concertazione.validazione.test.ts` — HTTP test B.27-28 (scenario end-to-end completo + FIFO + rigetti).

---

### Task 1: Migration — collegamento assegnazione↔proposta

**Files:**
- Create: `db/migrations/000012_concertazione_link_assegnazioni.up.sql`
- Create: `db/migrations/000012_concertazione_link_assegnazioni.down.sql`

**Interfaces:**
- Produces: colonna `assegnazioni.concertazione_proposta_id UUID NULL REFERENCES concertazione_proposte(id)`, usata da Task 7 (`validaProposta`) e da `propostaProvvisoria.ts`/`concertazione.ts` in generale come riferimento di schema.

- [ ] **Step 1: Scrivi la migration up**

```sql
-- backend-node non ha bisogno di ricalcolare gli "accordi intervenuti in fase di
-- concertazione" (art. B.30, blocco 4/4 futuro) da euristiche a posteriori: ogni
-- assegnazione nata da uno scambio validato porta un riferimento diretto alla proposta.
-- Nullable: le assegnazioni nate dal round-robin/blocchi-gara non la valorizzano mai.
ALTER TABLE assegnazioni ADD COLUMN concertazione_proposta_id UUID REFERENCES concertazione_proposte(id);
```

Salva in `db/migrations/000012_concertazione_link_assegnazioni.up.sql`.

- [ ] **Step 2: Scrivi la migration down**

```sql
ALTER TABLE assegnazioni DROP COLUMN concertazione_proposta_id;
```

Salva in `db/migrations/000012_concertazione_link_assegnazioni.down.sql`.

- [ ] **Step 3: Verifica contro Postgres reale**

Se non già in esecuzione, avvia un Postgres 18 effimero (vedi `CLAUDE.md` sezione "Test locale rapido" per il pattern), applica **tutte** le migration in ordine (000001..000012) con `psql -f`, poi verifica:

```bash
psql "$DATABASE_URL" -c "\d assegnazioni" | grep concertazione_proposta_id
```

Expected: la colonna compare con tipo `uuid`. Poi applica la `.down.sql` e riverifica che la colonna sia sparita, poi riapplica la `.up.sql` (le migration successive del test-suite si aspettano lo schema finale).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/000012_concertazione_link_assegnazioni.up.sql db/migrations/000012_concertazione_link_assegnazioni.down.sql
git commit -m "feat(db): aggiungi assegnazioni.concertazione_proposta_id per collegare gli scambi validati alla proposta di concertazione"
```

---

### Task 2: Esporta `validaSlotAppartengonoAStagione` da `domande.ts`

**Files:**
- Modify: `backend-node/src/domande.ts:222` (funzione già esistente, va solo esportata)
- Test: nessun test nuovo (comportamento già coperto da `domande.test.ts`), verificato dal typecheck.

**Interfaces:**
- Produces: `export async function validaSlotAppartengonoAStagione(db: Db, stagioneId: string, slotIds: string[]): Promise<void>` — lancia `ErroreRiferimentoNonValido` se uno slot non appartiene alla stagione. Consumato da Task 4 (`concertazione.ts::creaProposta`).

- [ ] **Step 1: Aggiungi `export` alla dichiarazione della funzione**

In `backend-node/src/domande.ts`, riga 222, cambia:

```ts
async function validaSlotAppartengonoAStagione(db: Db, stagioneId: string, slotIds: string[]): Promise<void> {
```

in:

```ts
export async function validaSlotAppartengonoAStagione(db: Db, stagioneId: string, slotIds: string[]): Promise<void> {
```

- [ ] **Step 2: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc` se il workspace pnpm blocca, vedi `CLAUDE.md`).
Expected: nessun errore (l'export non rompe nulla, la funzione era già usata solo internamente).

- [ ] **Step 3: Commit**

```bash
git add backend-node/src/domande.ts
git commit -m "refactor(backend): esporta validaSlotAppartengonoAStagione per riuso da concertazione.ts"
```

---

### Task 3: Errore dominio + schemi zod

**Files:**
- Modify: `backend-node/src/erroriDominio.ts`
- Modify: `backend-node/src/pubblicoSchema.ts`
- Test: `backend-node/src/erroriDominio.test.ts` (aggiungi un caso)

**Interfaces:**
- Produces: `ErroreConflittoFifoConcertazione` (classe, estende `Error`), `schemaCreaProposta` (zod, esporta tipo `CreaPropostaRequest`), `schemaAccettaProposta` (zod, esporta tipo `AccettaPropostaRequest`). Consumati da Task 7 (errore) e Task 8-9 (schemi, route).

- [ ] **Step 1: Scrivi il test per il nuovo errore**

Aggiungi in `backend-node/src/erroriDominio.test.ts` (segui lo stile dei test esistenti nello stesso file: sono semplici `assert(x instanceof Error)`):

```ts
test('ErroreConflittoFifoConcertazione è un\'istanza di Error con messaggio', () => {
  const err = new ErroreConflittoFifoConcertazione('conflitto');
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'conflitto');
});
```

Aggiungi l'import in cima al file: `import { ErroreConflittoFifoConcertazione } from './erroriDominio.ts';` (unisciti all'import esistente se già presente un import multiplo da `./erroriDominio.ts`).

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `cd backend-node && node --test src/erroriDominio.test.ts`
Expected: FAIL — `ErroreConflittoFifoConcertazione is not defined` / errore di import.

- [ ] **Step 3: Aggiungi la classe errore**

In `backend-node/src/erroriDominio.ts`, in fondo al file:

```ts
// Guardia FIFO su B.27: l'admin deve validare le proposte in concertazione_proposte in
// ordine di creata_il quando toccano slot in comune — validare una proposta più recente
// mentre una più vecchia sullo stesso slot è ancora accettata_da_tutti (non decisa) rompe
// l'ordine di sistema fissato in CLAUDE.md ("Validazione proposte: serializzata, sempre
// FIFO"). Errore di richiesta (l'admin deve processare la coda in ordine), non un esito
// di dominio come il rigetto per incompatibilità (quello resta 200, vedi concertazione.ts).
export class ErroreConflittoFifoConcertazione extends Error {}
```

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `cd backend-node && node --test src/erroriDominio.test.ts`
Expected: PASS.

- [ ] **Step 5: Aggiungi gli schemi zod**

In `backend-node/src/pubblicoSchema.ts`, in fondo al file:

```ts
export const schemaCreaProposta = z
  .object({
    stagioneId: z.string().uuid(),
    tipo: z.enum([
      'scambio_bilaterale',
      'scambio_multilaterale',
      'cessione',
      'utilizzo_slot_libero',
      'accorpamento',
      'ampliamento',
    ]),
    slot: z
      .array(
        z.object({
          slotId: z.string().uuid(),
          associazioneCedenteId: z.string().uuid().optional(),
          associazioneRiceventeId: z.string().uuid(),
        }),
      )
      .min(1),
  })
  .refine(
    (d) =>
      d.tipo === 'utilizzo_slot_libero'
        ? d.slot.every((s) => s.associazioneCedenteId === undefined)
        : d.slot.every((s) => s.associazioneCedenteId !== undefined),
    {
      message: "associazioneCedenteId deve essere assente per 'utilizzo_slot_libero', valorizzato per ogni altro tipo",
      path: ['slot'],
    },
  );
export type CreaPropostaRequest = z.infer<typeof schemaCreaProposta>;

export const schemaAccettaProposta = z.object({
  associazioneId: z.string().uuid(),
});
export type AccettaPropostaRequest = z.infer<typeof schemaAccettaProposta>;
```

- [ ] **Step 6: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/erroriDominio.ts backend-node/src/erroriDominio.test.ts backend-node/src/pubblicoSchema.ts
git commit -m "feat(backend): aggiungi ErroreConflittoFifoConcertazione e schemi zod per le proposte di concertazione"
```

---

### Task 4: Repository — B.23 pubblicazione proposta provvisoria

**Files:**
- Create: `backend-node/src/propostaProvvisoria.ts`
- Create: `backend-node/src/propostaProvvisoria.test.ts`

**Interfaces:**
- Consumes: `Db` da `./db.ts`; `ErroreNonTrovato`, `ErroreStatoNonValidoPerTransizione` da `./erroriDominio.ts`.
- Produces: `pubblicaProposta(db: Db, stagioneId: string): Promise<void>`; `trovaPropostaProvvisoria(db: Db, stagioneId: string): Promise<VocePropostaProvvisoria[]>`; interfaccia `VocePropostaProvvisoria`. Consumati da Task 8 (route).

- [ ] **Step 1: Scrivi il test per `pubblicaProposta`**

Crea `backend-node/src/propostaProvvisoria.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pubblicaProposta, trovaPropostaProvvisoria } from './propostaProvvisoria.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaStagione(pool: Pool, stato: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', $2) RETURNING id`,
    [`stagione-proposta-test-${randomUUID()}`, stato],
  );
  return r.rows[0]!.id;
}

test('pubblicaProposta rifiuta se non esiste elaborazione prima_assegnazione completata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  await assert.rejects(() => pubblicaProposta(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('pubblicaProposta rifiuta se stagione non è in prima_assegnazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'concertazione');
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata')`,
    [stagioneId, versione.rows[0]!.id],
  );
  await assert.rejects(() => pubblicaProposta(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('pubblicaProposta transiziona lo stato e trovaPropostaProvvisoria funziona dopo', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata')`,
    [stagioneId, versione.rows[0]!.id],
  );
  await pubblicaProposta(pool, stagioneId);
  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'concertazione');

  const voci = await trovaPropostaProvvisoria(pool, stagioneId);
  assert.deepEqual(voci, []); // nessuna assegnazione creata in questo test, solo verifica che non lanci più ErroreStatoNonValidoPerTransizione
});

test('trovaPropostaProvvisoria rifiuta se la proposta non è ancora pubblicata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const stagioneId = await creaStagione(pool, 'prima_assegnazione');
  await assert.rejects(() => trovaPropostaProvvisoria(pool, stagioneId), ErroreStatoNonValidoPerTransizione);
});

test('pubblicaProposta lancia ErroreNonTrovato su stagione inesistente', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  await assert.rejects(() => pubblicaProposta(pool, randomUUID()), ErroreNonTrovato);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/propostaProvvisoria.test.ts`
Expected: FAIL — `Cannot find module './propostaProvvisoria.ts'`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `backend-node/src/propostaProvvisoria.ts`:

```ts
import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

// art. B.23: la proposta provvisoria "esiste" solo dopo che il round-robin (Fase 8-9) ha
// prodotto un'elaborazione completata — nessuna scrittura su assegnazioni qui (sono già
// 'provvisoria' dal motore Go), solo la transizione di stato che la rende pubblica.
export async function pubblicaProposta(db: Db, stagioneId: string): Promise<void> {
  const elab = await db.query(
    `SELECT 1 FROM elaborazioni WHERE stagione_id = $1 AND tipo = 'prima_assegnazione' AND stato = 'completata' LIMIT 1`,
    [stagioneId],
  );
  if ((elab.rowCount ?? 0) === 0) {
    throw new ErroreStatoNonValidoPerTransizione('nessuna elaborazione di prima assegnazione completata per questa stagione');
  }
  const r = await db.query(
    `UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1 AND stato = 'prima_assegnazione' RETURNING id`,
    [stagioneId],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('stagione non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la stagione non è in stato prima_assegnazione');
  }
}

export interface VocePropostaProvvisoria {
  slotId: string;
  associazioneId: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
}

interface RigaVoceProposta {
  slot_id: string;
  associazione_id: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valore_minuti: string;
  fr_finale_minuti: string | null;
  isf: string | null;
  sorteggio_id: string | null;
  articolo_riferimento: string | null;
}

// Disponibile solo dopo la pubblicazione (B.23): 'concertazione' o 'definitiva' (quando il
// blocco 4/4 chiuderà la settimana tipo definitiva, questa vista resta comunque valida
// come consultazione storica).
const STATI_STAGIONE_CON_PROPOSTA = ['concertazione', 'definitiva'];

export async function trovaPropostaProvvisoria(db: Db, stagioneId: string): Promise<VocePropostaProvvisoria[]> {
  const stagione = await db.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  const riga = stagione.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('stagione non trovata');
  }
  if (!STATI_STAGIONE_CON_PROPOSTA.includes(riga.stato)) {
    throw new ErroreStatoNonValidoPerTransizione('la proposta provvisoria non è ancora stata pubblicata per questa stagione');
  }
  const r = await db.query<RigaVoceProposta>(
    `SELECT a.slot_id, a.associazione_id, a.tipo, a.valore_minuti::text AS valore_minuti,
            fr.fr_finale_minuti::text AS fr_finale_minuti, a.isf_al_momento::text AS isf,
            so.id AS sorteggio_id, so.articolo_riferimento
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = a.domanda_id
     LEFT JOIN sorteggi so ON so.elaborazione_id = a.elaborazione_id AND so.vincitore_associazione_id = a.associazione_id
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
     ORDER BY st.giorno_settimana, st.orario_inizio`,
    [stagioneId],
  );
  return r.rows.map((v) => ({
    slotId: v.slot_id,
    associazioneId: v.associazione_id,
    tipo: v.tipo,
    valoreMinutiAssegnato: v.valore_minuti,
    fabbisognoRiconosciutoMinuti: v.fr_finale_minuti,
    isf: v.isf,
    sorteggioRiferimento: v.sorteggio_id ? { sorteggioId: v.sorteggio_id, articoloRiferimento: v.articolo_riferimento! } : null,
  }));
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/propostaProvvisoria.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/propostaProvvisoria.ts backend-node/src/propostaProvvisoria.test.ts
git commit -m "feat(backend): pubblicazione e lettura proposta provvisoria (art. B.23)"
```

---

### Task 5: Repository — B.24-B.26 ciclo vita proposta (crea, lista, dettaglio, accetta, annulla)

**Files:**
- Create: `backend-node/src/concertazione.ts`
- Create: `backend-node/src/concertazione.test.ts`

**Interfaces:**
- Consumes: `Db`; `ErroreNonTrovato`, `ErroreStatoNonValidoPerTransizione`, `ErroreRiferimentoNonValido` da `./erroriDominio.ts`; `validaSlotAppartengonoAStagione` da `./domande.ts` (Task 2).
- Produces: `Proposta`, `TipoProposta`, `StatoProposta`, `DatiCreaProposta`; `creaProposta(db, dati, proponentePersonaFisicaId): Promise<Proposta>`; `trovaPropostaPerId(db, id): Promise<Proposta | null>`; `listaPropostePerAssociazione(db, associazioneId, stagioneId?): Promise<Proposta[]>`; `listaPropostePerStagioneBackoffice(db, stagioneId, stato?): Promise<Proposta[]>`; `accettaProposta(db, propostaId, associazioneId, personaFisicaId): Promise<Proposta>`; `annullaProposta(db, propostaId): Promise<Proposta>`. Consumati da Task 9 (route pubbliche).

- [ ] **Step 1: Scrivi il test per `creaProposta` (scambio bilaterale + utilizzo slot libero)**

Crea `backend-node/src/concertazione.test.ts` con la fixture e i primi test:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaProposta, trovaPropostaPerId, listaPropostePerAssociazione, accettaProposta, annullaProposta } from './concertazione.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreRiferimentoNonValido, ErroreStatoNonValidoPerTransizione, ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaAssociazionePersona(pool: Pool, label: string) {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [`TSTCRT${randomUUID().slice(0, 10).toUpperCase()}`, label, randomUUID()],
  );
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id };
}

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `TENNIS-${randomUUID().slice(0, 8)}`, denominazione: 'Tennis' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto concertazione ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra concertazione', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo unico', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-concertazione-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotB = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotLibero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaAssociazionePersona(pool, 'uno');
  const p2 = await creaAssociazionePersona(pool, 'due');

  const datiDomanda = {
    disciplineCodici: [disciplina.codice],
    numeroTesserati: 10,
    numeroAtletiPartecipanti: 8,
    numeroSquadre: 1,
    numeroSquadreFederaliStagionePrecedente: 0,
    attivitaGiovanile: true,
    attivitaAgonistica: false,
    attivitaParalimpicaInclusiva: false,
    fabbisognoMinimoMinuti: '60.000',
    fabbisognoOttimaleMinuti: '120.000',
    richiedeGiornataGara: false,
    richiesteGiornataGara: [],
  };
  const domanda1 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p1.associazioneId, stagioneId, preferenze: [slotA.id], blocchiAllenamento: [] }, p1.personaId);
  const domanda2 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p2.associazioneId, stagioneId, preferenze: [slotB.id], blocchiAllenamento: [] }, p2.personaId);
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = ANY($1)`, [[domanda1.id, domanda2.id]]);

  // assegnazione attiva: slotA a p1, slotB a p2 (simula esito del round-robin)
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotA.id, domanda1.id, p1.associazioneId],
  );
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotB.id, domanda2.id, p2.associazioneId],
  );

  return { stagioneId, slotAId: slotA.id, slotBId: slotB.id, slotLiberoId: slotLibero.id, ...p1, p1, p2 };
}

test('creaProposta scambio bilaterale nasce in_attesa_accettazione con entrambe le parti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const proposta = await creaProposta(
    pool,
    {
      stagioneId: fx.stagioneId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId },
        { slotId: fx.slotBId, associazioneCedenteId: fx.p2.associazioneId, associazioneRiceventeId: fx.p1.associazioneId },
      ],
    },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );

  assert.equal(proposta.stato, 'in_attesa_accettazione');
  assert.equal(proposta.parti.length, 2);
  assert.ok(proposta.parti.some((p) => p.associazioneId === fx.p1.associazioneId && p.accettatoIl !== null)); // proponente auto-accettante
  assert.ok(proposta.parti.some((p) => p.associazioneId === fx.p2.associazioneId && p.accettatoIl === null));
});

test('creaProposta utilizzo_slot_libero con parte singola nasce già accettata_da_tutti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const proposta = await creaProposta(
    pool,
    {
      stagioneId: fx.stagioneId,
      tipo: 'utilizzo_slot_libero',
      slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }],
    },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );

  assert.equal(proposta.stato, 'accettata_da_tutti');
  assert.equal(proposta.parti.length, 1);
});

test('creaProposta rifiuta slot fuori stagione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await assert.rejects(
    () =>
      creaProposta(
        pool,
        { stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: randomUUID(), associazioneRiceventeId: fx.p1.associazioneId }] },
        fx.p1.personaId,
        fx.p1.associazioneId,
      ),
    ErroreRiferimentoNonValido,
  );
});

test('accettaProposta: seconda parte accetta -> accettata_da_tutti; annullaProposta funziona prima della validazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const proposta = await creaProposta(
    pool,
    {
      stagioneId: fx.stagioneId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId },
        { slotId: fx.slotBId, associazioneCedenteId: fx.p2.associazioneId, associazioneRiceventeId: fx.p1.associazioneId },
      ],
    },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );

  const accettata = await accettaProposta(pool, proposta.id, fx.p2.associazioneId, fx.p2.personaId);
  assert.equal(accettata.stato, 'accettata_da_tutti');

  await assert.rejects(() => accettaProposta(pool, proposta.id, fx.p2.associazioneId, fx.p2.personaId), ErroreStatoNonValidoPerTransizione);

  const annullata = await annullaProposta(pool, proposta.id);
  assert.equal(annullata.stato, 'annullata');
});

test('trovaPropostaPerId ritorna null su id inesistente, listaPropostePerAssociazione trova la propria', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  assert.equal(await trovaPropostaPerId(pool, randomUUID()), null);

  await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }] },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  const lista = await listaPropostePerAssociazione(pool, fx.p1.associazioneId, fx.stagioneId);
  assert.equal(lista.length, 1);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/concertazione.test.ts`
Expected: FAIL — `Cannot find module './concertazione.ts'`.

- [ ] **Step 3: Scrivi l'implementazione (parte 1: tipi + creaProposta + letture + accetta + annulla)**

Crea `backend-node/src/concertazione.ts`:

```ts
import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione, ErroreRiferimentoNonValido } from './erroriDominio.ts';
import { validaSlotAppartengonoAStagione } from './domande.ts';

export type TipoProposta =
  | 'scambio_bilaterale'
  | 'scambio_multilaterale'
  | 'cessione'
  | 'utilizzo_slot_libero'
  | 'accorpamento'
  | 'ampliamento';

export type StatoProposta = 'in_attesa_accettazione' | 'accettata_da_tutti' | 'validata' | 'rigettata' | 'annullata';

export interface ParteProposta {
  associazioneId: string;
  accettatoIl: string | null;
  accettatoDaPersonaFisicaId: string | null;
}

export interface SlotProposta {
  slotId: string;
  associazioneCedenteId: string | null;
  associazioneRiceventeId: string;
}

export interface Proposta {
  id: string;
  stagioneId: string;
  tipo: TipoProposta;
  proponentePersonaFisicaId: string;
  proponenteAssociazioneId: string;
  stato: StatoProposta;
  versione: number;
  motivazioneRigetto: string | null;
  creataIl: string;
  validataIl: string | null;
  validataDa: string | null;
  parti: ParteProposta[];
  slot: SlotProposta[];
}

interface RigaProposta {
  id: string;
  stagione_id: string;
  tipo: TipoProposta;
  proponente_persona_fisica_id: string;
  proponente_associazione_id: string;
  stato: StatoProposta;
  versione: number;
  motivazione_rigetto: string | null;
  creata_il: Date;
  validata_il: Date | null;
  validata_da: string | null;
}

const COLONNE_PROPOSTA = `id, stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id,
  stato, versione, motivazione_rigetto, creata_il, validata_il, validata_da`;

async function caricaPartiESlot(db: Db, propostaId: string): Promise<{ parti: ParteProposta[]; slot: SlotProposta[] }> {
  const parti = await db.query<{ associazione_id: string; accettato_il: Date | null; accettato_da_persona_fisica_id: string | null }>(
    `SELECT associazione_id, accettato_il, accettato_da_persona_fisica_id FROM concertazione_proposta_parti WHERE proposta_id = $1 ORDER BY associazione_id`,
    [propostaId],
  );
  const slot = await db.query<{ slot_id: string; associazione_cedente_id: string | null; associazione_ricevente_id: string }>(
    `SELECT slot_id, associazione_cedente_id, associazione_ricevente_id FROM concertazione_proposta_slot WHERE proposta_id = $1 ORDER BY slot_id`,
    [propostaId],
  );
  return {
    parti: parti.rows.map((r) => ({
      associazioneId: r.associazione_id,
      accettatoIl: r.accettato_il ? r.accettato_il.toISOString() : null,
      accettatoDaPersonaFisicaId: r.accettato_da_persona_fisica_id,
    })),
    slot: slot.rows.map((r) => ({ slotId: r.slot_id, associazioneCedenteId: r.associazione_cedente_id, associazioneRiceventeId: r.associazione_ricevente_id })),
  };
}

function assembla(r: RigaProposta, correlati: { parti: ParteProposta[]; slot: SlotProposta[] }): Proposta {
  return {
    id: r.id,
    stagioneId: r.stagione_id,
    tipo: r.tipo,
    proponentePersonaFisicaId: r.proponente_persona_fisica_id,
    proponenteAssociazioneId: r.proponente_associazione_id,
    stato: r.stato,
    versione: r.versione,
    motivazioneRigetto: r.motivazione_rigetto,
    creataIl: r.creata_il.toISOString(),
    validataIl: r.validata_il ? r.validata_il.toISOString() : null,
    validataDa: r.validata_da,
    ...correlati,
  };
}

export interface DatiCreaProposta {
  stagioneId: string;
  tipo: TipoProposta;
  slot: { slotId: string; associazioneCedenteId?: string | undefined; associazioneRiceventeId: string }[];
}

async function domandaAmmessaId(db: Db, associazioneId: string, stagioneId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM domande WHERE associazione_id = $1 AND stagione_id = $2 AND stato = 'ammessa'`,
    [associazioneId, stagioneId],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreRiferimentoNonValido('l\'associazione non ha una domanda ammessa per questa stagione');
  }
  return riga.id;
}

export async function creaProposta(
  db: Db,
  dati: DatiCreaProposta,
  proponentePersonaFisicaId: string,
  proponenteAssociazioneId: string,
): Promise<Proposta> {
  await validaSlotAppartengonoAStagione(db, dati.stagioneId, dati.slot.map((s) => s.slotId));

  const associazioniCoinvolte = [
    ...new Set(dati.slot.flatMap((s) => [s.associazioneCedenteId, s.associazioneRiceventeId].filter((x): x is string => x != null))),
  ];
  for (const associazioneId of associazioniCoinvolte) {
    await domandaAmmessaId(db, associazioneId, dati.stagioneId);
  }

  const statoIniziale: StatoProposta = associazioniCoinvolte.length <= 1 ? 'accettata_da_tutti' : 'in_attesa_accettazione';

  const r = await db.query<RigaProposta>(
    `INSERT INTO concertazione_proposte (stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id, stato)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLONNE_PROPOSTA}`,
    [dati.stagioneId, dati.tipo, proponentePersonaFisicaId, proponenteAssociazioneId, statoIniziale],
  );
  const riga = r.rows[0]!;

  for (const associazioneId of associazioniCoinvolte) {
    // Il proponente stesso è già "accettante" nel momento in cui crea la proposta (B.26
    // parla di accettazione delle "altre" parti coinvolte): valorizza subito accettato_il
    // per l'associazione del proponente, lascia NULL per le altre.
    const giaAccettante = associazioneId === proponenteAssociazioneId;
    await db.query(
      `INSERT INTO concertazione_proposta_parti (proposta_id, associazione_id, accettato_il, accettato_da_persona_fisica_id)
       VALUES ($1, $2, $3, $4)`,
      [riga.id, associazioneId, giaAccettante ? new Date() : null, giaAccettante ? proponentePersonaFisicaId : null],
    );
  }
  for (const s of dati.slot) {
    await db.query(
      `INSERT INTO concertazione_proposta_slot (proposta_id, slot_id, associazione_cedente_id, associazione_ricevente_id)
       VALUES ($1, $2, $3, $4)`,
      [riga.id, s.slotId, s.associazioneCedenteId ?? null, s.associazioneRiceventeId],
    );
  }

  const correlati = await caricaPartiESlot(db, riga.id);
  return assembla(riga, correlati);
}

export async function trovaPropostaPerId(db: Db, id: string): Promise<Proposta | null> {
  const r = await db.query<RigaProposta>(`SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte WHERE id = $1`, [id]);
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return assembla(riga, await caricaPartiESlot(db, riga.id));
}

export async function listaPropostePerAssociazione(db: Db, associazioneId: string, stagioneId?: string): Promise<Proposta[]> {
  const r = stagioneId
    ? await db.query<RigaProposta>(
        `SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte p
         WHERE p.stagione_id = $2 AND EXISTS (SELECT 1 FROM concertazione_proposta_parti pp WHERE pp.proposta_id = p.id AND pp.associazione_id = $1)
         ORDER BY p.creata_il DESC`,
        [associazioneId, stagioneId],
      )
    : await db.query<RigaProposta>(
        `SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte p
         WHERE EXISTS (SELECT 1 FROM concertazione_proposta_parti pp WHERE pp.proposta_id = p.id AND pp.associazione_id = $1)
         ORDER BY p.creata_il DESC`,
        [associazioneId],
      );
  const risultato: Proposta[] = [];
  for (const riga of r.rows) {
    risultato.push(assembla(riga, await caricaPartiESlot(db, riga.id)));
  }
  return risultato;
}

export async function listaPropostePerStagioneBackoffice(db: Db, stagioneId: string, stato?: StatoProposta): Promise<Proposta[]> {
  const r = stato
    ? await db.query<RigaProposta>(
        `SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte WHERE stagione_id = $1 AND stato = $2 ORDER BY creata_il ASC`,
        [stagioneId, stato],
      )
    : await db.query<RigaProposta>(
        `SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte WHERE stagione_id = $1 ORDER BY creata_il ASC`,
        [stagioneId],
      );
  const risultato: Proposta[] = [];
  for (const riga of r.rows) {
    risultato.push(assembla(riga, await caricaPartiESlot(db, riga.id)));
  }
  return risultato;
}

// Lock esplicito FOR UPDATE sulla proposta: serializza gli accept concorrenti sulla stessa
// proposta (una seconda chiamata attende il rilascio del lock a COMMIT/ROLLBACK della
// prima, poi rilegge lo stato aggiornato) — la colonna versione resta solo un marker
// informativo incrementato ad ogni transizione, non serve un WHERE versione=$ perché il
// lock FOR UPDATE già esclude la race.
export async function accettaProposta(db: Db, propostaId: string, associazioneId: string, personaFisicaId: string): Promise<Proposta> {
  const lock = await db.query<{ stato: StatoProposta }>(
    `SELECT stato FROM concertazione_proposte WHERE id = $1 FOR UPDATE`,
    [propostaId],
  );
  const propostaRiga = lock.rows[0];
  if (!propostaRiga) {
    throw new ErroreNonTrovato('proposta non trovata');
  }
  if (propostaRiga.stato !== 'in_attesa_accettazione') {
    throw new ErroreStatoNonValidoPerTransizione('la proposta non è in attesa di accettazione');
  }
  const parte = await db.query<{ accettato_il: Date | null }>(
    `SELECT accettato_il FROM concertazione_proposta_parti WHERE proposta_id = $1 AND associazione_id = $2`,
    [propostaId, associazioneId],
  );
  const parteRiga = parte.rows[0];
  if (!parteRiga) {
    throw new ErroreNonTrovato('questa associazione non è parte della proposta');
  }
  if (parteRiga.accettato_il !== null) {
    throw new ErroreStatoNonValidoPerTransizione('questa associazione ha già accettato la proposta');
  }
  await db.query(
    `UPDATE concertazione_proposta_parti SET accettato_il = now(), accettato_da_persona_fisica_id = $3
     WHERE proposta_id = $1 AND associazione_id = $2`,
    [propostaId, associazioneId, personaFisicaId],
  );
  const restanti = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM concertazione_proposta_parti WHERE proposta_id = $1 AND accettato_il IS NULL`,
    [propostaId],
  );
  if (restanti.rows[0]?.count === '0') {
    await db.query(`UPDATE concertazione_proposte SET stato = 'accettata_da_tutti', versione = versione + 1 WHERE id = $1`, [propostaId]);
  }
  return (await trovaPropostaPerId(db, propostaId))!;
}

export async function annullaProposta(db: Db, propostaId: string): Promise<Proposta> {
  const r = await db.query<{ id: string }>(
    `UPDATE concertazione_proposte SET stato = 'annullata'
     WHERE id = $1 AND stato IN ('in_attesa_accettazione', 'accettata_da_tutti')
     RETURNING id`,
    [propostaId],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM concertazione_proposte WHERE id = $1`, [propostaId]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('proposta non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la proposta non è più annullabile (già validata/rigettata/annullata)');
  }
  return (await trovaPropostaPerId(db, propostaId))!;
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/concertazione.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/concertazione.ts backend-node/src/concertazione.test.ts
git commit -m "feat(backend): proposte di concertazione — crea/lista/dettaglio/accetta/annulla (art. B.24-B.26)"
```

---

### Task 6: Repository — controlli strutturali B.27 (funzioni pure, esportate per test isolati)

**Files:**
- Modify: `backend-node/src/concertazione.ts` (aggiunge funzioni, non tocca quelle di Task 5)
- Modify: `backend-node/src/concertazione.test.ts` (aggiunge test)

**Interfaces:**
- Consumes: `leggiVersioneAttiva` da `./repository/parametrico.ts` (già esistente).
- Produces: `interface EsitoControllo { ok: boolean; motivo?: string }`; `controlloAssegnazioneAttivaAttesa(db, slotId, cedenteAtteso: string | null): Promise<EsitoControllo>`; `controlloDisciplinaCompatibile(db, slotId, riceventeAssociazioneId, stagioneId): Promise<EsitoControllo>`; `controlloLimitiConcentrazione(db, stagioneId, associazioneId, slotIdCeduti: string[], slotIdRicevuti: string[]): Promise<EsitoControllo>`. Consumati da Task 7 (`validaProposta`).

- [ ] **Step 1: Scrivi i test per i tre controlli**

Aggiungi in fondo a `backend-node/src/concertazione.test.ts` (riusa `creaFixture` già definita nel file):

```ts
import { controlloAssegnazioneAttivaAttesa, controlloDisciplinaCompatibile, controlloLimitiConcentrazione } from './concertazione.ts';

test('controlloAssegnazioneAttivaAttesa: ok se il cedente atteso corrisponde', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const esito = await controlloAssegnazioneAttivaAttesa(pool, fx.slotAId, fx.p1.associazioneId);
  assert.equal(esito.ok, true);
});

test('controlloAssegnazioneAttivaAttesa: fallisce se il cedente non corrisponde più', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const esito = await controlloAssegnazioneAttivaAttesa(pool, fx.slotAId, fx.p2.associazioneId);
  assert.equal(esito.ok, false);
});

test('controlloAssegnazioneAttivaAttesa: fallisce su blocco gara', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await pool.query(`UPDATE assegnazioni SET tipo = 'blocco_gara' WHERE slot_id = $1`, [fx.slotAId]);
  const esito = await controlloAssegnazioneAttivaAttesa(pool, fx.slotAId, fx.p1.associazioneId);
  assert.equal(esito.ok, false);
  assert.match(esito.motivo ?? '', /blocco gara/);
});

test('controlloAssegnazioneAttivaAttesa: utilizzo_slot_libero ok solo se slot davvero libero', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  assert.equal((await controlloAssegnazioneAttivaAttesa(pool, fx.slotLiberoId, null)).ok, true);
  assert.equal((await controlloAssegnazioneAttivaAttesa(pool, fx.slotAId, null)).ok, false);
});

test('controlloDisciplinaCompatibile: fallisce se il ricevente non ha domanda con disciplina compatibile', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const altra = await creaAssociazionePersona(pool, 'senza-domanda');
  const esito = await controlloDisciplinaCompatibile(pool, fx.slotAId, altra.associazioneId, fx.stagioneId);
  assert.equal(esito.ok, false);
});

test('controlloDisciplinaCompatibile: ok se compatibile', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const esito = await controlloDisciplinaCompatibile(pool, fx.slotAId, fx.p2.associazioneId, fx.stagioneId);
  assert.equal(esito.ok, true);
});

test('controlloLimitiConcentrazione: ok entro i limiti di default (600 min settimanali)', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const esito = await controlloLimitiConcentrazione(pool, fx.stagioneId, fx.p1.associazioneId, [], [fx.slotBId]);
  assert.equal(esito.ok, true);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/concertazione.test.ts`
Expected: FAIL — le tre funzioni non esistono ancora.

- [ ] **Step 3: Scrivi l'implementazione**

Aggiungi in fondo a `backend-node/src/concertazione.ts`:

```ts
import { leggiVersioneAttiva } from './repository/parametrico.ts';

export interface EsitoControllo {
  ok: boolean;
  motivo?: string;
}

// art. B.27 "non comprometta i blocchi gara assegnati" + "non generi sovrapposizioni": lo
// stato attivo del slot deve corrispondere esattamente a quanto la proposta si aspettava
// al momento della creazione — se nel frattempo un'altra proposta validata ha già spostato
// lo slot, questa non è più applicabile. Un blocco_gara non è MAI cedibile qui.
export async function controlloAssegnazioneAttivaAttesa(db: Db, slotId: string, cedenteAtteso: string | null): Promise<EsitoControllo> {
  const r = await db.query<{ associazione_id: string; tipo: string }>(
    `SELECT associazione_id, tipo FROM assegnazioni WHERE slot_id = $1 AND stato IN ('provvisoria', 'validata')`,
    [slotId],
  );
  const attiva = r.rows[0] ?? null;
  if (cedenteAtteso === null) {
    return attiva ? { ok: false, motivo: `slot ${slotId} non è più libero` } : { ok: true };
  }
  if (!attiva) {
    return { ok: false, motivo: `slot ${slotId} non ha più un'assegnazione attiva da cedere` };
  }
  if (attiva.tipo === 'blocco_gara') {
    return { ok: false, motivo: `slot ${slotId} è un blocco gara, non cedibile in concertazione` };
  }
  if (attiva.associazione_id !== cedenteAtteso) {
    return { ok: false, motivo: `slot ${slotId} non è più assegnato all'associazione cedente attesa` };
  }
  return { ok: true };
}

// art. B.27 "sia compatibile con la disciplina praticata": il ricevente deve avere una
// domanda ammessa la cui disciplina compare tra quelle compatibili con lo spazio dello
// slot. L'omologazione (altro punto B.27) riguarda solo le giornate gara
// (richieste_giornata_gara.necessita_impianto_omologato) — i blocchi gara sono già esclusi
// dal controllo sopra, quindi qui non si applica (assunzione documentata nello spec).
export async function controlloDisciplinaCompatibile(db: Db, slotId: string, riceventeAssociazioneId: string, stagioneId: string): Promise<EsitoControllo> {
  const r = await db.query(
    `SELECT 1
     FROM slot_settimana_tipo s
     JOIN spazio_disciplina_compatibile sdc ON sdc.spazio_id = s.spazio_id
     JOIN domanda_discipline dd ON dd.disciplina_codice = sdc.disciplina_codice
     JOIN domande d ON d.id = dd.domanda_id
     WHERE s.id = $1 AND d.associazione_id = $2 AND d.stagione_id = $3 AND d.stato = 'ammessa'`,
    [slotId, riceventeAssociazioneId, stagioneId],
  );
  if ((r.rowCount ?? 0) === 0) {
    return { ok: false, motivo: `nessuna disciplina compatibile tra lo spazio dello slot ${slotId} e la domanda del ricevente` };
  }
  return { ok: true };
}

interface RigaCarico {
  slot_id: string;
  impianto_id: string;
  durata_minuti: number;
  pregiata: boolean;
}

// art. B.19 (richiamato da B.27): minuti settimanali max, slot max stesso impianto, fasce
// pregiate max, verificati sul carico PROIETTATO del ricevente — le assegnazioni attive
// attuali, meno quelle che la stessa proposta gli fa cedere, più quelle che riceve.
export async function controlloLimitiConcentrazione(
  db: Db,
  stagioneId: string,
  associazioneId: string,
  slotIdCeduti: string[],
  slotIdRicevuti: string[],
): Promise<EsitoControllo> {
  const attuali = await db.query<RigaCarico>(
    `SELECT a.slot_id, sp.impianto_id, s.durata_minuti, s.pregiata
     FROM assegnazioni a
     JOIN slot_settimana_tipo s ON s.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = s.spazio_id
     WHERE a.associazione_id = $1 AND a.stato IN ('provvisoria', 'validata') AND s.stagione_id = $2`,
    [associazioneId, stagioneId],
  );
  const cedutiSet = new Set(slotIdCeduti);
  const righeDopoCessioni = attuali.rows.filter((r) => !cedutiSet.has(r.slot_id));

  const ricevuti = slotIdRicevuti.length
    ? await db.query<RigaCarico>(
        `SELECT s.id AS slot_id, sp.impianto_id, s.durata_minuti, s.pregiata
         FROM slot_settimana_tipo s JOIN spazi_sportivi sp ON sp.id = s.spazio_id
         WHERE s.id = ANY($1)`,
        [slotIdRicevuti],
      )
    : { rows: [] as RigaCarico[] };

  const righeFinali = [...righeDopoCessioni, ...ricevuti.rows];
  const minutiTotali = righeFinali.reduce((tot, r) => tot + r.durata_minuti, 0);
  const fascePregiateCount = righeFinali.filter((r) => r.pregiata).length;
  const perImpianto = new Map<string, number>();
  for (const r of righeFinali) {
    perImpianto.set(r.impianto_id, (perImpianto.get(r.impianto_id) ?? 0) + 1);
  }

  const parametrico = await leggiVersioneAttiva(db);
  if (minutiTotali > Number(parametrico.minutiSettimanaliMax)) {
    return { ok: false, motivo: `il ricevente supererebbe i minuti settimanali massimi (${parametrico.minutiSettimanaliMax})` };
  }
  if (fascePregiateCount > parametrico.fascePregiateMax) {
    return { ok: false, motivo: `il ricevente supererebbe le fasce pregiate massime (${parametrico.fascePregiateMax})` };
  }
  for (const [, count] of perImpianto) {
    if (count > parametrico.slotMaxStessoImpianto) {
      return { ok: false, motivo: `il ricevente supererebbe gli slot massimi nello stesso impianto (${parametrico.slotMaxStessoImpianto})` };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/concertazione.test.ts`
Expected: PASS (tutti i test del file, inclusi quelli del Task 5).

- [ ] **Step 5: Commit**

```bash
git add backend-node/src/concertazione.ts backend-node/src/concertazione.test.ts
git commit -m "feat(backend): controlli strutturali di validazione per la concertazione (art. B.27)"
```

---

### Task 7: Repository — `validaProposta` (FIFO + lock + applicazione) e `rigettaProposta`

**Files:**
- Modify: `backend-node/src/concertazione.ts`
- Modify: `backend-node/src/concertazione.test.ts`

**Interfaces:**
- Consumes: `controlloAssegnazioneAttivaAttesa`, `controlloDisciplinaCompatibile`, `controlloLimitiConcentrazione` (Task 6); `domandaAmmessaId` (privata, già definita in Task 5).
- Produces: `interface EsitoValidazione { esito: 'validata' | 'rigettata'; motivazione?: string; proposta: Proposta }`; `validaProposta(db: Db, propostaId: string, validataDa: string): Promise<EsitoValidazione>`; `rigettaProposta(db: Db, propostaId: string, motivazione: string): Promise<Proposta>`. Consumati da Task 10 (route backoffice).

- [ ] **Step 1: Scrivi i test — scambio bilaterale valido, FIFO, rigetto per disciplina, rigetto manuale**

Aggiungi in fondo a `backend-node/src/concertazione.test.ts`:

```ts
import { validaProposta, rigettaProposta } from './concertazione.ts';

async function propostaAccettata(pool: Pool, fx: Awaited<ReturnType<typeof creaFixture>>) {
  const proposta = await creaProposta(
    pool,
    {
      stagioneId: fx.stagioneId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId },
        { slotId: fx.slotBId, associazioneCedenteId: fx.p2.associazioneId, associazioneRiceventeId: fx.p1.associazioneId },
      ],
    },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  return accettaProposta(pool, proposta.id, fx.p2.associazioneId, fx.p2.personaId);
}

test('validaProposta: scambio bilaterale valido applica le assegnazioni e collega concertazione_proposta_id', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const proposta = await propostaAccettata(pool, fx);
  const admin = randomUUID(); // solo per il campo validata_da, nessuna FK di dominio verificata qui

  const esito = await validaProposta(pool, proposta.id, admin);
  assert.equal(esito.esito, 'validata');

  const slotA = await pool.query<{ associazione_id: string; stato: string; concertazione_proposta_id: string | null }>(
    `SELECT associazione_id, stato, concertazione_proposta_id FROM assegnazioni WHERE slot_id = $1 AND stato = 'validata'`,
    [fx.slotAId],
  );
  assert.equal(slotA.rows[0]?.associazione_id, fx.p2.associazioneId);
  assert.equal(slotA.rows[0]?.concertazione_proposta_id, proposta.id);

  const slotAVecchia = await pool.query(`SELECT stato FROM assegnazioni WHERE slot_id = $1 AND associazione_id = $2`, [fx.slotAId, fx.p1.associazioneId]);
  assert.equal(slotAVecchia.rows[0]?.stato, 'sostituita');
});

test('validaProposta: rigetto automatico se il ricevente non ha disciplina compatibile', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  // p2 cede slotB a un'associazione con domanda ammessa ma disciplina diversa: creiamo una
  // terza associazione con domanda su una disciplina incompatibile con lo spazio.
  const disciplinaAltra = await creaDisciplina(pool, { codice: `NUOTO-${randomUUID().slice(0, 8)}`, denominazione: 'Nuoto' });
  const p3 = await creaAssociazionePersona(pool, 'tre');
  await creaDomanda(
    pool,
    {
      associazioneId: p3.associazioneId,
      stagioneId: fx.stagioneId,
      disciplineCodici: [disciplinaAltra.codice],
      numeroTesserati: 5,
      numeroAtletiPartecipanti: 5,
      numeroSquadre: 1,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000',
      fabbisognoOttimaleMinuti: '60.000',
      preferenze: [fx.slotLiberoId],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    p3.personaId,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE associazione_id = $1`, [p3.associazioneId]);

  const proposta = await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: p3.associazioneId }] },
    p3.personaId,
    p3.associazioneId,
  );
  // slotLibero è compatibile solo con la disciplina della fixture (Tennis), non con Nuoto
  const esito = await validaProposta(pool, proposta.id, randomUUID());
  assert.equal(esito.esito, 'rigettata');
  assert.match(esito.motivazione ?? '', /disciplina/);
});

test('validaProposta: blocca con FIFO se esiste una proposta più vecchia sullo stesso slot non ancora decisa', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const propostaVecchia = await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'cessione', slot: [{ slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId }] },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  await accettaProposta(pool, propostaVecchia.id, fx.p2.associazioneId, fx.p2.personaId);

  // una seconda proposta creata DOPO, sullo stesso slotA
  const propostaNuova = await creaProposta(
    pool,
    { stagioneId: fx.stagioneId, tipo: 'cessione', slot: [{ slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId }] },
    fx.p1.personaId,
    fx.p1.associazioneId,
  );
  await accettaProposta(pool, propostaNuova.id, fx.p2.associazioneId, fx.p2.personaId);

  await assert.rejects(() => validaProposta(pool, propostaNuova.id, randomUUID()), /precedente/);
  // la più vecchia invece deve poter essere validata
  const esito = await validaProposta(pool, propostaVecchia.id, randomUUID());
  assert.equal(esito.esito, 'validata');
});

test('rigettaProposta: rigetto manuale su proposta accettata_da_tutti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const proposta = await propostaAccettata(pool, fx);
  const rigettata = await rigettaProposta(pool, proposta.id, 'motivo discrezionale di test');
  assert.equal(rigettata.stato, 'rigettata');
  assert.equal(rigettata.motivazioneRigetto, 'motivo discrezionale di test');
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/concertazione.test.ts`
Expected: FAIL — `validaProposta`/`rigettaProposta` non esistono.

- [ ] **Step 3: Scrivi l'implementazione**

Aggiungi in fondo a `backend-node/src/concertazione.ts`:

```ts
import { ErroreConflittoFifoConcertazione } from './erroriDominio.ts';

export interface EsitoValidazione {
  esito: 'validata' | 'rigettata';
  motivazione?: string;
  proposta: Proposta;
}

// art. B.27-B.28. Tutto in un'unica transazione implicita (il chiamante passa `db` che è
// già dentro eseguiInTransazione lato server.ts): lock FOR UPDATE sulla proposta, guardia
// FIFO, advisory lock per slot (ordine canonico ASC, evita deadlock tra validazioni
// concorrenti su slot in comune), controlli strutturali, applicazione o rigetto.
export async function validaProposta(db: Db, propostaId: string, validataDa: string): Promise<EsitoValidazione> {
  const lock = await db.query<{ stagione_id: string; stato: StatoProposta; creata_il: Date }>(
    `SELECT stagione_id, stato, creata_il FROM concertazione_proposte WHERE id = $1 FOR UPDATE`,
    [propostaId],
  );
  const propostaRiga = lock.rows[0];
  if (!propostaRiga) {
    throw new ErroreNonTrovato('proposta non trovata');
  }
  if (propostaRiga.stato !== 'accettata_da_tutti') {
    throw new ErroreStatoNonValidoPerTransizione('la proposta non è accettata da tutte le parti');
  }

  const slotProposta = await db.query<{ slot_id: string; associazione_cedente_id: string | null; associazione_ricevente_id: string }>(
    `SELECT slot_id, associazione_cedente_id, associazione_ricevente_id FROM concertazione_proposta_slot WHERE proposta_id = $1 ORDER BY slot_id`,
    [propostaId],
  );
  const slotIds = slotProposta.rows.map((r) => r.slot_id);

  const conflitto = await db.query(
    `SELECT 1 FROM concertazione_proposte p
     JOIN concertazione_proposta_slot s ON s.proposta_id = p.id
     WHERE p.id <> $1 AND p.stato = 'accettata_da_tutti' AND p.creata_il < $2 AND s.slot_id = ANY($3)
     LIMIT 1`,
    [propostaId, propostaRiga.creata_il, slotIds],
  );
  if ((conflitto.rowCount ?? 0) > 0) {
    throw new ErroreConflittoFifoConcertazione('esiste una proposta precedente da validare prima su questi slot');
  }

  // Advisory lock per ogni slot coinvolto, ordine canonico ASC (evita deadlock tra
  // validazioni concorrenti su slot in comune tra proposte diverse).
  for (const slotId of [...slotIds].sort()) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [slotId]);
  }

  for (const riga of slotProposta.rows) {
    const controlloAttiva = await controlloAssegnazioneAttivaAttesa(db, riga.slot_id, riga.associazione_cedente_id);
    if (!controlloAttiva.ok) {
      return await applicaRigetto(db, propostaId, controlloAttiva.motivo!);
    }
    const controlloDisciplina = await controlloDisciplinaCompatibile(db, riga.slot_id, riga.associazione_ricevente_id, propostaRiga.stagione_id);
    if (!controlloDisciplina.ok) {
      return await applicaRigetto(db, propostaId, controlloDisciplina.motivo!);
    }
  }

  const riceventi = [...new Set(slotProposta.rows.map((r) => r.associazione_ricevente_id))];
  for (const riceventeId of riceventi) {
    const ceduti = slotProposta.rows.filter((r) => r.associazione_cedente_id === riceventeId).map((r) => r.slot_id);
    const ricevuti = slotProposta.rows.filter((r) => r.associazione_ricevente_id === riceventeId).map((r) => r.slot_id);
    const controlloLimiti = await controlloLimitiConcentrazione(db, propostaRiga.stagione_id, riceventeId, ceduti, ricevuti);
    if (!controlloLimiti.ok) {
      return await applicaRigetto(db, propostaId, controlloLimiti.motivo!);
    }
  }

  for (const riga of slotProposta.rows) {
    if (riga.associazione_cedente_id) {
      await db.query(
        `UPDATE assegnazioni SET stato = 'sostituita', decaduta_il = now(), decaduta_motivazione = $2
         WHERE slot_id = $1 AND associazione_id = $3 AND stato IN ('provvisoria', 'validata')`,
        [riga.slot_id, `concertazione: proposta ${propostaId}`, riga.associazione_cedente_id],
      );
    }
    const domandaId = await domandaAmmessaId(db, riga.associazione_ricevente_id, propostaRiga.stagione_id);
    const durata = await db.query<{ durata_minuti: number }>(`SELECT durata_minuti FROM slot_settimana_tipo WHERE id = $1`, [riga.slot_id]);
    await db.query(
      `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato, concertazione_proposta_id)
       VALUES ($1, $2, $3, 'singola', $4, 'validata', $5)`,
      [riga.slot_id, domandaId, riga.associazione_ricevente_id, durata.rows[0]!.durata_minuti, propostaId],
    );
  }

  await db.query(
    `UPDATE concertazione_proposte SET stato = 'validata', validata_il = now(), validata_da = $2, versione = versione + 1 WHERE id = $1`,
    [propostaId, validataDa],
  );
  return { esito: 'validata', proposta: (await trovaPropostaPerId(db, propostaId))! };
}

async function applicaRigetto(db: Db, propostaId: string, motivazione: string): Promise<EsitoValidazione> {
  await db.query(
    `UPDATE concertazione_proposte SET stato = 'rigettata', motivazione_rigetto = $2, versione = versione + 1 WHERE id = $1`,
    [propostaId, motivazione],
  );
  return { esito: 'rigettata', motivazione, proposta: (await trovaPropostaPerId(db, propostaId))! };
}

// art. B.28: rigetto discrezionale manuale, disponibile in alternativa alla validazione
// automatica (es. per motivi non modellabili nei controlli strutturali di validaProposta).
export async function rigettaProposta(db: Db, propostaId: string, motivazione: string): Promise<Proposta> {
  const r = await db.query<{ id: string }>(
    `UPDATE concertazione_proposte SET stato = 'rigettata', motivazione_rigetto = $2, versione = versione + 1
     WHERE id = $1 AND stato = 'accettata_da_tutti'
     RETURNING id`,
    [propostaId, motivazione],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM concertazione_proposte WHERE id = $1`, [propostaId]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('proposta non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la proposta non è accettata da tutte le parti');
  }
  return (await trovaPropostaPerId(db, propostaId))!;
}
```

Nota: sposta l'`import { ErroreConflittoFifoConcertazione } from './erroriDominio.ts';` in cima al file insieme agli altri import da `./erroriDominio.ts` (unisci in un solo import multiplo), invece di lasciarlo come import isolato in mezzo al file.

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/concertazione.test.ts`
Expected: PASS (tutti i test del file).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/concertazione.ts backend-node/src/concertazione.test.ts
git commit -m "feat(backend): validazione (FIFO + lock + applicazione) e rigetto manuale delle proposte di concertazione (art. B.27-B.28)"
```

---

### Task 8: Route — pubblicazione e lettura proposta provvisoria (B.23)

**Files:**
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.concertazione.publish.test.ts`

**Interfaces:**
- Consumes: `pubblicaProposta`, `trovaPropostaProvvisoria` da `./propostaProvvisoria.ts` (Task 4).
- Produces: `POST /backoffice/stagioni/:id/pubblica-proposta`, `GET /pubblico/stagioni/:id/proposta`.

- [ ] **Step 1: Scrivi il test HTTP**

Crea `backend-node/src/server.concertazione.publish.test.ts` seguendo il pattern di `server.domande.test.ts` (harness `avviaServerTest`, `creaPersonaFisicaTest`, `creaUtenteBackofficeTest`, fixture con `creaDisciplina`/`creaIstituzione`/`creaImpianto`/`creaSpazio`/`creaSlot` — copia le stesse funzioni helper di `server.domande.test.ts` in cima al nuovo file, adattando i prefissi random):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaUtenteAdminTest(pool: Pool) {
  const email = `concert-publish-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' });
}

async function creaStagioneConElaborazione(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'prima_assegnazione') RETURNING id`,
    [`stagione-publish-http-${randomUUID()}`],
  );
  const stagioneId = r.rows[0]!.id;
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata')`,
    [stagioneId, versione.rows[0]!.id],
  );
  return stagioneId;
}

test('POST /backoffice/stagioni/:id/pubblica-proposta poi GET /pubblico/stagioni/:id/proposta', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const stagioneId = await creaStagioneConElaborazione(pool);
  const tokenAdmin = await creaUtenteAdminTest(pool);

  const rPre = await fetch(`${base}/pubblico/stagioni/${stagioneId}/proposta`);
  assert.equal(rPre.status, 401); // nessun token pubblico: verifica solo che la route esista e richieda auth

  const rPubblica = await fetch(`${base}/backoffice/stagioni/${stagioneId}/pubblica-proposta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(rPubblica.status, 200);

  const stato = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
  assert.equal(stato.rows[0]!.stato, 'concertazione');
});

test('POST /backoffice/stagioni/:id/pubblica-proposta risponde 409 se già pubblicata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const stagioneId = await creaStagioneConElaborazione(pool);
  const tokenAdmin = await creaUtenteAdminTest(pool);
  await fetch(`${base}/backoffice/stagioni/${stagioneId}/pubblica-proposta`, { method: 'POST', headers: { Authorization: `Bearer ${tokenAdmin}` } });
  const r2 = await fetch(`${base}/backoffice/stagioni/${stagioneId}/pubblica-proposta`, { method: 'POST', headers: { Authorization: `Bearer ${tokenAdmin}` } });
  assert.equal(r2.status, 409);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/server.concertazione.publish.test.ts`
Expected: FAIL — 404 sulle route non ancora esistenti.

- [ ] **Step 3: Aggiungi le route in `server.ts`**

Aggiungi l'import in cima a `server.ts` (vicino agli altri import di repository):

```ts
import { pubblicaProposta, trovaPropostaProvvisoria } from './propostaProvvisoria.ts';
```

Aggiungi le route subito dopo il blocco `GET /backoffice/domande/:id` (dopo la riga 2177, prima del commento `// --- Pubblico: pubblicazione esiti istruttoria (art. B.10) ---`):

```ts
  // --- Pubblicazione proposta provvisoria (art. B.23) ---

  app.post(
    '/backoffice/stagioni/:id/pubblica-proposta',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        await eseguiInTransazione(pool, async (client) => {
          await pubblicaProposta(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'pubblica_proposta_provvisoria',
            entitaTipo: 'stagioni_sportive',
            entitaId: id,
            dettaglio: null,
          });
        });
        res.status(200).json({ ok: true });
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
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

  app.get(
    '/pubblico/stagioni/:id/proposta',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        res.status(200).json(await trovaPropostaProvvisoria(pool, id));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
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

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/server.concertazione.publish.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.concertazione.publish.test.ts
git commit -m "feat(backend): route pubblicazione + lettura proposta provvisoria (art. B.23)"
```

---

### Task 9: Route — proposte pubbliche (B.24-B.26: crea/lista/dettaglio/accetta/annulla)

**Files:**
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.concertazione.proposte.test.ts`

**Interfaces:**
- Consumes: `creaProposta`, `trovaPropostaPerId`, `listaPropostePerAssociazione`, `accettaProposta`, `annullaProposta` da `./concertazione.ts` (Task 5); `schemaCreaProposta`, `schemaAccettaProposta` da `./pubblicoSchema.ts` (Task 3); `trovaAbilitazioneAttiva` da `./abilitazioni.ts`.
- Produces: `POST /pubblico/stagioni/:id/concertazione/proposte`, `GET /pubblico/stagioni/:id/concertazione/proposte`, `GET /pubblico/concertazione/proposte/:id`, `POST /pubblico/concertazione/proposte/:id/accetta`, `POST /pubblico/concertazione/proposte/:id/annulla`.

- [ ] **Step 1: Scrivi il test HTTP**

Crea `backend-node/src/server.concertazione.proposte.test.ts` (stesso harness del Task 8, più fixture con slot/associazioni/domande — copia `creaFixture` da `concertazione.test.ts` adattata per esporre anche i token pubblici via `generaAccessTokenPubblico`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { creaAbilitazionePrincipale, approvaAbilitazione } from './abilitazioni.ts';
import { hashPassword } from './auth/password.ts';
import { generaAccessToken } from './auth/jwt.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaOperatoreAdmin(pool: Pool) {
  const email = `concert-proposte-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return r.rows[0]!.id;
}

async function creaParteConAbilitazione(pool: Pool, stagioneId: string, adminId: string, label: string) {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD HTTP ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTHTP${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [cf, label, randomUUID()],
  );
  const abilitazione = await creaAbilitazionePrincipale(pool, { personaFisicaId: persona.rows[0]!.id, associazioneId: associazione.rows[0]!.id, stagioneId });
  await approvaAbilitazione(pool, abilitazione.id, adminId);
  const token = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: label });
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id, token };
}

async function creaFixtureCompleta(pool: Pool, adminId: string) {
  const disciplina = await creaDisciplina(pool, { codice: `BASKET-${randomUUID().slice(0, 8)}`, denominazione: 'Basket' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto concertazione HTTP ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra HTTP concertazione', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo unico HTTP', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-proposte-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotLibero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaParteConAbilitazione(pool, stagioneId, adminId, 'uno');
  const domanda1 = await creaDomanda(
    pool,
    {
      associazioneId: p1.associazioneId,
      stagioneId,
      disciplineCodici: [disciplina.codice],
      numeroTesserati: 10,
      numeroAtletiPartecipanti: 8,
      numeroSquadre: 1,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000',
      fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slotA.id],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    p1.personaId,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda1.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotA.id, domanda1.id, p1.associazioneId],
  );

  return { stagioneId, slotAId: slotA.id, slotLiberoId: slotLibero.id, p1 };
}

test('crea proposta utilizzo_slot_libero, lista, dettaglio, annulla', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const adminId = await creaOperatoreAdmin(pool);
  const fx = await creaFixtureCompleta(pool, adminId);

  const rCrea = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/concertazione/proposte`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagioneId: fx.stagioneId,
      tipo: 'utilizzo_slot_libero',
      slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }],
    }),
  });
  assert.equal(rCrea.status, 201);
  const proposta = await rCrea.json();
  assert.equal(proposta.stato, 'accettata_da_tutti');

  const rLista = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/concertazione/proposte`, { headers: { Authorization: `Bearer ${fx.p1.token}` } });
  assert.equal(rLista.status, 200);
  assert.equal((await rLista.json()).length, 1);

  const rDettaglio = await fetch(`${base}/pubblico/concertazione/proposte/${proposta.id}`, { headers: { Authorization: `Bearer ${fx.p1.token}` } });
  assert.equal(rDettaglio.status, 200);

  const rAnnulla = await fetch(`${base}/pubblico/concertazione/proposte/${proposta.id}/annulla`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}` },
  });
  assert.equal(rAnnulla.status, 200);
  assert.equal((await rAnnulla.json()).stato, 'annullata');
});

test('403 su creazione proposta senza abilitazione attiva', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const adminId = await creaOperatoreAdmin(pool);
  const fx = await creaFixtureCompleta(pool, adminId);
  const estraneo = generaAccessTokenPubblico({ sub: randomUUID(), codiceFiscale: 'XXXXXXXXXXX', nome: 'X', cognome: 'Y' });

  const r = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/concertazione/proposte`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${estraneo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagioneId: fx.stagioneId, tipo: 'utilizzo_slot_libero', slot: [{ slotId: fx.slotLiberoId, associazioneRiceventeId: fx.p1.associazioneId }] }),
  });
  assert.equal(r.status, 403);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/server.concertazione.proposte.test.ts`
Expected: FAIL — route inesistenti (404).

- [ ] **Step 3: Aggiungi le route in `server.ts`**

Aggiungi gli import necessari in cima a `server.ts`:

```ts
import {
  creaProposta,
  trovaPropostaPerId,
  listaPropostePerAssociazione,
  listaPropostePerStagioneBackoffice,
  accettaProposta,
  annullaProposta,
  validaProposta,
  rigettaProposta,
} from './concertazione.ts';
import { schemaCreaProposta, schemaAccettaProposta } from './pubblicoSchema.ts';
import { ErroreConflittoFifoConcertazione } from './erroriDominio.ts';
```

Aggiungi le route subito dopo quelle del Task 8 (`GET /pubblico/stagioni/:id/proposta`):

```ts
  // --- Proposte di concertazione (art. B.24-B.26) ---

  app.post(
    '/pubblico/stagioni/:id/concertazione/proposte',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaCreaProposta.safeParse({ ...req.body, stagioneId });
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      const stagione = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
      if (stagione.rows[0]?.stato !== 'concertazione') {
        res.status(409).json({ errore: 'la stagione non è in fase di concertazione' });
        return;
      }
      const associazioneProponente = parsed.data.slot.find((s) => s.associazioneCedenteId)?.associazioneCedenteId ?? parsed.data.slot[0]!.associazioneRiceventeId;
      const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, associazioneProponente, stagioneId);
      if (!delegante) {
        res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
        return;
      }
      try {
        const proposta = await eseguiInTransazione(pool, async (client) => {
          const p = await creaProposta(client, parsed.data, req.persona!.sub, associazioneProponente);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: associazioneProponente, ruolo: delegante.ruolo },
            azione: 'crea_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: p.id,
            dettaglio: p as unknown as Record<string, unknown>,
          });
          return p;
        });
        res.status(201).json(proposta);
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
    '/pubblico/stagioni/:id/concertazione/proposte',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const abilitazioni = await pool.query<{ associazione_id: string }>(
        `SELECT associazione_id FROM abilitazioni WHERE persona_fisica_id = $1 AND stagione_id = $2 AND stato = 'approvata'`,
        [req.persona!.sub, stagioneId],
      );
      const risultati = [];
      for (const riga of abilitazioni.rows) {
        risultati.push(...(await listaPropostePerAssociazione(pool, riga.associazione_id, stagioneId)));
      }
      const senzaDuplicati = [...new Map(risultati.map((p) => [p.id, p])).values()];
      res.status(200).json(senzaDuplicati);
    },
  );

  app.get(
    '/pubblico/concertazione/proposte/:id',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const proposta = await trovaPropostaPerId(pool, id);
        if (!proposta) {
          res.status(404).json({ errore: 'proposta non trovata' });
          return;
        }
        const parteAssociazioni = proposta.parti.map((p) => p.associazioneId);
        const abilitazione = await pool.query(
          `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = ANY($2) AND stagione_id = $3 AND stato = 'approvata' LIMIT 1`,
          [req.persona!.sub, parteAssociazioni, proposta.stagioneId],
        );
        if ((abilitazione.rowCount ?? 0) === 0) {
          res.status(403).json({ errore: 'la propria associazione non è parte di questa proposta' });
          return;
        }
        res.status(200).json(proposta);
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

  app.post(
    '/pubblico/concertazione/proposte/:id/accetta',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaAccettaProposta.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      const proposta = await trovaPropostaPerId(pool, id);
      if (!proposta) {
        res.status(404).json({ errore: 'proposta non trovata' });
        return;
      }
      const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, parsed.data.associazioneId, proposta.stagioneId);
      if (!delegante) {
        res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
        return;
      }
      try {
        const aggiornata = await eseguiInTransazione(pool, async (client) => {
          const p = await accettaProposta(client, id, parsed.data.associazioneId, req.persona!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'accetta_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: p.id,
            dettaglio: { stato: p.stato },
          });
          return p;
        });
        res.status(200).json(aggiornata);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/pubblico/concertazione/proposte/:id/annulla',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const proposta = await trovaPropostaPerId(pool, id);
      if (!proposta) {
        res.status(404).json({ errore: 'proposta non trovata' });
        return;
      }
      if (proposta.proponentePersonaFisicaId !== req.persona!.sub) {
        res.status(403).json({ errore: 'solo il proponente può annullare la proposta' });
        return;
      }
      try {
        const aggiornata = await eseguiInTransazione(pool, async (client) => {
          const p = await annullaProposta(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: proposta.proponenteAssociazioneId },
            azione: 'annulla_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: p.id,
            dettaglio: { stato: p.stato },
          });
          return p;
        });
        res.status(200).json(aggiornata);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/server.concertazione.proposte.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.concertazione.proposte.test.ts
git commit -m "feat(backend): route pubbliche per creare/accettare/annullare proposte di concertazione (art. B.24-B.26)"
```

---

### Task 10: Route — validazione backoffice (B.27-B.28) + test end-to-end completo

**Files:**
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.concertazione.validazione.test.ts`

**Interfaces:**
- Consumes: `validaProposta`, `rigettaProposta`, `listaPropostePerStagioneBackoffice` da `./concertazione.ts` (Task 7); `schemaRespingiDelega` (già esistente, riuso per `{motivazione}`).
- Produces: `GET /backoffice/stagioni/:id/concertazione/proposte`, `PUT /backoffice/concertazione/proposte/:id/valida`, `PUT /backoffice/concertazione/proposte/:id/rigetta`.

- [ ] **Step 1: Scrivi il test HTTP end-to-end (scambio bilaterale completo + FIFO + rigetto)**

Crea `backend-node/src/server.concertazione.validazione.test.ts`, riusando l'harness/fixture di `server.concertazione.proposte.test.ts` (copia le stesse funzioni `avviaServerTest`, `creaOperatoreAdmin`, `creaParteConAbilitazione`, `creaFixtureCompleta`, adattando `creaFixtureCompleta` per creare **due** parti con assegnazioni su due slot distinti, come in `concertazione.test.ts::creaFixture`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { hashPassword } from './auth/password.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { creaAbilitazionePrincipale, approvaAbilitazione } from './abilitazioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaAdmin(pool: Pool): Promise<{ id: string; token: string }> {
  const email = `concert-valida-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaParte(pool: Pool, stagioneId: string, adminId: string, label: string) {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD valida ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTVAL${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [cf, label, randomUUID()],
  );
  const abilitazione = await creaAbilitazionePrincipale(pool, { personaFisicaId: persona.rows[0]!.id, associazioneId: associazione.rows[0]!.id, stagioneId });
  await approvaAbilitazione(pool, abilitazione.id, adminId);
  const token = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: label });
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id, token };
}

async function creaFixtureDueParti(pool: Pool, adminId: string) {
  const disciplina = await creaDisciplina(pool, { codice: `RUGBY-${randomUUID().slice(0, 8)}`, denominazione: 'Rugby' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto valida ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra valida', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo valida', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'concertazione') RETURNING id`,
    [`stagione-valida-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotB = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaParte(pool, stagioneId, adminId, 'uno');
  const p2 = await creaParte(pool, stagioneId, adminId, 'due');

  for (const [p, slot] of [[p1, slotA], [p2, slotB]] as const) {
    const domanda = await creaDomanda(
      pool,
      {
        associazioneId: p.associazioneId,
        stagioneId,
        disciplineCodici: [disciplina.codice],
        numeroTesserati: 10,
        numeroAtletiPartecipanti: 8,
        numeroSquadre: 1,
        numeroSquadreFederaliStagionePrecedente: 0,
        attivitaGiovanile: true,
        attivitaAgonistica: false,
        attivitaParalimpicaInclusiva: false,
        fabbisognoMinimoMinuti: '60.000',
        fabbisognoOttimaleMinuti: '60.000',
        preferenze: [slot.id],
        blocchiAllenamento: [],
        richiedeGiornataGara: false,
        richiesteGiornataGara: [],
      },
      p.personaId,
    );
    await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
    await pool.query(
      `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
      [slot.id, domanda.id, p.associazioneId],
    );
  }

  return { stagioneId, slotAId: slotA.id, slotBId: slotB.id, p1, p2 };
}

async function creaEAccettaProposta(base: string, fx: Awaited<ReturnType<typeof creaFixtureDueParti>>) {
  const rCrea = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/concertazione/proposte`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagioneId: fx.stagioneId,
      tipo: 'scambio_bilaterale',
      slot: [
        { slotId: fx.slotAId, associazioneCedenteId: fx.p1.associazioneId, associazioneRiceventeId: fx.p2.associazioneId },
        { slotId: fx.slotBId, associazioneCedenteId: fx.p2.associazioneId, associazioneRiceventeId: fx.p1.associazioneId },
      ],
    }),
  });
  const proposta = await rCrea.json();
  await fetch(`${base}/pubblico/concertazione/proposte/${proposta.id}/accetta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p2.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ associazioneId: fx.p2.associazioneId }),
  });
  return proposta.id as string;
}

test('flusso end-to-end: coda backoffice, valida con successo, assegnazioni scambiate', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const propostaId = await creaEAccettaProposta(base, fx);

  const rCoda = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/concertazione/proposte?stato=accettata_da_tutti`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rCoda.status, 200);
  assert.equal((await rCoda.json()).length, 1);

  const rValida = await fetch(`${base}/backoffice/concertazione/proposte/${propostaId}/valida`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rValida.status, 200);
  const esito = await rValida.json();
  assert.equal(esito.esito, 'validata');

  const slotA = await pool.query<{ associazione_id: string }>(`SELECT associazione_id FROM assegnazioni WHERE slot_id = $1 AND stato = 'validata'`, [fx.slotAId]);
  assert.equal(slotA.rows[0]?.associazione_id, fx.p2.associazioneId);
});

test('PUT valida risponde 409 su conflitto FIFO', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const propostaVecchiaId = await creaEAccettaProposta(base, fx);
  const propostaNuovaId = await creaEAccettaProposta(base, fx);

  const rNuova = await fetch(`${base}/backoffice/concertazione/proposte/${propostaNuovaId}/valida`, { method: 'PUT', headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(rNuova.status, 409);

  const rVecchia = await fetch(`${base}/backoffice/concertazione/proposte/${propostaVecchiaId}/valida`, { method: 'PUT', headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(rVecchia.status, 200);
  assert.equal((await rVecchia.json()).esito, 'validata');
});

test('PUT rigetta manuale su proposta accettata_da_tutti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const propostaId = await creaEAccettaProposta(base, fx);

  const r = await fetch(`${base}/backoffice/concertazione/proposte/${propostaId}/rigetta`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivazione: 'rigetto discrezionale di test' }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).stato, 'rigettata');
});

test('403 operatore pubblico su route backoffice di validazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const propostaId = await creaEAccettaProposta(base, fx);

  const r = await fetch(`${base}/backoffice/concertazione/proposte/${propostaId}/valida`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${fx.p1.token}` }, // token pubblico, non backoffice
  });
  assert.equal(r.status, 401);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/server.concertazione.validazione.test.ts`
Expected: FAIL — route inesistenti (404).

- [ ] **Step 3: Aggiungi le route in `server.ts`**

Aggiungi le route subito dopo quelle del Task 9 (dopo `POST /pubblico/concertazione/proposte/:id/annulla`):

```ts
  // --- Backoffice: validazione delle proposte di concertazione (art. B.27-B.28) ---

  app.get(
    '/backoffice/stagioni/:id/concertazione/proposte',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stato = typeof req.query.stato === 'string' ? (req.query.stato as never) : undefined;
      res.status(200).json(await listaPropostePerStagioneBackoffice(pool, stagioneId, stato));
    },
  );

  app.put(
    '/backoffice/concertazione/proposte/:id/valida',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const esito = await eseguiInTransazione(pool, async (client) => {
          const e = await validaProposta(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'valida_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: id,
            dettaglio: { esito: e.esito, motivazione: e.motivazione ?? null },
          });
          return e;
        });
        res.status(200).json(esito);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione || err instanceof ErroreConflittoFifoConcertazione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/concertazione/proposte/:id/rigetta',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaRespingiDelega.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const proposta = await eseguiInTransazione(pool, async (client) => {
          const p = await rigettaProposta(client, id, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'rigetta_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: p.id,
            dettaglio: { stato: p.stato, motivazioneRigetto: p.motivazioneRigetto },
          });
          return p;
        });
        res.status(200).json(proposta);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

Verifica che `schemaRespingiDelega` sia già importato in `server.ts` (usato da `/backoffice/domande/:id/escludi` e `/backoffice/osservazioni/:id/respingi`) — nessun import nuovo necessario per questa route.

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test src/server.concertazione.validazione.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Verifica il typecheck e l'intera suite**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

Run: `cd backend-node && TEST_DATABASE_URL=<url> node --test "src/**/*.test.ts"` (quotato — vedi gotcha glob in `CLAUDE.md`)
Expected: tutti i test passano, nessuna regressione sul resto della suite.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.concertazione.validazione.test.ts
git commit -m "feat(backend): route backoffice di validazione/rigetto delle proposte di concertazione (art. B.27-B.28)"
```

---

## Self-Review Notes

- **Spec coverage**: B.23 (Task 4, 8) · B.24-B.25 (Task 5, 9 — tipi proposta ammissibili modellati da `TipoProposta`) · B.26 (Task 5, 9 — accettazione multi-parte) · B.27 (Task 6, 7 — controlli strutturali + FIFO) · B.28 (Task 7, 10 — validata/rigettata con motivazione). Migration di collegamento (Task 1) usata da Task 7. Fuori scope confermato: B.29-B.31 (blocco 4/4), Fase 15/B.32 (task futuro).
- **Placeholder scan**: nessun TBD/TODO; ogni step ha codice completo, non descrizioni.
- **Type consistency**: `Proposta`/`TipoProposta`/`StatoProposta` definiti in Task 5, usati identici in Task 6, 7, 9, 10. `EsitoValidazione` (Task 7) consumato identico in Task 10. `VocePropostaProvvisoria` (Task 4) consumato identico in Task 8.
