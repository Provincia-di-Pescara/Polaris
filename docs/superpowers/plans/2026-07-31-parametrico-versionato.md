# Parametrico versionato Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un admin può leggere la versione parametrica attiva, lo storico versioni, e creare una nuova versione (mai update in place) — oggi i parametri sono scrivibili solo con SQL a mano.

**Architecture:** Nuovo modulo `repository/parametrico.ts` (`leggiVersioneAttiva`, `leggiVersionePerId`, `listaVersioni`, `creaVersione`), 4 route in `server.ts` (`GET /backoffice/parametrico`, `GET /backoffice/parametrico/versioni`, `GET /backoffice/parametrico/versioni/:id`, `POST /backoffice/parametrico`). Nessuna modifica al motore Go: `CaricaParametricoAttivo` legge già `ORDER BY valida_dal DESC LIMIT 1`, una nuova riga con `valida_dal` più recente diventa automaticamente quella attiva.

**Tech Stack:** Node.js 24, TypeScript 7.0.2, Express 5, zod, `pg`, `node --test` contro Postgres 18 reale.

## Global Constraints

- Niente ORM: query SQL parametrizzate dirette.
- Ogni scrittura (`POST`) passa da `registraOperazione` nella stessa transazione via `eseguiInTransazione`.
- Solo `richiedeRuolo('admin')` su tutte e 4 le route — mai `operatore` (governa tutti i calcoli del motore Go).
- **`parametrico_versioni` è la chiave GLOBALE letta da `ORDER BY valida_dal DESC LIMIT 1`** — un test che inserisce una nuova versione la rende "attiva" per QUALUNQUE altro uso dello stesso Postgres condiviso, incluso il motore Go e altri file di test in esecuzione parallela. Gotcha già documentato in `CLAUDE.md` per il motore Go e riscontrato due volte lato Node (chiave singleton `'oidc'` in `impostazioni_sistema`). **Tutti i test di questo blocco che chiamano `creaVersione` devono girare su `testutil/dbDedicato.ts::creaDatabaseDedicato()`, mai sul pool condiviso `TEST_DATABASE_URL` diretto** — non è opzionale, è un requisito da rispettare fin dal primo test scritto, non da scoprire a metà.
- Campi `NUMERIC` rappresentati come **stringa decimale** in TypeScript (mai `number`) — coerente con come `pg` li restituisce di default, evita perdita di precisione sui parametri che il motore Go userà nei calcoli. Campi `INTEGER` restano `number`.
- Campi `TIMESTAMPTZ` (`valida_dal`, `creata_il`) arrivano da `pg` come oggetti `Date` (non stringa) — convertirli esplicitamente con `.toISOString()` nel mapping riga→DTO, mai assegnarli direttamente a un campo tipizzato `string` (gotcha già trovato come minor finding nel blocco precedente, corretto qui fin dall'inizio).
- Mapping errori: 22P02/23503→400 (`comeErroreRiferimentoNonValido`) su `GET /backoffice/parametrico/versioni/:id` (id malformato nel path) e su `POST` (se mai un FK fallisse). Nessun 23505 atteso su questo blocco (nessun vincolo UNIQUE applicabile).
- `POST` richiede **tutti** i 16 campi scalari nel body (nessun merge-on-omit) + `csdScaglioni` (array, può essere vuoto) + `note` opzionale.
- Postgres 18 dev persistente su `localhost:5433`, credenziali `postgres:test`, database `palestre`, schema già applicato. `cd backend-node` prima dei comandi npm/node.
- `exactOptionalPropertyTypes: true`: campi opzionali dichiarati `campo?: T | undefined` esplicito.

---

### Task 1: Repository — lettura versione attiva/storico, creazione nuova versione

**Files:**
- Create: `backend-node/src/repository/parametrico.ts`
- Create: `backend-node/src/repository/parametrico.test.ts`
- Modify: `backend-node/src/backofficeSchema.ts`

**Interfaces:**
- Consumes: `Db` da `../db.ts`.
- Produces:
  - `ScaglioneCsd { rapportoFdFrMin: string; rapportoFdFrMax: string | null; coefficiente: string }`.
  - `VersioneParametrica { id, validaDal: string, pubblicataDa: string | null, note: string | null, moltiplicatoreMinutiPerPunto: string, pesoFasciaPregiata: string, minutiSettimanaliMax: string, slotMaxStessoImpianto: number, fascePregiateMax: number, giornateGaraMax: number, incrementoSquadreNeutro: number, caaNeutro: string, csdNeutro: string, tolleranzaIsfPct: string, sogliaMancatiUtilizziDiffida: number, sogliaMancatiUtilizziDecadenza: number, sogliaScostamentoDichiaratoPct: string, sogliaIsfCompensazione: string, retentionLogOperazioniGiorni: number, quotaNuoveAssociazioniPct: string, creataIl: string, csdScaglioni: ScaglioneCsd[] }`.
  - `VersioneParametricaSintetica { id, validaDal: string, pubblicataDa: string | null, note: string | null }`.
  - `leggiVersioneAttiva(db: Db): Promise<VersioneParametrica | null>`.
  - `leggiVersionePerId(db: Db, id: string): Promise<VersioneParametrica | null>`.
  - `listaVersioni(db: Db): Promise<VersioneParametricaSintetica[]>`.
  - `DatiCreaVersione` (16 campi scalari + `note?: string | undefined` + `csdScaglioni: Array<{rapportoFdFrMin: string; rapportoFdFrMax: string | null; coefficiente: string}>`).
  - `creaVersione(db: Db, dati: DatiCreaVersione, pubblicataDa: string): Promise<VersioneParametrica>`.
  - `schemaCreaVersioneParametrico` (zod) in `backofficeSchema.ts`.

- [ ] **Step 1: Scrivere il test RED**

`backend-node/src/repository/parametrico.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiVersioneAttiva, leggiVersionePerId, listaVersioni, creaVersione, type DatiCreaVersione } from './parametrico.ts';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';

const dsn = process.env.TEST_DATABASE_URL;

const DATI_BASE: DatiCreaVersione = {
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
  csdScaglioni: [
    { rapportoFdFrMin: '0.000', rapportoFdFrMax: '1.000', coefficiente: '1.000' },
    { rapportoFdFrMin: '1.000', rapportoFdFrMax: null, coefficiente: '0.850' },
  ],
};

test(
  'lettura versione attiva/storico + creazione nuova versione con scaglioni CSD',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    // Il DB dedicato ha già la migration 000002/000006 applicata (seed iniziale) —
    // leggiVersioneAttiva deve trovare quella riga prima di qualunque creaVersione.
    await t.test('leggiVersioneAttiva sul seed iniziale', async () => {
      const attiva = await leggiVersioneAttiva(pool);
      assert.ok(attiva);
      assert.equal(attiva!.quotaNuoveAssociazioniPct, '0.0000');
    });

    let nuovaVersioneId = '';

    await t.test('creaVersione: nuova riga, scaglioni collegati correttamente', async () => {
      const versione = await creaVersione(pool, { ...DATI_BASE, note: 'test versione 2' }, 'admin-fittizio-non-fk-verificato');
      assert.equal(versione.note, 'test versione 2');
      assert.equal(versione.csdScaglioni.length, 2);
      assert.equal(versione.csdScaglioni[0]!.coefficiente, '1.000');
      assert.equal(versione.csdScaglioni[1]!.rapportoFdFrMax, null);
      nuovaVersioneId = versione.id;
    });

    await t.test('leggiVersioneAttiva ora ritorna la nuova versione', async () => {
      const attiva = await leggiVersioneAttiva(pool);
      assert.equal(attiva!.id, nuovaVersioneId);
    });

    await t.test('listaVersioni include entrambe, ordinate per valida_dal desc', async () => {
      const lista = await listaVersioni(pool);
      assert.ok(lista.length >= 2);
      assert.equal(lista[0]!.id, nuovaVersioneId);
    });

    await t.test('leggiVersionePerId sulla versione storica (seed iniziale) ritorna i valori congelati', async () => {
      const lista = await listaVersioni(pool);
      const idSeed = lista[lista.length - 1]!.id;
      const storica = await leggiVersionePerId(pool, idSeed);
      assert.ok(storica);
      assert.notEqual(storica!.id, nuovaVersioneId);
    });

    await t.test('leggiVersionePerId su id inesistente ritorna null', async () => {
      const risultato = await leggiVersionePerId(pool, '00000000-0000-0000-0000-000000000000');
      assert.equal(risultato, null);
    });
  },
);
```
Nota: `pubblicataDa: 'admin-fittizio-non-fk-verificato'` nel test violerebbe il FK `parametrico_versioni_pubblicata_da_fk` se non fosse un UUID valido riferito a un utente reale — **correggere prima di eseguire**: creare un utente backoffice reale nel DB dedicato (stesso pattern già usato in `utentiBackoffice.test.ts`) e usarne l'id, oppure passare `null`/omettere se la colonna lo permette (verificare: `pubblicata_da UUID` senza `NOT NULL` nello schema, quindi `null` è valido) — usare `null` è la scelta più semplice per questo test, dato che verificare l'FK non è lo scopo di questo test specifico.

- [ ] **Step 2: Eseguire il test, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/repository/parametrico.test.ts`
Expected: FAIL — modulo `parametrico.ts` non esiste.

- [ ] **Step 3: Implementare `repository/parametrico.ts`**

```ts
import type { Db } from '../db.ts';

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
  creataIl: string;
  csdScaglioni: ScaglioneCsd[];
}

export interface VersioneParametricaSintetica {
  id: string;
  validaDal: string;
  pubblicataDa: string | null;
  note: string | null;
}

interface RigaVersione {
  id: string;
  valida_dal: Date;
  pubblicata_da: string | null;
  note: string | null;
  moltiplicatore_minuti_per_punto: string;
  peso_fascia_pregiata: string;
  minuti_settimanali_max: string;
  slot_max_stesso_impianto: number;
  fasce_pregiate_max: number;
  giornate_gara_max: number;
  incremento_squadre_neutro: number;
  caa_neutro: string;
  csd_neutro: string;
  tolleranza_isf_pct: string;
  soglia_mancati_utilizzi_diffida: number;
  soglia_mancati_utilizzi_decadenza: number;
  soglia_scostamento_dichiarato_pct: string;
  soglia_isf_compensazione: string;
  retention_log_operazioni_giorni: number;
  quota_nuove_associazioni_pct: string;
  creata_il: Date;
}

interface RigaScaglioneCsd {
  rapporto_fd_fr_min: string;
  rapporto_fd_fr_max: string | null;
  coefficiente: string;
}

const COLONNE_SELECT_VERSIONE = `id, valida_dal, pubblicata_da, note,
  moltiplicatore_minuti_per_punto::text, peso_fascia_pregiata::text, minuti_settimanali_max::text,
  slot_max_stesso_impianto, fasce_pregiate_max, giornate_gara_max, incremento_squadre_neutro,
  caa_neutro::text, csd_neutro::text, tolleranza_isf_pct::text,
  soglia_mancati_utilizzi_diffida, soglia_mancati_utilizzi_decadenza,
  soglia_scostamento_dichiarato_pct::text, soglia_isf_compensazione::text,
  retention_log_operazioni_giorni, quota_nuove_associazioni_pct::text, creata_il`;

function daRigaVersione(r: RigaVersione, csdScaglioni: ScaglioneCsd[]): VersioneParametrica {
  return {
    id: r.id,
    validaDal: r.valida_dal.toISOString(),
    pubblicataDa: r.pubblicata_da,
    note: r.note,
    moltiplicatoreMinutiPerPunto: r.moltiplicatore_minuti_per_punto,
    pesoFasciaPregiata: r.peso_fascia_pregiata,
    minutiSettimanaliMax: r.minuti_settimanali_max,
    slotMaxStessoImpianto: r.slot_max_stesso_impianto,
    fascePregiateMax: r.fasce_pregiate_max,
    giornateGaraMax: r.giornate_gara_max,
    incrementoSquadreNeutro: r.incremento_squadre_neutro,
    caaNeutro: r.caa_neutro,
    csdNeutro: r.csd_neutro,
    tolleranzaIsfPct: r.tolleranza_isf_pct,
    sogliaMancatiUtilizziDiffida: r.soglia_mancati_utilizzi_diffida,
    sogliaMancatiUtilizziDecadenza: r.soglia_mancati_utilizzi_decadenza,
    sogliaScostamentoDichiaratoPct: r.soglia_scostamento_dichiarato_pct,
    sogliaIsfCompensazione: r.soglia_isf_compensazione,
    retentionLogOperazioniGiorni: r.retention_log_operazioni_giorni,
    quotaNuoveAssociazioniPct: r.quota_nuove_associazioni_pct,
    creataIl: r.creata_il.toISOString(),
    csdScaglioni,
  };
}

function daRigaScaglione(r: RigaScaglioneCsd): ScaglioneCsd {
  return { rapportoFdFrMin: r.rapporto_fd_fr_min, rapportoFdFrMax: r.rapporto_fd_fr_max, coefficiente: r.coefficiente };
}

async function caricaScaglioniPerVersione(db: Db, versioneId: string): Promise<ScaglioneCsd[]> {
  const r = await db.query<RigaScaglioneCsd>(
    `SELECT rapporto_fd_fr_min::text, rapporto_fd_fr_max::text, coefficiente::text
     FROM csd_scaglioni WHERE parametrico_versione_id = $1 ORDER BY rapporto_fd_fr_min`,
    [versioneId],
  );
  return r.rows.map(daRigaScaglione);
}

export async function leggiVersioneAttiva(db: Db): Promise<VersioneParametrica | null> {
  const r = await db.query<RigaVersione>(
    `SELECT ${COLONNE_SELECT_VERSIONE} FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`,
  );
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return daRigaVersione(riga, await caricaScaglioniPerVersione(db, riga.id));
}

export async function leggiVersionePerId(db: Db, id: string): Promise<VersioneParametrica | null> {
  const r = await db.query<RigaVersione>(`SELECT ${COLONNE_SELECT_VERSIONE} FROM parametrico_versioni WHERE id = $1`, [id]);
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return daRigaVersione(riga, await caricaScaglioniPerVersione(db, riga.id));
}

export async function listaVersioni(db: Db): Promise<VersioneParametricaSintetica[]> {
  const r = await db.query<{ id: string; valida_dal: Date; pubblicata_da: string | null; note: string | null }>(
    `SELECT id, valida_dal, pubblicata_da, note FROM parametrico_versioni ORDER BY valida_dal DESC`,
  );
  return r.rows.map((riga) => ({
    id: riga.id,
    validaDal: riga.valida_dal.toISOString(),
    pubblicataDa: riga.pubblicata_da,
    note: riga.note,
  }));
}

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
  csdScaglioni: Array<{ rapportoFdFrMin: string; rapportoFdFrMax: string | null; coefficiente: string }>;
}

export async function creaVersione(
  db: Db,
  dati: DatiCreaVersione,
  pubblicataDa: string | null,
): Promise<VersioneParametrica> {
  const r = await db.query<RigaVersione>(
    `INSERT INTO parametrico_versioni
       (pubblicata_da, note, moltiplicatore_minuti_per_punto, peso_fascia_pregiata, minuti_settimanali_max,
        slot_max_stesso_impianto, fasce_pregiate_max, giornate_gara_max, incremento_squadre_neutro,
        caa_neutro, csd_neutro, tolleranza_isf_pct, soglia_mancati_utilizzi_diffida,
        soglia_mancati_utilizzi_decadenza, soglia_scostamento_dichiarato_pct, soglia_isf_compensazione,
        retention_log_operazioni_giorni, quota_nuove_associazioni_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING ${COLONNE_SELECT_VERSIONE}`,
    [
      pubblicataDa,
      dati.note ?? null,
      dati.moltiplicatoreMinutiPerPunto,
      dati.pesoFasciaPregiata,
      dati.minutiSettimanaliMax,
      dati.slotMaxStessoImpianto,
      dati.fascePregiateMax,
      dati.giornateGaraMax,
      dati.incrementoSquadreNeutro,
      dati.caaNeutro,
      dati.csdNeutro,
      dati.tolleranzaIsfPct,
      dati.sogliaMancatiUtilizziDiffida,
      dati.sogliaMancatiUtilizziDecadenza,
      dati.sogliaScostamentoDichiaratoPct,
      dati.sogliaIsfCompensazione,
      dati.retentionLogOperazioniGiorni,
      dati.quotaNuoveAssociazioniPct,
    ],
  );
  const versione = r.rows[0]!;
  const scaglioni: ScaglioneCsd[] = [];
  for (const s of dati.csdScaglioni) {
    const rs = await db.query<RigaScaglioneCsd>(
      `INSERT INTO csd_scaglioni (parametrico_versione_id, rapporto_fd_fr_min, rapporto_fd_fr_max, coefficiente)
       VALUES ($1,$2,$3,$4)
       RETURNING rapporto_fd_fr_min::text, rapporto_fd_fr_max::text, coefficiente::text`,
      [versione.id, s.rapportoFdFrMin, s.rapportoFdFrMax, s.coefficiente],
    );
    scaglioni.push(daRigaScaglione(rs.rows[0]!));
  }
  return daRigaVersione(versione, scaglioni);
}
```
Nota sulla firma: `pubblicataDa: string | null` (non solo `string`) per permettere ai test di passare `null` senza dover creare un utente backoffice reale per ogni test — la route HTTP (Task 3) passerà sempre `req.utente!.sub` (mai null in produzione, dato che la route richiede autenticazione).

- [ ] **Step 4: Correggere il test con `pubblicataDa: null` e rieseguire**

Sostituire `'admin-fittizio-non-fk-verificato'` con `null` nella chiamata a `creaVersione` nel test (Step 1).

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/repository/parametrico.test.ts`
Expected: PASS.

- [ ] **Step 5: Aggiungere lo schema zod**

Aggiungere a `backend-node/src/backofficeSchema.ts`:
```ts
const REGEX_DECIMALE = /^\d+(\.\d{1,4})?$/;

export const schemaCsdScaglione = z
  .object({
    rapportoFdFrMin: z.string().regex(REGEX_DECIMALE),
    rapportoFdFrMax: z.string().regex(REGEX_DECIMALE).nullable(),
    coefficiente: z.string().regex(REGEX_DECIMALE),
  })
  .refine((s) => s.rapportoFdFrMax === null || Number(s.rapportoFdFrMax) > Number(s.rapportoFdFrMin), {
    message: 'rapportoFdFrMax deve essere maggiore di rapportoFdFrMin',
    path: ['rapportoFdFrMax'],
  });

export const schemaCreaVersioneParametrico = z.object({
  note: z.string().min(1).optional(),
  moltiplicatoreMinutiPerPunto: z.string().regex(REGEX_DECIMALE),
  pesoFasciaPregiata: z.string().regex(REGEX_DECIMALE),
  minutiSettimanaliMax: z.string().regex(REGEX_DECIMALE),
  slotMaxStessoImpianto: z.number().int().nonnegative(),
  fascePregiateMax: z.number().int().nonnegative(),
  giornateGaraMax: z.number().int().nonnegative(),
  incrementoSquadreNeutro: z.number().int().nonnegative(),
  caaNeutro: z.string().regex(REGEX_DECIMALE),
  csdNeutro: z.string().regex(REGEX_DECIMALE),
  tolleranzaIsfPct: z.string().regex(REGEX_DECIMALE),
  sogliaMancatiUtilizziDiffida: z.number().int().nonnegative(),
  sogliaMancatiUtilizziDecadenza: z.number().int().nonnegative(),
  sogliaScostamentoDichiaratoPct: z.string().regex(REGEX_DECIMALE),
  sogliaIsfCompensazione: z.string().regex(REGEX_DECIMALE),
  retentionLogOperazioniGiorni: z.number().int().nonnegative(),
  quotaNuoveAssociazioniPct: z.string().regex(REGEX_DECIMALE),
  csdScaglioni: z.array(schemaCsdScaglione),
});
export type CreaVersioneParametricoRequest = z.infer<typeof schemaCreaVersioneParametrico>;
```
(`REGEX_DECIMALE` locale a questo blocco di schemi — se un `REGEX_DECIMALE`/`REGEX_ORARIO` con nome simile esistesse già nel file per altri scopi, rinominare per evitare collisione, es. `REGEX_DECIMALE_PARAMETRICO`)

- [ ] **Step 6: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/repository/parametrico.ts backend-node/src/repository/parametrico.test.ts backend-node/src/backofficeSchema.ts
git commit -m "feat(backend): repository parametrico versionato — lettura attiva/storico, creazione nuova versione con scaglioni CSD"
```

---

### Task 2: `GET /backoffice/parametrico`, `GET /backoffice/parametrico/versioni`, `GET /backoffice/parametrico/versioni/:id`

**Files:**
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.parametrico.test.ts`

**Interfaces:**
- Consumes: `leggiVersioneAttiva`, `leggiVersionePerId`, `listaVersioni` da `./repository/parametrico.ts` (Task 1).
- Produces: route `GET /backoffice/parametrico`, `GET /backoffice/parametrico/versioni`, `GET /backoffice/parametrico/versioni/:id`.

- [ ] **Step 1: Scrivere gli scenari HTTP RED**

`backend-node/src/server.parametrico.test.ts` (nuovo file — **DB dedicato obbligatorio**, vedi Global Constraints):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaVersione } from './repository/parametrico.ts';

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
  const email = `parametrico-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Parametrico', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/parametrico, /versioni, /versioni/:id',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteTest(pool, 'admin');
    const operatore = await creaUtenteTest(pool, 'operatore');

    await t.test('operatore: 403 su tutte e 3', async () => {
      const r1 = await fetch(`${base}/backoffice/parametrico`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r1.status, 403);
      const r2 = await fetch(`${base}/backoffice/parametrico/versioni`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r2.status, 403);
      const r3 = await fetch(`${base}/backoffice/parametrico/versioni/${randomUUID()}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r3.status, 403);
    });

    await t.test('admin: GET attivo ritorna il seed iniziale', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { quotaNuoveAssociazioniPct: string; csdScaglioni: unknown[] };
      assert.equal(body.quotaNuoveAssociazioniPct, '0.0000');
      assert.ok(Array.isArray(body.csdScaglioni));
    });

    let secondaVersioneId = '';

    await t.test('crea una seconda versione via repository, poi GET attivo la ritorna', async () => {
      const versione = await creaVersione(
        pool,
        {
          moltiplicatoreMinutiPerPunto: '60.000',
          pesoFasciaPregiata: '1.500',
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
          csdScaglioni: [],
        },
        admin.id,
      );
      secondaVersioneId = versione.id;

      const r = await fetch(`${base}/backoffice/parametrico`, { headers: { Authorization: `Bearer ${admin.token}` } });
      const body = (await r.json()) as { id: string; pesoFasciaPregiata: string };
      assert.equal(body.id, secondaVersioneId);
      assert.equal(body.pesoFasciaPregiata, '1.500');
    });

    await t.test('GET /versioni: lista entrambe, la più recente prima', async () => {
      const r = await fetch(`${base}/backoffice/parametrico/versioni`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 200);
      const lista = (await r.json()) as Array<{ id: string }>;
      assert.ok(lista.length >= 2);
      assert.equal(lista[0]!.id, secondaVersioneId);
    });

    await t.test('GET /versioni/:id sulla versione appena creata', async () => {
      const r = await fetch(`${base}/backoffice/parametrico/versioni/${secondaVersioneId}`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { pesoFasciaPregiata: string };
      assert.equal(body.pesoFasciaPregiata, '1.500');
    });

    await t.test('GET /versioni/:id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/parametrico/versioni/${randomUUID()}`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 404);
    });

    await t.test('GET /versioni/:id malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/parametrico/versioni/non-un-uuid`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 400);
    });
  },
);
```

- [ ] **Step 2: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.parametrico.test.ts`
Expected: FAIL — 404 sulle rotte non wired.

- [ ] **Step 3: Wire delle route in `server.ts`**

Import da aggiungere:
```ts
import { leggiVersioneAttiva, leggiVersionePerId, listaVersioni } from './repository/parametrico.ts';
```

Route (dopo l'ultima route esistente, prima di `return app; }`):
```ts
  app.get('/backoffice/parametrico', richiedeAutenticazione, richiedeRuolo('admin'), async (_req, res) => {
    try {
      const versione = await leggiVersioneAttiva(pool);
      if (!versione) {
        res.status(404).json({ errore: 'nessuna versione parametrica trovata' });
        return;
      }
      res.status(200).json(versione);
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/parametrico/versioni', richiedeAutenticazione, richiedeRuolo('admin'), async (_req, res) => {
    try {
      res.status(200).json(await listaVersioni(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/parametrico/versioni/:id', richiedeAutenticazione, richiedeRuolo('admin'), async (req, res) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const versione = await leggiVersionePerId(pool, id);
      if (!versione) {
        res.status(404).json({ errore: 'versione non trovata' });
        return;
      }
      res.status(200).json(versione);
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
Nota: `GET /backoffice/parametrico` fisso su `pool` (non serve `client`, nessuna transazione — sola lettura), stesso pattern delle altre GET del progetto.

- [ ] **Step 4: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.parametrico.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.parametrico.test.ts
git commit -m "feat(backend): GET /backoffice/parametrico, /versioni, /versioni/:id"
```

---

### Task 3: `POST /backoffice/parametrico`

**Files:**
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/server.parametrico.test.ts`

**Interfaces:**
- Consumes: `creaVersione` da `./repository/parametrico.ts` (Task 1); `schemaCreaVersioneParametrico` da `./backofficeSchema.ts` (Task 1).
- Produces: route `POST /backoffice/parametrico`.

- [ ] **Step 1: Scrivere gli scenari HTTP RED**

Aggiungere a `backend-node/src/server.parametrico.test.ts` un nuovo blocco `test(...)`:
```ts
test(
  'POST /backoffice/parametrico: crea nuova versione, audit log, validazione',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteTest(pool, 'admin');
    const operatore = await creaUtenteTest(pool, 'operatore');

    const DATI_VALIDI = {
      note: 'nuova versione via HTTP',
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
      csdScaglioni: [{ rapportoFdFrMin: '0.000', rapportoFdFrMax: null, coefficiente: '1.000' }],
    };

    await t.test('operatore: 403', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify(DATI_VALIDI),
      });
      assert.equal(r.status, 403);
    });

    await t.test('admin, campo mancante: 400', async () => {
      const { pesoFasciaPregiata, ...senzaCampo } = DATI_VALIDI;
      void pesoFasciaPregiata;
      const r = await fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify(senzaCampo),
      });
      assert.equal(r.status, 400);
    });

    await t.test('admin, scaglione con rapportoFdFrMax <= min: 400', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ ...DATI_VALIDI, csdScaglioni: [{ rapportoFdFrMin: '1.000', rapportoFdFrMax: '0.500', coefficiente: '1.000' }] }),
      });
      assert.equal(r.status, 400);
    });

    let nuovaVersioneId = '';

    await t.test('admin, dati validi: 201, nuova versione persistita, audit log scritto', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify(DATI_VALIDI),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; note: string; pubblicataDa: string };
      assert.equal(body.note, 'nuova versione via HTTP');
      assert.equal(body.pubblicataDa, admin.id);
      nuovaVersioneId = body.id;

      const log = await pool.query(
        `SELECT azione, entita_id FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'crea_versione_parametrico'`,
        [admin.id],
      );
      assert.equal(log.rows.length, 1);
      assert.equal(log.rows[0]?.entita_id, nuovaVersioneId);
    });

    await t.test('GET attivo ora ritorna la versione appena creata via HTTP', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, { headers: { Authorization: `Bearer ${admin.token}` } });
      const body = (await r.json()) as { id: string };
      assert.equal(body.id, nuovaVersioneId);
    });
  },
);
```

- [ ] **Step 2: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.parametrico.test.ts`
Expected: FAIL — 404 sulla rotta non wired.

- [ ] **Step 3: Wire della route in `server.ts`**

Import da aggiungere: `creaVersione` alla riga di import esistente da `./repository/parametrico.ts`; `schemaCreaVersioneParametrico` alla riga da `./backofficeSchema.ts`.

Route:
```ts
  app.post(
    '/backoffice/parametrico',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaVersioneParametrico.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const versione = await eseguiInTransazione(pool, async (client) => {
          const v = await creaVersione(client, parsed.data, req.utente!.sub);
          const { csdScaglioni, ...dettaglioSenzaScaglioni } = v;
          void csdScaglioni;
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_versione_parametrico',
            entitaTipo: 'parametrico_versioni',
            entitaId: v.id,
            dettaglio: dettaglioSenzaScaglioni as unknown as Record<string, unknown>,
          });
          return v;
        });
        res.status(201).json(versione);
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

  return app;
}
```
(sostituisce il precedente `return app; }` in fondo al file — questa è l'ultima route del blocco)

- [ ] **Step 4: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.parametrico.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```
Expected: pulito, nessuna regressione su nessuno dei file esistenti.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.parametrico.test.ts
git commit -m "feat(backend): POST /backoffice/parametrico (crea nuova versione, mai update in place)"
```

---

### Task 4: Aggiornare la documentazione di progetto

**Files:**
- Modify: `docs/SPEC.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Aggiornare `docs/SPEC.md`**

Nella sezione Fase 4, item 3, aggiungere che anche "parametrico versionato" è ora fatto (chiude la parte admin decisa col committente prima del Flusso pubblico blocco 2/4): 4 endpoint, append-only, nessuna modifica al motore Go. Nella sezione "5. Contratto API", spostare `GET /backoffice/parametrico`, `GET /backoffice/parametrico/versioni`, `GET /backoffice/parametrico/versioni/:id`, `POST /backoffice/parametrico` da "Previste" a "Esistenti".

- [ ] **Step 2: Aggiornare `CLAUDE.md`**

Nella sezione "Backend Node", dopo il blocco "Fatto — CRUD utenti backoffice", aggiungere un blocco "Fatto — Parametrico versionato" che descrive: `repository/parametrico.ts`, i 4 endpoint, rappresentazione decimal-come-stringa (e perché), `csd_scaglioni` collegata via FK, nessuna modifica al motore Go, CRS/CAA/incremento-squadre esplicitamente fuori scope (tabelle normative globali non versionate). Includere eventuali gotcha reali incontrati (da scrivere quando effettivamente trovati).

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md CLAUDE.md
git commit -m "docs: mark parametrico versionato block done, closes admin part of Fase 4"
```

---

## Self-Review (fatto in fase di scrittura del piano)

**Copertura spec**: GET attivo ✅ (Task 2), GET storico ✅ (Task 2), GET storico per id ✅ (Task 2), POST nuova versione con tutti i campi obbligatori ✅ (Task 1/3), rappresentazione decimal-come-stringa ✅ (Task 1, applicata fin dall'inizio), CSD scaglioni collegati ✅ (Task 1), audit log ✅ (Task 3), 403 operatore su tutte e 4 ✅ (Task 2/3), nessuna modifica al motore Go ✅ (verificato in fase di design, nessun task lo tocca).

**Placeholder**: nessun TBD/TODO nei passi di codice. La correzione del `pubblicataDa` fittizio nel test del Task 1 (Step 1→Step 4) è intenzionale: lo Step 1 mostra il test come prima bozza, lo Step 4 lo corregge esplicitamente con motivazione — non un'ambiguità lasciata aperta.

**Coerenza tipi**: `VersioneParametrica`/`ScaglioneCsd`/`DatiCreaVersione` definiti una sola volta nel Task 1 e riusati identici nei Task 2-3. `creaVersione` firmata `pubblicataDa: string | null` fin dal Task 1, coerente sia con l'uso nei test (Task 1/2, `null`) sia con l'uso nella route HTTP (Task 3, sempre `req.utente!.sub`, mai null in pratica ma il tipo lo ammette per i test).
