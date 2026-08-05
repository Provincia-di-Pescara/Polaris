# Variazioni ordinarie + indisponibilità sopravvenute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare le indisponibilità sopravvenute degli impianti (art. B.33, solo backoffice) e le variazioni ordinarie in-stagione tra associazioni (art. B.32: liberazione/recupero/scambio temporaneo/utilizzo occasionale), primo blocco della Fase 15 (gestione stagionale).

**Architettura:** Nuova tabella `variazioni_ordinarie` per occorrenze puntuali (una data specifica, non il template permanente). Due repository Node nuovi (`indisponibilita.ts`, `variazioni.ts`). Le variazioni sono interamente tra associazioni — nessuna coda di validazione backoffice attiva (istruzione esplicita del committente), solo controlli di compatibilità automatici lato sistema, in parte riusati da `concertazione.ts` (`controlloDisciplinaCompatibile`, invariato) e in parte nuovi (proprietà dell'occorrenza, diversa dallo stato permanente del template).

**Tech Stack:** Node.js 24 + TypeScript 7 (`.ts` nativo), `pg` diretto senza ORM, `zod` per validazione HTTP, `node --test` contro Postgres reale.

## Global Constraints

- Tutti i valori NUMERIC letti da Postgres sempre con `::text`, mai binding numerico diretto.
- Ogni scrittura passa da `registraOperazione` (art. B.39) dentro `eseguiInTransazione`.
- Ogni route nuova mappa `ErroreNonTrovato`→404, `ErroreStatoNonValidoPerTransizione`→409, `comeErroreRiferimentoNonValido`→400, altrimenti 500 — stesso pattern consolidato in tutto il progetto.
- **Nessuna coda di validazione backoffice per le variazioni ordinarie**: solo una GET di sola lettura per monitoraggio. Non aggiungere endpoint di scrittura backoffice su `variazioni_ordinarie` oltre a quanto specificato.
- Test sempre con `TEST_DATABASE_URL`, skip pulito se assente, fixture con suffissi `randomUUID()` per unicità su Postgres persistente condiviso.
- Nessuna modifica alla UI (Fase 5, non esiste ancora), nessuna modifica al motore Go (questo blocco è puro backend-node).

---

## File Structure

- **Create** `db/migrations/000013_variazioni_ordinarie.up.sql` / `.down.sql`.
- **Create** `backend-node/src/indisponibilita.ts` — repository B.33.
- **Create** `backend-node/src/indisponibilita.test.ts`.
- **Create** `backend-node/src/variazioni.ts` — repository B.32.
- **Create** `backend-node/src/variazioni.test.ts`.
- **Modify** `backend-node/src/backofficeSchema.ts` — `schemaCreaIndisponibilita`.
- **Modify** `backend-node/src/pubblicoSchema.ts` — `schemaCreaVariazione`.
- **Modify** `backend-node/src/server.ts` — route indisponibilità (backoffice+pubblico) e variazioni (pubblico+backoffice sola lettura).
- **Create** `backend-node/src/server.indisponibilita.test.ts`.
- **Create** `backend-node/src/server.variazioni.test.ts`.

---

### Task 1: Migration — tabella `variazioni_ordinarie`

**Files:**
- Create: `db/migrations/000013_variazioni_ordinarie.up.sql`
- Create: `db/migrations/000013_variazioni_ordinarie.down.sql`

**Interfaces:**
- Produces: tabella `variazioni_ordinarie` con colonne `id, tipo, slot_id, data, slot_destinazione_id, data_destinazione, richiesta_da_associazione_id, richiesta_da_persona_fisica_id, controparte_associazione_id, indisponibilita_id, stato, motivazione_rifiuto, creata_il`, usata da Task 4-5.

- [ ] **Step 1: Scrivi la migration up**

```sql
CREATE TABLE variazioni_ordinarie (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo TEXT NOT NULL CHECK (tipo IN ('liberazione', 'recupero', 'scambio_temporaneo', 'utilizzo_occasionale')),
    slot_id UUID NOT NULL REFERENCES slot_settimana_tipo(id),
    data DATE NOT NULL,
    slot_destinazione_id UUID REFERENCES slot_settimana_tipo(id),
    data_destinazione DATE,
    richiesta_da_associazione_id UUID NOT NULL REFERENCES associazioni(id),
    richiesta_da_persona_fisica_id UUID NOT NULL REFERENCES persone_fisiche(id),
    controparte_associazione_id UUID REFERENCES associazioni(id),
    indisponibilita_id UUID REFERENCES indisponibilita_sopravvenute(id),
    stato TEXT NOT NULL DEFAULT 'accettata' CHECK (stato IN ('in_attesa_accettazione', 'accettata', 'rifiutata', 'annullata')),
    motivazione_rifiuto TEXT,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT variazioni_scambio_ha_controparte CHECK (
        (tipo = 'scambio_temporaneo') = (controparte_associazione_id IS NOT NULL)
    ),
    CONSTRAINT variazioni_destinazione_coerente CHECK (
        (tipo IN ('recupero', 'scambio_temporaneo')) = (slot_destinazione_id IS NOT NULL AND data_destinazione IS NOT NULL)
    )
);
-- Una sola variazione attiva per occorrenza (origine): evita che due richieste in
-- conflitto sulla stessa fascia+data vengano entrambe accettate.
CREATE UNIQUE INDEX variazioni_occorrenza_attiva_uq ON variazioni_ordinarie (slot_id, data)
    WHERE stato IN ('in_attesa_accettazione', 'accettata');
CREATE INDEX variazioni_richiesta_da_idx ON variazioni_ordinarie (richiesta_da_associazione_id);
```

Salva in `db/migrations/000013_variazioni_ordinarie.up.sql`.

- [ ] **Step 2: Scrivi la migration down**

```sql
DROP TABLE variazioni_ordinarie;
```

Salva in `db/migrations/000013_variazioni_ordinarie.down.sql`.

- [ ] **Step 3: Verifica contro Postgres reale**

Applica la migration sul Postgres di sviluppo persistente (`pg-palestre-dev`, porta mappata `5433`, o via `docker exec` se preferisci — vedi CLAUDE.md sezione "Test locale rapido"):

```bash
docker cp db/migrations/000013_variazioni_ordinarie.up.sql pg-palestre-dev:/tmp/000013.up.sql
docker exec pg-palestre-dev psql -U postgres -d palestre -f /tmp/000013.up.sql
docker exec pg-palestre-dev psql -U postgres -d palestre -c "\d variazioni_ordinarie"
```

Expected: la tabella compare con tutte le colonne, i 2 CHECK e l'indice unico parziale. Poi verifica che i CHECK rifiutino un insert incoerente (es. `tipo='liberazione'` con `controparte_associazione_id` valorizzato deve fallire) con un `INSERT` di prova via `docker exec ... psql -c "INSERT ..."` che ti aspetti fallisca. Non applicare la `.down.sql` qui — il Postgres persistente resta con lo schema aggiornato per i task successivi.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/000013_variazioni_ordinarie.up.sql db/migrations/000013_variazioni_ordinarie.down.sql
git commit -m "feat(db): aggiungi tabella variazioni_ordinarie per le variazioni in-stagione (art. B.32)"
```

---

### Task 2: Repository `indisponibilita.ts` (art. B.33)

**Files:**
- Create: `backend-node/src/indisponibilita.ts`
- Create: `backend-node/src/indisponibilita.test.ts`
- Modify: `backend-node/src/backofficeSchema.ts`

**Interfaces:**
- Consumes: `Db`, `ErroreNonTrovato` (da `./erroriDominio.ts`).
- Produces: `interface Indisponibilita { id, slotId, dal, al, motivo, comunicataDa, comunicataIl, notificataAlleAssociazioniIl, slotRecuperoId }`; `creaIndisponibilita(db: Db, dati: DatiCreaIndisponibilita): Promise<Indisponibilita>`; `listaIndisponibilitaPerAssociazione(db: Db, associazioneId: string, stagioneId?: string): Promise<Indisponibilita[]>`; `schemaCreaIndisponibilita` (zod, in `backofficeSchema.ts`). Consumati da Task 3 (route).

- [ ] **Step 1: Scrivi il test repository**

Crea `backend-node/src/indisponibilita.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaIndisponibilita, listaIndisponibilitaPerAssociazione } from './indisponibilita.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `KARATE-${randomUUID().slice(0, 8)}`, denominazione: 'Karate' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto indisp ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra indisp', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Tatami indisp', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-indisp-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotRecupero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD indisp ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Indisp', $2, 'spid') RETURNING id`,
    [`TSTIND${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id, stagioneId, disciplineCodici: [disciplina.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slot.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  return { stagioneId, slotId: slot.id, slotRecuperoId: slotRecupero.id, associazioneId: associazione.rows[0]!.id };
}

test('creaIndisponibilita con slotRecuperoId, notificataAlleAssociazioniIl impostato subito', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const indisponibilita = await creaIndisponibilita(pool, {
    slotId: fx.slotId, dal: '2030-10-01', al: '2030-10-07', motivo: 'lavori di manutenzione',
    comunicataDa: 'ente', slotRecuperoId: fx.slotRecuperoId,
  });

  assert.equal(indisponibilita.slotId, fx.slotId);
  assert.equal(indisponibilita.slotRecuperoId, fx.slotRecuperoId);
  assert.ok(indisponibilita.notificataAlleAssociazioniIl !== null);
});

test('creaIndisponibilita senza slotRecuperoId', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const indisponibilita = await creaIndisponibilita(pool, {
    slotId: fx.slotId, dal: '2030-10-01', al: '2030-10-01', motivo: 'consultazione elettorale',
    comunicataDa: 'istituzione_scolastica',
  });

  assert.equal(indisponibilita.slotRecuperoId, null);
});

test('listaIndisponibilitaPerAssociazione trova le indisponibilità sovrapposte a un\'assegnazione attiva', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await creaIndisponibilita(pool, { slotId: fx.slotId, dal: '2030-10-01', al: '2030-10-07', motivo: 'test', comunicataDa: 'ente' });

  const lista = await listaIndisponibilitaPerAssociazione(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(lista.length, 1);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/indisponibilita.test.ts`
Expected: FAIL — `Cannot find module './indisponibilita.ts'`.

- [ ] **Step 3: Aggiungi lo schema zod**

In `backend-node/src/backofficeSchema.ts`, in fondo al file:

```ts
export const schemaCreaIndisponibilita = z
  .object({
    dal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    al: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    motivo: z.string().min(1),
    comunicataDa: z.enum(['istituzione_scolastica', 'ente']),
    slotRecuperoId: z.string().uuid().optional(),
  })
  .refine((d) => d.al >= d.dal, { message: 'al deve essere >= dal', path: ['al'] });
export type CreaIndisponibilitaRequest = z.infer<typeof schemaCreaIndisponibilita>;
```

- [ ] **Step 4: Scrivi l'implementazione**

Crea `backend-node/src/indisponibilita.ts`:

```ts
import type { Db } from './db.ts';

export interface Indisponibilita {
  id: string;
  slotId: string;
  dal: string;
  al: string;
  motivo: string;
  comunicataDa: 'istituzione_scolastica' | 'ente';
  comunicataIl: string;
  notificataAlleAssociazioniIl: string | null;
  slotRecuperoId: string | null;
}

interface RigaIndisponibilita {
  id: string;
  slot_id: string;
  dal: string;
  al: string;
  motivo: string;
  comunicata_da: 'istituzione_scolastica' | 'ente';
  comunicata_il: Date;
  notificata_alle_associazioni_il: Date | null;
  slot_recupero_id: string | null;
}

const COLONNE_SELECT = `id, slot_id, dal::text, al::text, motivo, comunicata_da, comunicata_il,
  notificata_alle_associazioni_il, slot_recupero_id`;

function daRiga(r: RigaIndisponibilita): Indisponibilita {
  return {
    id: r.id,
    slotId: r.slot_id,
    dal: r.dal,
    al: r.al,
    motivo: r.motivo,
    comunicataDa: r.comunicata_da,
    comunicataIl: r.comunicata_il.toISOString(),
    notificataAlleAssociazioniIl: r.notificata_alle_associazioni_il ? r.notificata_alle_associazioni_il.toISOString() : null,
    slotRecuperoId: r.slot_recupero_id,
  };
}

export interface DatiCreaIndisponibilita {
  slotId: string;
  dal: string;
  al: string;
  motivo: string;
  comunicataDa: 'istituzione_scolastica' | 'ente';
  slotRecuperoId?: string | undefined;
}

// art. B.33: "notifica automaticamente l'indisponibilità alle associazioni interessate" —
// implementato come visibilità immediata via API (notificata_alle_associazioni_il = now()
// all'INSERT), non invio email (le persone fisiche OIDC non garantiscono un claim email
// nei dati SPID/CIE — assunzione 🔺 documentata nello spec).
export async function creaIndisponibilita(db: Db, dati: DatiCreaIndisponibilita): Promise<Indisponibilita> {
  const r = await db.query<RigaIndisponibilita>(
    `INSERT INTO indisponibilita_sopravvenute (slot_id, dal, al, motivo, comunicata_da, notificata_alle_associazioni_il, slot_recupero_id)
     VALUES ($1, $2, $3, $4, $5, now(), $6)
     RETURNING ${COLONNE_SELECT}`,
    [dati.slotId, dati.dal, dati.al, dati.motivo, dati.comunicataDa, dati.slotRecuperoId ?? null],
  );
  return daRiga(r.rows[0]!);
}

export async function listaIndisponibilitaPerAssociazione(db: Db, associazioneId: string, stagioneId?: string): Promise<Indisponibilita[]> {
  const r = stagioneId
    ? await db.query<RigaIndisponibilita>(
        `SELECT i.id, i.slot_id, i.dal::text, i.al::text, i.motivo, i.comunicata_da, i.comunicata_il,
                i.notificata_alle_associazioni_il, i.slot_recupero_id
         FROM indisponibilita_sopravvenute i
         JOIN assegnazioni a ON a.slot_id = i.slot_id
         JOIN slot_settimana_tipo st ON st.id = i.slot_id
         WHERE a.associazione_id = $1 AND a.stato IN ('provvisoria', 'validata') AND st.stagione_id = $2
         ORDER BY i.dal`,
        [associazioneId, stagioneId],
      )
    : await db.query<RigaIndisponibilita>(
        `SELECT i.id, i.slot_id, i.dal::text, i.al::text, i.motivo, i.comunicata_da, i.comunicata_il,
                i.notificata_alle_associazioni_il, i.slot_recupero_id
         FROM indisponibilita_sopravvenute i
         JOIN assegnazioni a ON a.slot_id = i.slot_id
         WHERE a.associazione_id = $1 AND a.stato IN ('provvisoria', 'validata')
         ORDER BY i.dal`,
        [associazioneId],
      );
  return r.rows.map(daRiga);
}
```

- [ ] **Step 5: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/indisponibilita.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/indisponibilita.ts backend-node/src/indisponibilita.test.ts backend-node/src/backofficeSchema.ts
git commit -m "feat(backend): repository indisponibilità sopravvenute (art. B.33)"
```

---

### Task 3: Route indisponibilità (backoffice + pubblico)

**Files:**
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.indisponibilita.test.ts`

**Interfaces:**
- Consumes: `creaIndisponibilita`, `listaIndisponibilitaPerAssociazione` (Task 2), `schemaCreaIndisponibilita` (Task 2).
- Produces: `POST /backoffice/slot/:id/indisponibilita`, `GET /pubblico/associazioni/:id/indisponibilita`.

- [ ] **Step 1: Scrivi il test HTTP**

Crea `backend-node/src/server.indisponibilita.test.ts`, stesso harness (`avviaServerTest`, `creaAdmin`/`creaOperatoreDiTest`, `generaAccessTokenPubblico`) già visto in `server.riassegnazione.test.ts`/`server.settimanaTipoDefinitiva.test.ts` — copia la stessa struttura di fixture (stagione+disciplina+istituzione+impianto+spazio+slot+associazione+persona+domanda+assegnazione), adattando i prefissi random:

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
  const email = `indisp-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaFixtureCompleta(pool: Pool, adminId: string) {
  const disciplina = await creaDisciplina(pool, { codice: `TIRO-${randomUUID().slice(0, 8)}`, denominazione: 'Tiro con l\'arco' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto indisp http ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra indisp http', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo indisp', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-indisp-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD indisp http ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTIDH${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Indisp', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const abilitazione = await creaAbilitazionePrincipale(pool, { personaFisicaId: persona.rows[0]!.id, associazioneId: associazione.rows[0]!.id, stagioneId });
  await approvaAbilitazione(pool, abilitazione.id, adminId);
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id, stagioneId, disciplineCodici: [disciplina.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slot.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  const tokenPubblico = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: 'Indisp' });
  return { stagioneId, slotId: slot.id, associazioneId: associazione.rows[0]!.id, tokenPubblico };
}

test('POST .../indisponibilita crea, GET pubblico la trova', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool, admin.id);

  const rCrea = await fetch(`${base}/backoffice/slot/${fx.slotId}/indisponibilita`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dal: '2030-10-01', al: '2030-10-07', motivo: 'manutenzione', comunicataDa: 'ente' }),
  });
  assert.equal(rCrea.status, 201);

  const rLista = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/indisponibilita?stagioneId=${fx.stagioneId}`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  assert.equal(rLista.status, 200);
  assert.equal((await rLista.json()).length, 1);
});

test('GET pubblico indisponibilita: 403 senza abilitazione attiva', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool, admin.id);
  const estraneo = generaAccessTokenPubblico({ sub: randomUUID(), codiceFiscale: 'XXXXXXXXXXX', nome: 'X', cognome: 'Y' });

  const r = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/indisponibilita`, {
    headers: { Authorization: `Bearer ${estraneo}` },
  });
  assert.equal(r.status, 403);
});

test('POST .../indisponibilita: 400 su date incoerenti', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool, admin.id);

  const r = await fetch(`${base}/backoffice/slot/${fx.slotId}/indisponibilita`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dal: '2030-10-07', al: '2030-10-01', motivo: 'manutenzione', comunicataDa: 'ente' }),
  });
  assert.equal(r.status, 400);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.indisponibilita.test.ts`
Expected: FAIL — 404 sulle route non ancora esistenti.

- [ ] **Step 3: Aggiungi le route in `server.ts`**

Aggiungi l'import: `import { creaIndisponibilita, listaIndisponibilitaPerAssociazione } from './indisponibilita.ts';` e `import { schemaCreaIndisponibilita } from './backofficeSchema.ts';` (unisci con l'import esistente da `backofficeSchema.ts` se presente un import multiplo).

Aggiungi le route, in un punto nuovo dopo il blocco delle route di concertazione/settimana-tipo-definitiva esistenti:

```ts
  // --- Indisponibilità sopravvenute (art. B.33) ---

  app.post(
    '/backoffice/slot/:id/indisponibilita',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const slotId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaCreaIndisponibilita.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const indisponibilita = await eseguiInTransazione(pool, async (client) => {
          const ind = await creaIndisponibilita(client, { slotId, ...parsed.data });
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_indisponibilita',
            entitaTipo: 'indisponibilita_sopravvenute',
            entitaId: ind.id,
            dettaglio: ind as unknown as Record<string, unknown>,
          });
          return ind;
        });
        res.status(201).json(indisponibilita);
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
    '/pubblico/associazioni/:id/indisponibilita',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const associazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      try {
        const abilitazione = stagioneId
          ? await pool.query(
              `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stagione_id = $3 AND stato = 'approvata' LIMIT 1`,
              [req.persona!.sub, associazioneId, stagioneId],
            )
          : await pool.query(
              `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato = 'approvata' LIMIT 1`,
              [req.persona!.sub, associazioneId],
            );
        if ((abilitazione.rowCount ?? 0) === 0) {
          res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione' });
          return;
        }
        res.status(200).json(await listaIndisponibilitaPerAssociazione(pool, associazioneId, stagioneId));
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

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.indisponibilita.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.indisponibilita.test.ts
git commit -m "feat(backend): route indisponibilità sopravvenute — backoffice crea, pubblico legge (art. B.33)"
```

---

### Task 4: Repository `variazioni.ts` — proprietà occorrenza + creazione (art. B.32)

**Files:**
- Create: `backend-node/src/variazioni.ts`
- Create: `backend-node/src/variazioni.test.ts`
- Modify: `backend-node/src/pubblicoSchema.ts`

**Interfaces:**
- Consumes: `Db`; `controlloDisciplinaCompatibile` (già esistente in `./concertazione.ts`, riuso diretto — non dipende dallo stato di un'assegnazione, solo da disciplina/domanda/spazio); `ErroreRiferimentoNonValido`, `ErroreNonTrovato`.
- Produces: `interface Variazione { id, tipo, slotId, data, slotDestinazioneId, dataDestinazione, richiestaDaAssociazioneId, richiestaDaPersonaFisicaId, controparteAssociazioneId, indisponibilitaId, stato, motivazioneRifiuto, creataIl }`; `trovaProprietarioOccorrenza(db: Db, slotId: string, data: string): Promise<string | null>`; `creaVariazione(db: Db, dati: DatiCreaVariazione, richiedentePersonaFisicaId: string): Promise<Variazione>`; `schemaCreaVariazione` (zod). Consumati da Task 5 (accetta/annulla) e Task 6 (route).

- [ ] **Step 1: Scrivi il test repository**

Crea `backend-node/src/variazioni.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { trovaProprietarioOccorrenza, creaVariazione } from './variazioni.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { ErroreRiferimentoNonValido } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaAssociazionePersona(pool: Pool, label: string) {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD var ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [`TSTVAR${randomUUID().slice(0, 10).toUpperCase()}`, label, randomUUID()],
  );
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id };
}

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `SCI-${randomUUID().slice(0, 8)}`, denominazione: 'Sci' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto var ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra var', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo var', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-var-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotLibero = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaAssociazionePersona(pool, 'uno');
  const p2 = await creaAssociazionePersona(pool, 'due');

  const datiDomanda = {
    disciplineCodici: [disciplina.codice], numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1,
    numeroSquadreFederaliStagionePrecedente: 0, attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
    fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000', richiedeGiornataGara: false, richiesteGiornataGara: [],
  };
  const d1 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p1.associazioneId, stagioneId, preferenze: [slotA.id], blocchiAllenamento: [] }, p1.personaId);
  const d2 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p2.associazioneId, stagioneId, preferenze: [slotLibero.id], blocchiAllenamento: [] }, p2.personaId);
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = ANY($1)`, [[d1.id, d2.id]]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotA.id, d1.id, p1.associazioneId],
  );

  return { stagioneId, slotAId: slotA.id, slotLiberoId: slotLibero.id, p1, p2 };
}

test('trovaProprietarioOccorrenza: assegnazione permanente se nessuna variazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2030-10-07'), fx.p1.associazioneId);
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotLiberoId, '2030-10-07'), null);
});

test('creaVariazione utilizzo_occasionale su slot libero: accettata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const variazione = await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2030-10-09', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  assert.equal(variazione.stato, 'accettata');
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotLiberoId, '2030-10-09'), fx.p1.associazioneId);
});

test('creaVariazione utilizzo_occasionale su slot occupato: rifiutata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const variazione = await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2030-10-07', associazioneId: fx.p2.associazioneId },
    fx.p2.personaId,
  );
  assert.equal(variazione.stato, 'rifiutata');
  assert.ok(variazione.motivazioneRifiuto);
});

test('creaVariazione liberazione: solo il proprietario può liberare, poi lo slot risulta libero quel giorno', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const nonProprietario = await creaVariazione(
    pool,
    { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2030-10-07', associazioneId: fx.p2.associazioneId },
    fx.p2.personaId,
  );
  assert.equal(nonProprietario.stato, 'rifiutata');

  const proprietario = await creaVariazione(
    pool,
    { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: fx.slotAId, data: '2030-10-14', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  assert.equal(proprietario.stato, 'accettata');
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2030-10-14'), null);
});

test('creaVariazione scambio_temporaneo: nasce in_attesa_accettazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const variazione = await creaVariazione(
    pool,
    {
      tipo: 'scambio_temporaneo', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2030-10-21', associazioneId: fx.p1.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2030-10-23',
      controparteAssociazioneId: fx.p2.associazioneId,
    },
    fx.p1.personaId,
  );
  assert.equal(variazione.stato, 'in_attesa_accettazione');
});

test('creaVariazione rifiuta slot fuori stagione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await assert.rejects(
    () =>
      creaVariazione(
        pool,
        { tipo: 'liberazione', stagioneId: fx.stagioneId, slotId: randomUUID(), data: '2030-10-07', associazioneId: fx.p1.associazioneId },
        fx.p1.personaId,
      ),
    ErroreRiferimentoNonValido,
  );
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/variazioni.test.ts`
Expected: FAIL — `Cannot find module './variazioni.ts'`.

- [ ] **Step 3: Aggiungi lo schema zod**

In `backend-node/src/pubblicoSchema.ts`, in fondo al file:

```ts
export const schemaCreaVariazione = z
  .object({
    stagioneId: z.string().uuid(),
    tipo: z.enum(['liberazione', 'recupero', 'scambio_temporaneo', 'utilizzo_occasionale']),
    associazioneId: z.string().uuid(), // l'associazione del chiamante che agisce (una persona può averne più di una)
    slotId: z.string().uuid(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slotDestinazioneId: z.string().uuid().optional(),
    dataDestinazione: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    controparteAssociazioneId: z.string().uuid().optional(),
    indisponibilitaId: z.string().uuid().optional(),
  })
  .refine((d) => (d.tipo === 'recupero' || d.tipo === 'scambio_temporaneo') === (d.slotDestinazioneId !== undefined && d.dataDestinazione !== undefined), {
    message: 'slotDestinazioneId e dataDestinazione richiesti solo per recupero e scambio_temporaneo',
    path: ['slotDestinazioneId'],
  })
  .refine((d) => (d.tipo === 'scambio_temporaneo') === (d.controparteAssociazioneId !== undefined), {
    message: 'controparteAssociazioneId richiesto solo per scambio_temporaneo',
    path: ['controparteAssociazioneId'],
  });
export type CreaVariazioneRequest = z.infer<typeof schemaCreaVariazione>;

export const schemaAccettaVariazione = z.object({
  associazioneId: z.string().uuid(),
});
export type AccettaVariazioneRequest = z.infer<typeof schemaAccettaVariazione>;
```

- [ ] **Step 4: Scrivi l'implementazione**

Crea `backend-node/src/variazioni.ts`:

```ts
import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreRiferimentoNonValido } from './erroriDominio.ts';
import { controlloDisciplinaCompatibile } from './concertazione.ts';
import { validaSlotAppartengonoAStagione } from './domande.ts';

export type TipoVariazione = 'liberazione' | 'recupero' | 'scambio_temporaneo' | 'utilizzo_occasionale';
export type StatoVariazione = 'in_attesa_accettazione' | 'accettata' | 'rifiutata' | 'annullata';

export interface Variazione {
  id: string;
  tipo: TipoVariazione;
  slotId: string;
  data: string;
  slotDestinazioneId: string | null;
  dataDestinazione: string | null;
  richiestaDaAssociazioneId: string;
  richiestaDaPersonaFisicaId: string;
  controparteAssociazioneId: string | null;
  indisponibilitaId: string | null;
  stato: StatoVariazione;
  motivazioneRifiuto: string | null;
  creataIl: string;
}

interface RigaVariazione {
  id: string;
  tipo: TipoVariazione;
  slot_id: string;
  data: string;
  slot_destinazione_id: string | null;
  data_destinazione: string | null;
  richiesta_da_associazione_id: string;
  richiesta_da_persona_fisica_id: string;
  controparte_associazione_id: string | null;
  indisponibilita_id: string | null;
  stato: StatoVariazione;
  motivazione_rifiuto: string | null;
  creata_il: Date;
}

const COLONNE_SELECT = `id, tipo, slot_id, data::text, slot_destinazione_id, data_destinazione::text,
  richiesta_da_associazione_id, richiesta_da_persona_fisica_id, controparte_associazione_id,
  indisponibilita_id, stato, motivazione_rifiuto, creata_il`;

function daRiga(r: RigaVariazione): Variazione {
  return {
    id: r.id,
    tipo: r.tipo,
    slotId: r.slot_id,
    data: r.data,
    slotDestinazioneId: r.slot_destinazione_id,
    dataDestinazione: r.data_destinazione,
    richiestaDaAssociazioneId: r.richiesta_da_associazione_id,
    richiestaDaPersonaFisicaId: r.richiesta_da_persona_fisica_id,
    controparteAssociazioneId: r.controparte_associazione_id,
    indisponibilitaId: r.indisponibilita_id,
    stato: r.stato,
    motivazioneRifiuto: r.motivazione_rifiuto,
    creataIl: r.creata_il.toISOString(),
  };
}

// Chi "possiede" una fascia in una data specifica: prima le variazioni_ordinarie già
// accettate che toccano quell'occorrenza (come origine o come destinazione), poi
// l'assegnazione permanente del template. Nessuna concatenazione di variazioni sulla
// stessa occorrenza in questo blocco (vincolo UNIQUE su slot_id+data lato origine).
export async function trovaProprietarioOccorrenza(db: Db, slotId: string, data: string): Promise<string | null> {
  const r = await db.query<{
    tipo: TipoVariazione;
    slot_id: string;
    richiesta_da_associazione_id: string;
    controparte_associazione_id: string | null;
  }>(
    `SELECT tipo, slot_id, richiesta_da_associazione_id, controparte_associazione_id
     FROM variazioni_ordinarie
     WHERE stato = 'accettata' AND (
       (slot_id = $1 AND data = $2) OR (slot_destinazione_id = $1 AND data_destinazione = $2)
     )
     LIMIT 1`,
    [slotId, data],
  );
  const v = r.rows[0];
  if (v) {
    if (v.slot_id === slotId) {
      // origine: liberata (nessun proprietario), salvo lo scambio che la assegna alla controparte
      return v.tipo === 'scambio_temporaneo' ? v.controparte_associazione_id : null;
    }
    // destinazione: il richiedente ne diventa proprietario per quella data
    return v.richiesta_da_associazione_id;
  }
  const assegnazione = await db.query<{ associazione_id: string }>(
    `SELECT associazione_id FROM assegnazioni WHERE slot_id = $1 AND stato IN ('provvisoria', 'validata')`,
    [slotId],
  );
  return assegnazione.rows[0]?.associazione_id ?? null;
}

export interface DatiCreaVariazione {
  stagioneId: string;
  tipo: TipoVariazione;
  slotId: string;
  data: string;
  slotDestinazioneId?: string | undefined;
  dataDestinazione?: string | undefined;
  associazioneId: string;
  controparteAssociazioneId?: string | undefined;
  indisponibilitaId?: string | undefined;
}

async function verificaControlliStrutturali(
  db: Db,
  dati: DatiCreaVariazione,
): Promise<string | null> {
  if (dati.tipo === 'liberazione') {
    const proprietario = await trovaProprietarioOccorrenza(db, dati.slotId, dati.data);
    if (proprietario !== dati.associazioneId) {
      return 'la tua associazione non è titolare di questa occorrenza';
    }
    return null;
  }
  // recupero, utilizzo_occasionale, scambio_temporaneo: verificano che la destinazione
  // (slotDestinazioneId per recupero/scambio, slotId stesso per utilizzo_occasionale) sia
  // libera e compatibile per l'associazione che la riceve.
  const slotDaVerificare = dati.tipo === 'utilizzo_occasionale' ? dati.slotId : dati.slotDestinazioneId!;
  const dataDaVerificare = dati.tipo === 'utilizzo_occasionale' ? dati.data : dati.dataDestinazione!;
  const proprietarioDestinazione = await trovaProprietarioOccorrenza(db, slotDaVerificare, dataDaVerificare);
  if (proprietarioDestinazione !== null) {
    return `lo slot di destinazione non è libero in data ${dataDaVerificare}`;
  }
  const disciplina = await controlloDisciplinaCompatibile(db, slotDaVerificare, dati.associazioneId, dati.stagioneId);
  if (!disciplina.ok) {
    return disciplina.motivo!;
  }
  return null;
}

export async function creaVariazione(
  db: Db,
  dati: DatiCreaVariazione,
  richiedentePersonaFisicaId: string,
): Promise<Variazione> {
  const slotIds = [dati.slotId, ...(dati.slotDestinazioneId ? [dati.slotDestinazioneId] : [])];
  await validaSlotAppartengonoAStagione(db, dati.stagioneId, slotIds);

  const statoIniziale = dati.tipo === 'scambio_temporaneo' ? 'in_attesa_accettazione' : null;
  let stato: StatoVariazione;
  let motivazioneRifiuto: string | null = null;
  if (statoIniziale) {
    stato = statoIniziale;
  } else {
    const motivo = await verificaControlliStrutturali(db, dati);
    stato = motivo ? 'rifiutata' : 'accettata';
    motivazioneRifiuto = motivo;
  }

  try {
    const r = await db.query<RigaVariazione>(
      `INSERT INTO variazioni_ordinarie
         (tipo, slot_id, data, slot_destinazione_id, data_destinazione, richiesta_da_associazione_id,
          richiesta_da_persona_fisica_id, controparte_associazione_id, indisponibilita_id, stato, motivazione_rifiuto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${COLONNE_SELECT}`,
      [
        dati.tipo, dati.slotId, dati.data, dati.slotDestinazioneId ?? null, dati.dataDestinazione ?? null,
        dati.associazioneId, richiedentePersonaFisicaId, dati.controparteAssociazioneId ?? null,
        dati.indisponibilitaId ?? null, stato, motivazioneRifiuto,
      ],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    const erroreRiferimento = err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505';
    if (erroreRiferimento) {
      throw new ErroreRiferimentoNonValido('esiste già una variazione attiva su questa occorrenza');
    }
    throw err;
  }
}

export async function trovaVariazionePerId(db: Db, id: string): Promise<Variazione | null> {
  const r = await db.query<RigaVariazione>(`SELECT ${COLONNE_SELECT} FROM variazioni_ordinarie WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}
```

Nota: `verificaControlliStrutturali` per `recupero` non ricontrolla la titolarità dello slot di origine (il testo B.32 lo descrive come compensazione per una perdita già registrata via B.33, non richiede di "possedere" ancora l'occorrenza persa) — assunzione coerente con lo spec.

- [ ] **Step 5: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/variazioni.test.ts`
Expected: PASS (7/7).

- [ ] **Step 6: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/variazioni.ts backend-node/src/variazioni.test.ts backend-node/src/pubblicoSchema.ts
git commit -m "feat(backend): proprietà dell'occorrenza + creazione variazioni ordinarie (art. B.32)"
```

---

### Task 5: Repository `variazioni.ts` — accetta/annulla/lista

**Files:**
- Modify: `backend-node/src/variazioni.ts`
- Modify: `backend-node/src/variazioni.test.ts`

**Interfaces:**
- Consumes: `trovaVariazionePerId`, `controlloDisciplinaCompatibile`, `trovaProprietarioOccorrenza` (Task 4).
- Produces: `accettaVariazione(db: Db, id: string, controparteAssociazioneId: string): Promise<Variazione>`; `annullaVariazione(db: Db, id: string): Promise<Variazione>`; `listaVariazioniPerStagione(db: Db, stagioneId: string, filtri?: {tipo?: TipoVariazione; stato?: StatoVariazione}): Promise<Variazione[]>`. Consumati da Task 6 (route).

- [ ] **Step 1: Scrivi i test**

Aggiungi in fondo a `backend-node/src/variazioni.test.ts`:

```ts
import { accettaVariazione, annullaVariazione, listaVariazioniPerStagione } from './variazioni.ts';
import { ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

test('accettaVariazione: scambio valido transiziona ad accettata, entrambi i lati risultano scambiati', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const proposta = await creaVariazione(
    pool,
    {
      tipo: 'scambio_temporaneo', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2030-11-04', associazioneId: fx.p1.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2030-11-06',
      controparteAssociazioneId: fx.p2.associazioneId,
    },
    fx.p1.personaId,
  );

  const accettata = await accettaVariazione(pool, proposta.id, fx.p2.associazioneId);
  assert.equal(accettata.stato, 'accettata');
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotAId, '2030-11-04'), fx.p2.associazioneId);
  assert.equal(await trovaProprietarioOccorrenza(pool, fx.slotLiberoId, '2030-11-06'), fx.p1.associazioneId);
});

test('accettaVariazione: 409 se non in_attesa_accettazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const variazione = await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2030-11-11', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  await assert.rejects(() => accettaVariazione(pool, variazione.id, fx.p2.associazioneId), ErroreStatoNonValidoPerTransizione);
});

test('annullaVariazione: solo prima dell\'accettazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const proposta = await creaVariazione(
    pool,
    {
      tipo: 'scambio_temporaneo', stagioneId: fx.stagioneId,
      slotId: fx.slotAId, data: '2030-11-18', associazioneId: fx.p1.associazioneId,
      slotDestinazioneId: fx.slotLiberoId, dataDestinazione: '2030-11-20',
      controparteAssociazioneId: fx.p2.associazioneId,
    },
    fx.p1.personaId,
  );
  const annullata = await annullaVariazione(pool, proposta.id);
  assert.equal(annullata.stato, 'annullata');
  await assert.rejects(() => accettaVariazione(pool, proposta.id, fx.p2.associazioneId), ErroreStatoNonValidoPerTransizione);
});

test('listaVariazioniPerStagione filtra per tipo e stato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await creaVariazione(
    pool,
    { tipo: 'utilizzo_occasionale', stagioneId: fx.stagioneId, slotId: fx.slotLiberoId, data: '2030-12-02', associazioneId: fx.p1.associazioneId },
    fx.p1.personaId,
  );
  const lista = await listaVariazioniPerStagione(pool, fx.stagioneId, { tipo: 'utilizzo_occasionale', stato: 'accettata' });
  assert.equal(lista.length, 1);
  const vuota = await listaVariazioniPerStagione(pool, fx.stagioneId, { tipo: 'liberazione' });
  assert.equal(vuota.length, 0);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/variazioni.test.ts`
Expected: FAIL — `accettaVariazione`/`annullaVariazione`/`listaVariazioniPerStagione` non esistono.

- [ ] **Step 3: Scrivi l'implementazione**

Aggiungi in fondo a `backend-node/src/variazioni.ts` (aggiungi `ErroreStatoNonValidoPerTransizione` all'import esistente da `./erroriDominio.ts`):

```ts
// art. B.32: lo scambio è tra le associazioni, l'Ente non interviene — i controlli
// strutturali (disciplina compatibile, occorrenza libera) si eseguono qui, alla
// conferma della controparte, sulla configurazione finale (prima, alla creazione,
// nessun controllo era ancora stato fatto sullo scambio nel suo complesso).
export async function accettaVariazione(db: Db, id: string, controparteAssociazioneId: string): Promise<Variazione> {
  const lock = await db.query<{ stato: StatoVariazione; controparte_associazione_id: string | null }>(
    `SELECT stato, controparte_associazione_id FROM variazioni_ordinarie WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const riga = lock.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('variazione non trovata');
  }
  if (riga.stato !== 'in_attesa_accettazione') {
    throw new ErroreStatoNonValidoPerTransizione('la variazione non è in attesa di accettazione');
  }
  if (riga.controparte_associazione_id !== controparteAssociazioneId) {
    throw new ErroreNonTrovato('questa associazione non è la controparte della variazione');
  }

  const variazione = (await trovaVariazionePerId(db, id))!;
  const motivoOrigine = await verificaControlliStrutturali(db, {
    stagioneId: '', tipo: 'liberazione', slotId: variazione.slotId, data: variazione.data,
    associazioneId: variazione.richiestaDaAssociazioneId,
  });
  const proprietarioDestinazione = await trovaProprietarioOccorrenza(db, variazione.slotDestinazioneId!, variazione.dataDestinazione!);
  const motivo =
    motivoOrigine ??
    (proprietarioDestinazione !== controparteAssociazioneId ? 'la controparte non è più titolare dello slot di destinazione' : null);

  const nuovoStato: StatoVariazione = motivo ? 'rifiutata' : 'accettata';
  await db.query(
    `UPDATE variazioni_ordinarie SET stato = $2, motivazione_rifiuto = $3 WHERE id = $1`,
    [id, nuovoStato, motivo],
  );
  return (await trovaVariazionePerId(db, id))!;
}

export async function annullaVariazione(db: Db, id: string): Promise<Variazione> {
  const r = await db.query<{ id: string }>(
    `UPDATE variazioni_ordinarie SET stato = 'annullata' WHERE id = $1 AND stato = 'in_attesa_accettazione' RETURNING id`,
    [id],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM variazioni_ordinarie WHERE id = $1`, [id]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('variazione non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la variazione non è più annullabile');
  }
  return (await trovaVariazionePerId(db, id))!;
}

export async function listaVariazioniPerStagione(
  db: Db,
  stagioneId: string,
  filtri?: { tipo?: TipoVariazione; stato?: StatoVariazione },
): Promise<Variazione[]> {
  const condizioni: string[] = ['st.stagione_id = $1'];
  const valori: unknown[] = [stagioneId];
  if (filtri?.tipo) {
    valori.push(filtri.tipo);
    condizioni.push(`v.tipo = $${valori.length}`);
  }
  if (filtri?.stato) {
    valori.push(filtri.stato);
    condizioni.push(`v.stato = $${valori.length}`);
  }
  const r = await db.query<RigaVariazione>(
    `SELECT v.id, v.tipo, v.slot_id, v.data::text, v.slot_destinazione_id, v.data_destinazione::text,
            v.richiesta_da_associazione_id, v.richiesta_da_persona_fisica_id, v.controparte_associazione_id,
            v.indisponibilita_id, v.stato, v.motivazione_rifiuto, v.creata_il
     FROM variazioni_ordinarie v
     JOIN slot_settimana_tipo st ON st.id = v.slot_id
     WHERE ${condizioni.join(' AND ')}
     ORDER BY v.creata_il DESC`,
    valori,
  );
  return r.rows.map(daRiga);
}
```

Nota su `accettaVariazione`: `verificaControlliStrutturali` chiamato con `tipo: 'liberazione'` per verificare che il lato origine (`richiestaDaAssociazioneId`) sia ancora titolare della sua occorrenza al momento della conferma (potrebbe essere cambiato tra la creazione e l'accettazione) — riuso della stessa funzione con un `DatiCreaVariazione` parziale costruito ad-hoc, `stagioneId` non serve in quel ramo (usato solo dal controllo disciplina, non eseguito per `tipo:'liberazione'`).

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/variazioni.test.ts`
Expected: PASS (tutti i test del file).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/variazioni.ts backend-node/src/variazioni.test.ts
git commit -m "feat(backend): accetta/annulla/lista variazioni ordinarie (art. B.32)"
```

---

### Task 6: Route variazioni (pubblico + backoffice sola lettura) + test end-to-end

**Files:**
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.variazioni.test.ts`

**Interfaces:**
- Consumes: `creaVariazione`, `accettaVariazione`, `annullaVariazione`, `listaVariazioniPerStagione`, `trovaVariazionePerId` (Task 4-5); `schemaCreaVariazione`, `schemaAccettaVariazione` (Task 4).
- Produces: `POST /pubblico/variazioni`, `POST /pubblico/variazioni/:id/accetta`, `POST /pubblico/variazioni/:id/annulla`, `GET /backoffice/stagioni/:id/variazioni`.

- [ ] **Step 1: Scrivi il test HTTP end-to-end**

Crea `backend-node/src/server.variazioni.test.ts`, stesso harness delle route pubbliche viste nei blocchi precedenti (token pubblico + abilitazione attiva per due associazioni, admin per la coda backoffice):

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
  const email = `var-admin-${randomUUID()}@test.local`;
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
    [`ASD var http ${label} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTVRH${randomUUID().slice(0, 10).toUpperCase()}`;
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
  const disciplina = await creaDisciplina(pool, { codice: `CANOA-${randomUUID().slice(0, 8)}`, denominazione: 'Canoa' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto var http ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra var http', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo var http', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-var-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slotA = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slotB = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 3, orarioInizio: '18:00', orarioFine: '19:00' });

  const p1 = await creaParte(pool, stagioneId, adminId, 'uno');
  const p2 = await creaParte(pool, stagioneId, adminId, 'due');
  const datiDomanda = {
    disciplineCodici: [disciplina.codice], numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1,
    numeroSquadreFederaliStagionePrecedente: 0, attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
    fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000', richiedeGiornataGara: false, richiesteGiornataGara: [],
  };
  const d1 = await creaDomanda(pool, { ...datiDomanda, associazioneId: p1.associazioneId, stagioneId, preferenze: [slotA.id], blocchiAllenamento: [] }, p1.personaId);
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [d1.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slotA.id, d1.id, p1.associazioneId],
  );

  return { stagioneId, slotAId: slotA.id, slotBId: slotB.id, p1, p2 };
}

test('flusso end-to-end: scambio_temporaneo richiesta→accetta, coda backoffice sola lettura', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);

  const rCrea = await fetch(`${base}/pubblico/variazioni`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagioneId: fx.stagioneId, tipo: 'scambio_temporaneo',
      slotId: fx.slotAId, data: '2030-10-07',
      slotDestinazioneId: fx.slotBId, dataDestinazione: '2030-10-09',
      controparteAssociazioneId: fx.p2.associazioneId,
    }),
  });
  assert.equal(rCrea.status, 201);
  const proposta = await rCrea.json();
  assert.equal(proposta.stato, 'in_attesa_accettazione');

  const rAccetta = await fetch(`${base}/pubblico/variazioni/${proposta.id}/accetta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p2.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ associazioneId: fx.p2.associazioneId }),
  });
  assert.equal(rAccetta.status, 200);
  assert.equal((await rAccetta.json()).stato, 'accettata');

  const rCoda = await fetch(`${base}/backoffice/stagioni/${fx.stagioneId}/variazioni`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rCoda.status, 200);
  assert.equal((await rCoda.json()).length, 1);
});

test('403 su creazione senza abilitazione, PUT/POST backoffice su questa risorsa non esiste (solo GET)', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);
  const estraneo = generaAccessTokenPubblico({ sub: randomUUID(), codiceFiscale: 'XXXXXXXXXXX', nome: 'X', cognome: 'Y' });

  const r = await fetch(`${base}/pubblico/variazioni`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${estraneo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagioneId: fx.stagioneId, tipo: 'liberazione', slotId: fx.slotAId, data: '2030-10-07' }),
  });
  assert.equal(r.status, 403);
});

test('POST .../annulla: solo il richiedente, 409 dopo accettazione', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureDueParti(pool, admin.id);

  const rCrea = await fetch(`${base}/pubblico/variazioni`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagioneId: fx.stagioneId, tipo: 'scambio_temporaneo',
      slotId: fx.slotAId, data: '2030-11-04',
      slotDestinazioneId: fx.slotBId, dataDestinazione: '2030-11-06',
      controparteAssociazioneId: fx.p2.associazioneId,
    }),
  });
  const proposta = await rCrea.json();

  const rAnnulla = await fetch(`${base}/pubblico/variazioni/${proposta.id}/annulla`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p1.token}` },
  });
  assert.equal(rAnnulla.status, 200);

  const rAccettaDopo = await fetch(`${base}/pubblico/variazioni/${proposta.id}/accetta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.p2.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ associazioneId: fx.p2.associazioneId }),
  });
  assert.equal(rAccettaDopo.status, 409);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.variazioni.test.ts`
Expected: FAIL — route inesistenti (404).

- [ ] **Step 3: Aggiungi le route in `server.ts`**

Aggiungi gli import:

```ts
import { creaVariazione, accettaVariazione, annullaVariazione, listaVariazioniPerStagione, trovaVariazionePerId } from './variazioni.ts';
import { schemaCreaVariazione, schemaAccettaVariazione } from './pubblicoSchema.ts';
```

(unisci `schemaCreaVariazione`/`schemaAccettaVariazione` con l'import esistente da `./pubblicoSchema.ts` in un solo import multiplo).

Aggiungi le route, dopo il blocco indisponibilità (Task 3):

```ts
  // --- Variazioni ordinarie (art. B.32) — interamente tra associazioni, nessuna
  // validazione backoffice attiva (istruzione esplicita del committente) ---

  app.post(
    '/pubblico/variazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaVariazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, parsed.data.associazioneId, parsed.data.stagioneId);
      if (!delegante) {
        res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
        return;
      }
      try {
        const variazione = await eseguiInTransazione(pool, async (client) => {
          const v = await creaVariazione(client, parsed.data, req.persona!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'crea_variazione_ordinaria',
            entitaTipo: 'variazioni_ordinarie',
            entitaId: v.id,
            dettaglio: v as unknown as Record<string, unknown>,
          });
          return v;
        });
        res.status(201).json(variazione);
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
    '/pubblico/variazioni/:id/accetta',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaAccettaVariazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      const variazione = await trovaVariazionePerId(pool, id);
      if (!variazione) {
        res.status(404).json({ errore: 'variazione non trovata' });
        return;
      }
      const stagione = await pool.query<{ stagione_id: string }>(
        `SELECT stagione_id FROM slot_settimana_tipo WHERE id = $1`,
        [variazione.slotId],
      );
      const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, parsed.data.associazioneId, stagione.rows[0]!.stagione_id);
      if (!delegante) {
        res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
        return;
      }
      try {
        const aggiornata = await eseguiInTransazione(pool, async (client) => {
          const v = await accettaVariazione(client, id, parsed.data.associazioneId);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'accetta_variazione_ordinaria',
            entitaTipo: 'variazioni_ordinarie',
            entitaId: v.id,
            dettaglio: { stato: v.stato, motivazioneRifiuto: v.motivazioneRifiuto },
          });
          return v;
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
    '/pubblico/variazioni/:id/annulla',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const variazione = await trovaVariazionePerId(pool, id);
      if (!variazione) {
        res.status(404).json({ errore: 'variazione non trovata' });
        return;
      }
      if (variazione.richiestaDaPersonaFisicaId !== req.persona!.sub) {
        res.status(403).json({ errore: 'solo il richiedente può annullare la variazione' });
        return;
      }
      try {
        const aggiornata = await eseguiInTransazione(pool, async (client) => {
          const v = await annullaVariazione(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: variazione.richiestaDaAssociazioneId },
            azione: 'annulla_variazione_ordinaria',
            entitaTipo: 'variazioni_ordinarie',
            entitaId: v.id,
            dettaglio: { stato: v.stato },
          });
          return v;
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

  app.get(
    '/backoffice/stagioni/:id/variazioni',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const tipo = typeof req.query.tipo === 'string' ? (req.query.tipo as never) : undefined;
      const stato = typeof req.query.stato === 'string' ? (req.query.stato as never) : undefined;
      res.status(200).json(await listaVariazioniPerStagione(pool, stagioneId, { tipo, stato }));
    },
  );
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.variazioni.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Verifica il typecheck e l'intera suite**

Run: `cd backend-node && pnpm exec tsc`
Expected: nessun errore.

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test "src/**/*.test.ts"` (quotato)
Expected: tutti i test passano, nessuna regressione sul resto della suite.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.variazioni.test.ts backend-node/src/pubblicoSchema.ts
git commit -m "feat(backend): route variazioni ordinarie pubbliche + coda backoffice sola lettura (art. B.32)"
```

---

## Self-Review Notes

- **Spec coverage**: B.33 (Task 2-3: creazione indisponibilità backoffice, lettura pubblica scoped). B.32 (Task 4-6: tutti e 4 i tipi di variazione, proprietà dell'occorrenza, ciclo vita scambio con conferma controparte, coda backoffice sola lettura). Fuori scope confermato: B.34-36 (task futuri).
- **Placeholder scan**: trovato e corretto un placeholder in Task 6 (un frammento di route incompleto con un `500` segnaposto, dovuto a `schemaCreaVariazione` mancante di `associazioneId`). Fix applicato alla fonte: `associazioneId` è ora nello schema fin dal Task 4, Task 6 contiene solo la route finale completa, nessun passaggio intermedio incompleto.
- **Type consistency**: `Variazione`/`TipoVariazione`/`StatoVariazione` definiti in Task 4, usati identici in Task 5-6. `Indisponibilita` (Task 2) usato identico in Task 3.
