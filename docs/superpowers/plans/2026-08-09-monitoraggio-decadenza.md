# Monitoraggio utilizzo effettivo + escalation mancato utilizzo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare la rilevazione dell'utilizzo effettivo delle fasce assegnate (art. B.34, solo modalità "registro impianto"), l'escalation graduata sul mancato utilizzo non giustificato con ciclo di giustificazione a due fasi e provvedimenti diffida/decadenza (art. B.35), e lo storico interrogabile per la trasparenza (art. B.36, senza aggancio al calcolo dei coefficienti — rimandato alla taratura CSD, Fase 7).

**Architettura:** Due repository Node nuovi (`utilizziEffettivi.ts`, `provvedimenti.ts`) sullo schema già esistente dalla Fase 1 (`utilizzi_effettivi`, `provvedimenti_mancato_utilizzo`), estesi con una migration per il ciclo di giustificazione e un nuovo parametro versionato. Nessuna modifica al motore Go, nessuna modifica alla UI.

**Tech Stack:** Node.js 24 + TypeScript 7 (`.ts` nativo), `pg` diretto senza ORM, `zod` per validazione HTTP, `node --test` contro Postgres reale.

## Global Constraints

- Tutti i valori NUMERIC/data letti da Postgres sempre con `::text`, mai binding numerico diretto.
- Ogni scrittura passa da `registraOperazione` (art. B.39) dentro `eseguiInTransazione`.
- Ogni route nuova mappa `ErroreNonTrovato`→404, `ErroreStatoNonValidoPerTransizione`→409, `comeErroreRiferimentoNonValido`→400, altrimenti 500 — inclusi i pre-flight lookup (spostarli dentro il `try`, mai prima) e le GET-by-id: un UUID malformato deve sempre tornare 400, mai un 500 grezzo (lezione della final review del blocco precedente, art. B.32-33).
- Autorizzazione pubblica sempre scoped per stagione quando la persona agisce su una risorsa che appartiene a una stagione specifica — mai una query che accetta un'abilitazione di una stagione diversa da quella della risorsa.
- Test sempre con `TEST_DATABASE_URL`, skip pulito se assente, fixture con suffissi `randomUUID()` per unicità su Postgres persistente condiviso.
- B.34: in questo blocco solo `rilevato_tramite = 'registro_impianto'` (autodichiarazione/check-in digitale rimandati, schema già pronto per estenderli).
- B.36: solo storico interrogabile, nessuna modifica al motore Go, nessun aggancio a CSD/coefficienti.
- Nessuna modifica alla UI (Fase 5, non esiste ancora).

---

## File Structure

- **Create** `db/migrations/000015_monitoraggio_utilizzo.up.sql` / `.down.sql`.
- **Modify** `backend-node/src/repository/parametrico.ts` — campo `termineGiustificazioneGiorni`.
- **Modify** `backend-node/src/backofficeSchema.ts` — `schemaCreaVersioneParametrico` esteso, più `schemaRegistraUtilizzo`, `schemaRigettaGiustificazione`, `schemaCreaProvvedimento`.
- **Modify** `backend-node/src/pubblicoSchema.ts` — `schemaPresentaGiustificazione`.
- **Modify** `backend-node/src/repository/parametrico.test.ts`, `backend-node/src/server.parametrico.test.ts` — fixture aggiornate col nuovo campo.
- **Create** `backend-node/src/utilizziEffettivi.ts` — repository B.34/B.35.
- **Create** `backend-node/src/utilizziEffettivi.test.ts`.
- **Create** `backend-node/src/provvedimenti.ts` — repository B.35 (provvedimenti + coda + decadenza).
- **Create** `backend-node/src/provvedimenti.test.ts`.
- **Modify** `backend-node/src/server.ts` — route backoffice (registrazione utilizzi, giustificazione, coda, provvedimenti) e pubblico (giustificazione, lettura storico).
- **Create** `backend-node/src/server.utilizziEffettivi.test.ts`.
- **Create** `backend-node/src/server.provvedimenti.test.ts`.

---

### Task 1: Migration — ciclo di giustificazione + parametro finestra

**Files:**
- Create: `db/migrations/000015_monitoraggio_utilizzo.up.sql`
- Create: `db/migrations/000015_monitoraggio_utilizzo.down.sql`

**Interfaces:**
- Produces: colonna `parametrico_versioni.termine_giustificazione_giorni`; colonne `utilizzi_effettivi.giustificazione_{scade_il,testo,presentata_il,decisa_da,decisa_il,motivazione_rigetto}` — usate da Task 2-5.

- [ ] **Step 1: Scrivi la migration up**

```sql
ALTER TABLE parametrico_versioni
  ADD COLUMN termine_giustificazione_giorni INTEGER NOT NULL DEFAULT 7;

ALTER TABLE utilizzi_effettivi
  ADD COLUMN giustificazione_scade_il TIMESTAMPTZ,
  ADD COLUMN giustificazione_testo TEXT,
  ADD COLUMN giustificazione_presentata_il TIMESTAMPTZ,
  ADD COLUMN giustificazione_decisa_da UUID REFERENCES utenti_backoffice(id),
  ADD COLUMN giustificazione_decisa_il TIMESTAMPTZ,
  ADD COLUMN giustificazione_motivazione_rigetto TEXT;
```

Salva in `db/migrations/000015_monitoraggio_utilizzo.up.sql`.

- [ ] **Step 2: Scrivi la migration down**

```sql
ALTER TABLE utilizzi_effettivi
  DROP COLUMN giustificazione_motivazione_rigetto,
  DROP COLUMN giustificazione_decisa_il,
  DROP COLUMN giustificazione_decisa_da,
  DROP COLUMN giustificazione_presentata_il,
  DROP COLUMN giustificazione_testo,
  DROP COLUMN giustificazione_scade_il;

ALTER TABLE parametrico_versioni
  DROP COLUMN termine_giustificazione_giorni;
```

Salva in `db/migrations/000015_monitoraggio_utilizzo.down.sql`.

- [ ] **Step 3: Verifica contro Postgres reale**

Applica la migration sul Postgres di sviluppo persistente (`pg-palestre-dev`, porta mappata `5433` — se il container non esiste, vedi CLAUDE.md sezione "Se `pg-palestre-dev` non esiste" per ricrearlo e applicare tutte le migration precedenti prima di questa):

```bash
docker cp db/migrations/000015_monitoraggio_utilizzo.up.sql pg-palestre-dev:/tmp/000015.up.sql
docker exec pg-palestre-dev psql -U postgres -d palestre -v ON_ERROR_STOP=1 -f /tmp/000015.up.sql
docker exec pg-palestre-dev psql -U postgres -d palestre -c "\d parametrico_versioni"
docker exec pg-palestre-dev psql -U postgres -d palestre -c "\d utilizzi_effettivi"
```

Expected: `parametrico_versioni` mostra `termine_giustificazione_giorni` con default 7; `utilizzi_effettivi` mostra le 6 nuove colonne. Non applicare la `.down.sql` qui — il Postgres persistente resta con lo schema aggiornato per i task successivi.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/000015_monitoraggio_utilizzo.up.sql db/migrations/000015_monitoraggio_utilizzo.down.sql
git commit -m "feat(db): aggiungi ciclo di giustificazione mancato utilizzo + parametro finestra (art. B.34-35)"
```

---

### Task 2: Parametro `termineGiustificazioneGiorni` end-to-end

**Files:**
- Modify: `backend-node/src/repository/parametrico.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/repository/parametrico.test.ts`
- Modify: `backend-node/src/server.parametrico.test.ts`

**Interfaces:**
- Produces: `VersioneParametrica.termineGiustificazioneGiorni: number`, `DatiCreaVersione.termineGiustificazioneGiorni: number` — usati da Task 3 (`registraUtilizzo`) e Task 5 (`codaMancatiUtilizzi`).

Il campo `termineGiustificazioneGiorni` (🔺 parametro placeholder, default 7 giorni) segue esattamente lo stesso trattamento di `retentionLogOperazioniGiorni` (già presente): letto/scritto come intero, nessun `::text` necessario (non è NUMERIC), obbligatorio nella creazione di una nuova versione (nessun default lato API — l'admin lo specifica sempre esplicitamente, coerente con tutti gli altri campi di `DatiCreaVersione`).

- [ ] **Step 1: Estendi l'interfaccia e la mappatura in `repository/parametrico.ts`**

In `VersioneParametrica`, aggiungi il campo subito dopo `quotaNuoveAssociazioniPct`:

```ts
  quotaNuoveAssociazioniPct: string;
  termineGiustificazioneGiorni: number;
  creataIl: string;
```

In `RigaVersione`, stessa posizione:

```ts
  quota_nuove_associazioni_pct: string;
  termine_giustificazione_giorni: number;
  creata_il: Date;
```

In `COLONNE_SELECT_VERSIONE`, aggiungi `termine_giustificazione_giorni` subito dopo `quota_nuove_associazioni_pct::text`:

```ts
const COLONNE_SELECT_VERSIONE = `id, valida_dal, pubblicata_da, note,
  moltiplicatore_minuti_per_punto::text, peso_fascia_pregiata::text, minuti_settimanali_max::text,
  slot_max_stesso_impianto, fasce_pregiate_max, giornate_gara_max, incremento_squadre_neutro,
  caa_neutro::text, csd_neutro::text, tolleranza_isf_pct::text,
  soglia_mancati_utilizzi_diffida, soglia_mancati_utilizzi_decadenza,
  soglia_scostamento_dichiarato_pct::text, soglia_isf_compensazione::text,
  retention_log_operazioni_giorni, quota_nuove_associazioni_pct::text, termine_giustificazione_giorni, creata_il`;
```

In `daRigaVersione`, aggiungi subito dopo `quotaNuoveAssociazioniPct: r.quota_nuove_associazioni_pct,`:

```ts
    quotaNuoveAssociazioniPct: r.quota_nuove_associazioni_pct,
    termineGiustificazioneGiorni: r.termine_giustificazione_giorni,
    creataIl: r.creata_il.toISOString(),
```

In `DatiCreaVersione`, aggiungi subito dopo `quotaNuoveAssociazioniPct: string;`:

```ts
  quotaNuoveAssociazioniPct: string;
  termineGiustificazioneGiorni: number;
  csdScaglioni: Array<{ rapportoFdFrMin: string; rapportoFdFrMax: string | null; coefficiente: string }>;
```

- [ ] **Step 2: Estendi l'INSERT in `creaVersione`**

Sostituisci la query `INSERT` (colonne, placeholder, e array `VALUES`) in `creaVersione`:

```ts
  const r = await db.query<RigaVersione>(
    `INSERT INTO parametrico_versioni
       (pubblicata_da, note, moltiplicatore_minuti_per_punto, peso_fascia_pregiata, minuti_settimanali_max,
        slot_max_stesso_impianto, fasce_pregiate_max, giornate_gara_max, incremento_squadre_neutro,
        caa_neutro, csd_neutro, tolleranza_isf_pct, soglia_mancati_utilizzi_diffida,
        soglia_mancati_utilizzi_decadenza, soglia_scostamento_dichiarato_pct, soglia_isf_compensazione,
        retention_log_operazioni_giorni, quota_nuove_associazioni_pct, termine_giustificazione_giorni)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
      dati.termineGiustificazioneGiorni,
    ],
  );
```

- [ ] **Step 3: Aggiungi il campo allo schema zod in `backofficeSchema.ts`**

In `schemaCreaVersioneParametrico`, aggiungi subito dopo `quotaNuoveAssociazioniPct: z.string().regex(REGEX_RAPPORTO_01),`:

```ts
    quotaNuoveAssociazioniPct: z.string().regex(REGEX_RAPPORTO_01),
    // 🔺 placeholder, default 7gg — nessun valore fisso nella norma (analogo al "termine
    // indicato nell'avviso" di B.11), editabile dall'admin come ogni altro parametro.
    termineGiustificazioneGiorni: z.number().int().min(1),
    csdScaglioni: z.array(schemaCsdScaglione),
```

- [ ] **Step 4: Aggiorna le fixture di test esistenti**

Esegui `grep -n "quotaNuoveAssociazioniPct: '0.0000',"` su `backend-node/src/repository/parametrico.test.ts` e `backend-node/src/server.parametrico.test.ts`. Ogni occorrenza trovata è un letterale `DatiCreaVersione`/corpo POST che ora richiede il nuovo campo obbligatorio: aggiungi `termineGiustificazioneGiorni: 7,` sulla riga subito successiva a ciascuna occorrenza, con la stessa indentazione della riga `quotaNuoveAssociazioniPct` che la precede. In `server.parametrico.test.ts` ci sono 3 occorrenze (una dentro una chiamata diretta a `creaVersione`, due dentro costanti `DATI_VALIDI`); in `repository/parametrico.test.ts` c'è 1 occorrenza (`DATI_BASE`). Nessun'altra modifica a questi file.

- [ ] **Step 5: Esegui i test esistenti, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/repository/parametrico.test.ts src/server.parametrico.test.ts`
Expected: PASS, stesso numero di test di prima (nessuna regressione, il campo è ora popolato in ogni fixture esistente).

- [ ] **Step 6: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc` se `pnpm` non è in PATH)
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/repository/parametrico.ts backend-node/src/backofficeSchema.ts backend-node/src/repository/parametrico.test.ts backend-node/src/server.parametrico.test.ts
git commit -m "feat(backend): espone termineGiustificazioneGiorni nel parametrico versionato (art. B.34-35)"
```

---

### Task 3: Repository `utilizziEffettivi.ts` — registrazione e lettura

**Files:**
- Create: `backend-node/src/utilizziEffettivi.ts`
- Create: `backend-node/src/utilizziEffettivi.test.ts`

**Interfaces:**
- Consumes: `Db`; `leggiVersioneAttiva` (da `./repository/parametrico.ts`, già esteso da Task 2 con `termineGiustificazioneGiorni`).
- Produces: `interface UtilizzoEffettivo { id, assegnazioneId, data, esito, rilevatoTramite, note, registratoIl, giustificazioneScadeIl, giustificazioneTesto, giustificazionePresentataIl, giustificazioneDecisaDa, giustificazioneDecisaIl, giustificazioneMotivazioneRigetto }`; `registraUtilizzo(db, dati): Promise<UtilizzoEffettivo>`; `trovaUtilizzoPerId(db, id): Promise<UtilizzoEffettivo | null>`; `listaUtilizziPerAssegnazione(db, assegnazioneId): Promise<UtilizzoEffettivo[]>`; `listaUtilizziPerAssociazione(db, associazioneId, stagioneId?): Promise<UtilizzoEffettivo[]>`. Consumati da Task 4 (giustificazione), Task 6-8 (route).

- [ ] **Step 1: Scrivi il test repository**

Crea `backend-node/src/utilizziEffettivi.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { registraUtilizzo, trovaUtilizzoPerId, listaUtilizziPerAssegnazione, listaUtilizziPerAssociazione } from './utilizziEffettivi.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `NUOTO-${randomUUID().slice(0, 8)}`, denominazione: 'Nuoto' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto util ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra util', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Vasca util', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-util-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD util ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Util', $2, 'spid') RETURNING id`,
    [`TSTUTL${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
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
  const assegnazione = await pool.query<{ id: string }>(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria') RETURNING id`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  return { stagioneId, assegnazioneId: assegnazione.rows[0]!.id, associazioneId: associazione.rows[0]!.id };
}

test('registraUtilizzo con esito utilizzato: nessuna finestra di giustificazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'utilizzato' });
  assert.equal(utilizzo.esito, 'utilizzato');
  assert.equal(utilizzo.rilevatoTramite, 'registro_impianto');
  assert.equal(utilizzo.giustificazioneScadeIl, null);
});

test('registraUtilizzo con esito non_utilizzato_non_giustificato: apre la finestra di giustificazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const prima = new Date();
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato', note: 'nessuno presente' });
  assert.equal(utilizzo.esito, 'non_utilizzato_non_giustificato');
  assert.ok(utilizzo.giustificazioneScadeIl !== null);
  const scadeIl = new Date(utilizzo.giustificazioneScadeIl!);
  const attesaMinimaMs = 6 * 24 * 60 * 60 * 1000; // termine di default (7gg) meno un margine
  assert.ok(scadeIl.getTime() - prima.getTime() > attesaMinimaMs);
});

test('trovaUtilizzoPerId: null se non esiste', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  assert.equal(await trovaUtilizzoPerId(pool, randomUUID()), null);
});

test('listaUtilizziPerAssegnazione e listaUtilizziPerAssociazione trovano il record registrato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'utilizzato' });

  const perAssegnazione = await listaUtilizziPerAssegnazione(pool, fx.assegnazioneId);
  assert.equal(perAssegnazione.length, 1);

  const perAssociazione = await listaUtilizziPerAssociazione(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(perAssociazione.length, 1);
  assert.equal(perAssociazione[0]!.assegnazioneId, fx.assegnazioneId);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/utilizziEffettivi.test.ts`
Expected: FAIL — `Cannot find module './utilizziEffettivi.ts'`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `backend-node/src/utilizziEffettivi.ts`:

```ts
import type { Db } from './db.ts';
import { leggiVersioneAttiva } from './repository/parametrico.ts';

export type EsitoUtilizzo = 'utilizzato' | 'non_utilizzato_giustificato' | 'non_utilizzato_non_giustificato' | 'indisponibilita_impianto';
export type RilevatoTramite = 'registro_impianto' | 'autodichiarazione' | 'checkin_digitale';

export interface UtilizzoEffettivo {
  id: string;
  assegnazioneId: string;
  data: string;
  esito: EsitoUtilizzo;
  rilevatoTramite: RilevatoTramite;
  note: string | null;
  registratoIl: string;
  giustificazioneScadeIl: string | null;
  giustificazioneTesto: string | null;
  giustificazionePresentataIl: string | null;
  giustificazioneDecisaDa: string | null;
  giustificazioneDecisaIl: string | null;
  giustificazioneMotivazioneRigetto: string | null;
}

interface RigaUtilizzo {
  id: string;
  assegnazione_id: string;
  data: string;
  esito: EsitoUtilizzo;
  rilevato_tramite: RilevatoTramite;
  note: string | null;
  registrato_il: Date;
  giustificazione_scade_il: Date | null;
  giustificazione_testo: string | null;
  giustificazione_presentata_il: Date | null;
  giustificazione_decisa_da: string | null;
  giustificazione_decisa_il: Date | null;
  giustificazione_motivazione_rigetto: string | null;
}

const COLONNE_SELECT = `id, assegnazione_id, data::text, esito, rilevato_tramite, note, registrato_il,
  giustificazione_scade_il, giustificazione_testo, giustificazione_presentata_il,
  giustificazione_decisa_da, giustificazione_decisa_il, giustificazione_motivazione_rigetto`;

function daRiga(r: RigaUtilizzo): UtilizzoEffettivo {
  return {
    id: r.id,
    assegnazioneId: r.assegnazione_id,
    data: r.data,
    esito: r.esito,
    rilevatoTramite: r.rilevato_tramite,
    note: r.note,
    registratoIl: r.registrato_il.toISOString(),
    giustificazioneScadeIl: r.giustificazione_scade_il ? r.giustificazione_scade_il.toISOString() : null,
    giustificazioneTesto: r.giustificazione_testo,
    giustificazionePresentataIl: r.giustificazione_presentata_il ? r.giustificazione_presentata_il.toISOString() : null,
    giustificazioneDecisaDa: r.giustificazione_decisa_da,
    giustificazioneDecisaIl: r.giustificazione_decisa_il ? r.giustificazione_decisa_il.toISOString() : null,
    giustificazioneMotivazioneRigetto: r.giustificazione_motivazione_rigetto,
  };
}

export interface DatiRegistraUtilizzo {
  assegnazioneId: string;
  data: string;
  esito: EsitoUtilizzo;
  note?: string | undefined;
}

// art. B.34/B.35: la richiesta di giustificazione (primo passo della scala graduata) è
// implicita nella registrazione stessa di un esito 'non_utilizzato_non_giustificato' — non
// un atto separato. La finestra dura termine_giustificazione_giorni (parametrico attivo,
// 🔺 default 7gg) a partire da ORA, non dalla data dell'occorrenza mancata.
export async function registraUtilizzo(db: Db, dati: DatiRegistraUtilizzo): Promise<UtilizzoEffettivo> {
  let scadeIl: Date | null = null;
  if (dati.esito === 'non_utilizzato_non_giustificato') {
    const parametrico = await leggiVersioneAttiva(db);
    if (!parametrico) {
      throw new Error('nessuna versione parametrica attiva');
    }
    scadeIl = new Date(Date.now() + parametrico.termineGiustificazioneGiorni * 24 * 60 * 60 * 1000);
  }
  const r = await db.query<RigaUtilizzo>(
    `INSERT INTO utilizzi_effettivi (assegnazione_id, data, esito, rilevato_tramite, note, giustificazione_scade_il)
     VALUES ($1, $2, $3, 'registro_impianto', $4, $5)
     RETURNING ${COLONNE_SELECT}`,
    [dati.assegnazioneId, dati.data, dati.esito, dati.note ?? null, scadeIl],
  );
  return daRiga(r.rows[0]!);
}

export async function trovaUtilizzoPerId(db: Db, id: string): Promise<UtilizzoEffettivo | null> {
  const r = await db.query<RigaUtilizzo>(`SELECT ${COLONNE_SELECT} FROM utilizzi_effettivi WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function listaUtilizziPerAssegnazione(db: Db, assegnazioneId: string): Promise<UtilizzoEffettivo[]> {
  const r = await db.query<RigaUtilizzo>(
    `SELECT ${COLONNE_SELECT} FROM utilizzi_effettivi WHERE assegnazione_id = $1 ORDER BY data DESC`,
    [assegnazioneId],
  );
  return r.rows.map(daRiga);
}

export async function listaUtilizziPerAssociazione(db: Db, associazioneId: string, stagioneId?: string): Promise<UtilizzoEffettivo[]> {
  const colonne = `ue.id, ue.assegnazione_id, ue.data::text, ue.esito, ue.rilevato_tramite, ue.note, ue.registrato_il,
    ue.giustificazione_scade_il, ue.giustificazione_testo, ue.giustificazione_presentata_il,
    ue.giustificazione_decisa_da, ue.giustificazione_decisa_il, ue.giustificazione_motivazione_rigetto`;
  const r = stagioneId
    ? await db.query<RigaUtilizzo>(
        `SELECT ${colonne}
         FROM utilizzi_effettivi ue
         JOIN assegnazioni a ON a.id = ue.assegnazione_id
         JOIN slot_settimana_tipo st ON st.id = a.slot_id
         WHERE a.associazione_id = $1 AND st.stagione_id = $2
         ORDER BY ue.data DESC`,
        [associazioneId, stagioneId],
      )
    : await db.query<RigaUtilizzo>(
        `SELECT ${colonne}
         FROM utilizzi_effettivi ue
         JOIN assegnazioni a ON a.id = ue.assegnazione_id
         WHERE a.associazione_id = $1
         ORDER BY ue.data DESC`,
        [associazioneId],
      );
  return r.rows.map(daRiga);
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/utilizziEffettivi.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc`)
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/utilizziEffettivi.ts backend-node/src/utilizziEffettivi.test.ts
git commit -m "feat(backend): repository rilevazione utilizzo effettivo (art. B.34)"
```

---

### Task 4: Repository `utilizziEffettivi.ts` — ciclo di giustificazione

**Files:**
- Modify: `backend-node/src/utilizziEffettivi.ts`
- Modify: `backend-node/src/utilizziEffettivi.test.ts`

**Interfaces:**
- Consumes: `UtilizzoEffettivo`, `trovaUtilizzoPerId` (Task 3); `ErroreNonTrovato`, `ErroreStatoNonValidoPerTransizione` (da `./erroriDominio.ts`).
- Produces: `presentaGiustificazione(db, id, testo): Promise<UtilizzoEffettivo>`; `accogliGiustificazione(db, id, decisoreId): Promise<UtilizzoEffettivo>`; `rigettaGiustificazione(db, id, decisoreId, motivazione): Promise<UtilizzoEffettivo>`. Consumati da Task 6 (route).

- [ ] **Step 1: Scrivi i test**

Aggiungi in fondo a `backend-node/src/utilizziEffettivi.test.ts` (aggiungi `presentaGiustificazione, accogliGiustificazione, rigettaGiustificazione` all'import esistente da `./utilizziEffettivi.ts`, e importa `ErroreNonTrovato, ErroreStatoNonValidoPerTransizione` da `./erroriDominio.ts`):

```ts
import { presentaGiustificazione, accogliGiustificazione, rigettaGiustificazione } from './utilizziEffettivi.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

test('presentaGiustificazione: apre solo se non_utilizzato_non_giustificato con finestra aperta', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' });

  const presentata = await presentaGiustificazione(pool, utilizzo.id, 'assenza per lavori improvvisi in impianto');
  assert.equal(presentata.giustificazioneTesto, 'assenza per lavori improvvisi in impianto');
  assert.ok(presentata.giustificazionePresentataIl !== null);

  await assert.rejects(() => presentaGiustificazione(pool, utilizzo.id, 'seconda presentazione'), ErroreStatoNonValidoPerTransizione);
});

test('presentaGiustificazione: 404 se non trovato, 409 se finestra scaduta', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  await assert.rejects(() => presentaGiustificazione(pool, randomUUID(), 'x'), ErroreNonTrovato);

  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-14', esito: 'non_utilizzato_non_giustificato' });
  await pool.query(`UPDATE utilizzi_effettivi SET giustificazione_scade_il = now() - interval '1 day' WHERE id = $1`, [utilizzo.id]);
  await assert.rejects(() => presentaGiustificazione(pool, utilizzo.id, 'tardiva'), ErroreStatoNonValidoPerTransizione);
});

test('accogliGiustificazione: sposta esito a non_utilizzato_giustificato', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-21', esito: 'non_utilizzato_non_giustificato' });
  await presentaGiustificazione(pool, utilizzo.id, 'motivo valido');
  const decisoreId = randomUUID();

  const accolta = await accogliGiustificazione(pool, utilizzo.id, decisoreId);
  assert.equal(accolta.esito, 'non_utilizzato_giustificato');
  assert.equal(accolta.giustificazioneDecisaDa, decisoreId);

  await assert.rejects(() => accogliGiustificazione(pool, utilizzo.id, decisoreId), ErroreStatoNonValidoPerTransizione);
});

test('accogliGiustificazione: 409 se nessuna giustificazione presentata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-28', esito: 'non_utilizzato_non_giustificato' });

  await assert.rejects(() => accogliGiustificazione(pool, utilizzo.id, randomUUID()), ErroreStatoNonValidoPerTransizione);
});

test('rigettaGiustificazione: esito resta non_utilizzato_non_giustificato, motivazione registrata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const utilizzo = await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-11-04', esito: 'non_utilizzato_non_giustificato' });
  await presentaGiustificazione(pool, utilizzo.id, 'motivo debole');

  const rigettata = await rigettaGiustificazione(pool, utilizzo.id, randomUUID(), 'giustificazione non pertinente');
  assert.equal(rigettata.esito, 'non_utilizzato_non_giustificato');
  assert.equal(rigettata.giustificazioneMotivazioneRigetto, 'giustificazione non pertinente');
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/utilizziEffettivi.test.ts`
Expected: FAIL — `presentaGiustificazione`/`accogliGiustificazione`/`rigettaGiustificazione` non esistono.

- [ ] **Step 3: Scrivi l'implementazione**

Aggiungi in fondo a `backend-node/src/utilizziEffettivi.ts` (aggiungi l'import `import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';` in cima al file):

```ts
// art. B.35: la finestra si apre alla registrazione (Task 3) e si chiude alla prima tra
// scadenza e presentazione — guardia atomica UPDATE...WHERE...RETURNING (pattern TOCTOU-
// safe consolidato nel progetto), un SELECT di disambiguazione separato solo sul percorso
// di fallimento per distinguere 404 da 409.
export async function presentaGiustificazione(db: Db, id: string, testo: string): Promise<UtilizzoEffettivo> {
  const r = await db.query<{ id: string }>(
    `UPDATE utilizzi_effettivi
     SET giustificazione_testo = $2, giustificazione_presentata_il = now()
     WHERE id = $1 AND esito = 'non_utilizzato_non_giustificato'
       AND giustificazione_presentata_il IS NULL AND giustificazione_scade_il > now()
     RETURNING id`,
    [id, testo],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM utilizzi_effettivi WHERE id = $1`, [id]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('utilizzo non trovato');
    }
    throw new ErroreStatoNonValidoPerTransizione('finestra di giustificazione non aperta, già presentata o scaduta');
  }
  return (await trovaUtilizzoPerId(db, id))!;
}

export async function accogliGiustificazione(db: Db, id: string, decisoreId: string): Promise<UtilizzoEffettivo> {
  const r = await db.query<{ id: string }>(
    `UPDATE utilizzi_effettivi
     SET esito = 'non_utilizzato_giustificato', giustificazione_decisa_da = $2, giustificazione_decisa_il = now()
     WHERE id = $1 AND giustificazione_presentata_il IS NOT NULL AND giustificazione_decisa_il IS NULL
     RETURNING id`,
    [id, decisoreId],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM utilizzi_effettivi WHERE id = $1`, [id]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('utilizzo non trovato');
    }
    throw new ErroreStatoNonValidoPerTransizione('nessuna giustificazione presentata da decidere, o già decisa');
  }
  return (await trovaUtilizzoPerId(db, id))!;
}

export async function rigettaGiustificazione(db: Db, id: string, decisoreId: string, motivazione: string): Promise<UtilizzoEffettivo> {
  const r = await db.query<{ id: string }>(
    `UPDATE utilizzi_effettivi
     SET giustificazione_decisa_da = $2, giustificazione_decisa_il = now(), giustificazione_motivazione_rigetto = $3
     WHERE id = $1 AND giustificazione_presentata_il IS NOT NULL AND giustificazione_decisa_il IS NULL
     RETURNING id`,
    [id, decisoreId, motivazione],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM utilizzi_effettivi WHERE id = $1`, [id]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('utilizzo non trovato');
    }
    throw new ErroreStatoNonValidoPerTransizione('nessuna giustificazione presentata da decidere, o già decisa');
  }
  return (await trovaUtilizzoPerId(db, id))!;
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/utilizziEffettivi.test.ts`
Expected: PASS (tutti i test del file).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc`)
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/utilizziEffettivi.ts backend-node/src/utilizziEffettivi.test.ts
git commit -m "feat(backend): ciclo di giustificazione mancato utilizzo (art. B.35)"
```

---

### Task 5: Repository `provvedimenti.ts`

**Files:**
- Create: `backend-node/src/provvedimenti.ts`
- Create: `backend-node/src/provvedimenti.test.ts`

**Interfaces:**
- Consumes: `Db`; `leggiVersioneAttiva` (`./repository/parametrico.ts`); `ErroreStatoNonValidoPerTransizione` (`./erroriDominio.ts`).
- Produces: `interface Provvedimento { id, associazioneId, assegnazioneId, tipo, motivazione, emessoIl, emessoDa }`; `creaProvvedimento(db, dati): Promise<Provvedimento>`; `listaProvvedimentiPerAssegnazione(db, assegnazioneId): Promise<Provvedimento[]>`; `interface VoceCodaMancatiUtilizzi { assegnazioneId, mancatiDefinitivi, sogliaDiffida, sogliaDecadenza, diffidaRaggiunta, decadenzaRaggiunta, diffidaGiaEmessa, decadenzaGiaEmessa }`; `codaMancatiUtilizzi(db, associazioneId, stagioneId): Promise<VoceCodaMancatiUtilizzi[]>`; `applicaDecadenza(db, assegnazioneId, motivazione): Promise<void>`. Consumati da Task 7 (route).

- [ ] **Step 1: Scrivi il test repository**

Crea `backend-node/src/provvedimenti.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaProvvedimento, listaProvvedimentiPerAssegnazione, codaMancatiUtilizzi, applicaDecadenza } from './provvedimenti.ts';
import { registraUtilizzo } from './utilizziEffettivi.ts';
import { ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `JUDO-${randomUUID().slice(0, 8)}`, denominazione: 'Judo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto prov ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra prov', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Tatami prov', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-prov-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD prov ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Prov', $2, 'spid') RETURNING id`,
    [`TSTPRV${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
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
  const assegnazione = await pool.query<{ id: string }>(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria') RETURNING id`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  return { stagioneId, assegnazioneId: assegnazione.rows[0]!.id, associazioneId: associazione.rows[0]!.id };
}

// Registra N utilizzi 'non_utilizzato_non_giustificato' già scaduti senza presentazione
// (mancati "definitivi" ai fini del conteggio soglie).
async function registraMancatiDefinitivi(pool: Pool, assegnazioneId: string, n: number, dataBase: string) {
  for (let i = 0; i < n; i++) {
    const data = new Date(dataBase);
    data.setDate(data.getDate() + i * 7);
    const utilizzo = await registraUtilizzo(pool, {
      assegnazioneId, data: data.toISOString().slice(0, 10), esito: 'non_utilizzato_non_giustificato',
    });
    await pool.query(`UPDATE utilizzi_effettivi SET giustificazione_scade_il = now() - interval '1 day' WHERE id = $1`, [utilizzo.id]);
  }
}

test('creaProvvedimento e listaProvvedimentiPerAssegnazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const provvedimento = await creaProvvedimento(pool, {
    associazioneId: fx.associazioneId, assegnazioneId: fx.assegnazioneId, tipo: 'diffida',
    motivazione: 'superata soglia mancati utilizzi', emessoDa: null,
  });
  assert.equal(provvedimento.tipo, 'diffida');

  const lista = await listaProvvedimentiPerAssegnazione(pool, fx.assegnazioneId);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.id, provvedimento.id);
});

test('codaMancatiUtilizzi: segnala diffida raggiunta, decadenza no, provvedimento non ancora emesso', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraMancatiDefinitivi(pool, fx.assegnazioneId, 2, '2030-10-07'); // soglia diffida di default = 2

  const coda = await codaMancatiUtilizzi(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(coda.length, 1);
  const voce = coda[0]!;
  assert.equal(voce.assegnazioneId, fx.assegnazioneId);
  assert.equal(voce.mancatiDefinitivi, 2);
  assert.equal(voce.diffidaRaggiunta, true);
  assert.equal(voce.decadenzaRaggiunta, false);
  assert.equal(voce.diffidaGiaEmessa, false);
});

test('codaMancatiUtilizzi: diffidaGiaEmessa true dopo l\'emissione del provvedimento', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraMancatiDefinitivi(pool, fx.assegnazioneId, 2, '2030-10-07');
  await creaProvvedimento(pool, { associazioneId: fx.associazioneId, assegnazioneId: fx.assegnazioneId, tipo: 'diffida', motivazione: 'x', emessoDa: null });

  const coda = await codaMancatiUtilizzi(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(coda[0]!.diffidaGiaEmessa, true);
});

test('codaMancatiUtilizzi: esclude finestre ancora aperte dal conteggio', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  await registraUtilizzo(pool, { assegnazioneId: fx.assegnazioneId, data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' }); // finestra ancora aperta

  const coda = await codaMancatiUtilizzi(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(coda.length, 0);
});

test('applicaDecadenza: assegnazione passa a decaduta, guardia su doppia decadenza', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  await applicaDecadenza(pool, fx.assegnazioneId, 'decadenza per mancati utilizzi ripetuti');
  const riga = await pool.query<{ stato: string; decaduta_motivazione: string | null }>(
    `SELECT stato, decaduta_motivazione FROM assegnazioni WHERE id = $1`,
    [fx.assegnazioneId],
  );
  assert.equal(riga.rows[0]!.stato, 'decaduta');
  assert.equal(riga.rows[0]!.decaduta_motivazione, 'decadenza per mancati utilizzi ripetuti');

  await assert.rejects(() => applicaDecadenza(pool, fx.assegnazioneId, 'seconda decadenza'), ErroreStatoNonValidoPerTransizione);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/provvedimenti.test.ts`
Expected: FAIL — `Cannot find module './provvedimenti.ts'`.

- [ ] **Step 3: Scrivi l'implementazione**

Crea `backend-node/src/provvedimenti.ts`:

```ts
import type { Db } from './db.ts';
import { ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
import { leggiVersioneAttiva } from './repository/parametrico.ts';

export type TipoProvvedimento = 'richiesta_giustificazione' | 'diffida' | 'decadenza';

export interface Provvedimento {
  id: string;
  associazioneId: string;
  assegnazioneId: string;
  tipo: TipoProvvedimento;
  motivazione: string;
  emessoIl: string;
  emessoDa: string | null;
}

interface RigaProvvedimento {
  id: string;
  associazione_id: string;
  assegnazione_id: string;
  tipo: TipoProvvedimento;
  motivazione: string;
  emesso_il: Date;
  emesso_da: string | null;
}

const COLONNE_SELECT = `id, associazione_id, assegnazione_id, tipo, motivazione, emesso_il, emesso_da`;

function daRiga(r: RigaProvvedimento): Provvedimento {
  return {
    id: r.id,
    associazioneId: r.associazione_id,
    assegnazioneId: r.assegnazione_id,
    tipo: r.tipo,
    motivazione: r.motivazione,
    emessoIl: r.emesso_il.toISOString(),
    emessoDa: r.emesso_da,
  };
}

export interface DatiCreaProvvedimento {
  associazioneId: string;
  assegnazioneId: string;
  tipo: TipoProvvedimento;
  motivazione: string;
  emessoDa: string | null;
}

export async function creaProvvedimento(db: Db, dati: DatiCreaProvvedimento): Promise<Provvedimento> {
  const r = await db.query<RigaProvvedimento>(
    `INSERT INTO provvedimenti_mancato_utilizzo (associazione_id, assegnazione_id, tipo, motivazione, emesso_da)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLONNE_SELECT}`,
    [dati.associazioneId, dati.assegnazioneId, dati.tipo, dati.motivazione, dati.emessoDa],
  );
  return daRiga(r.rows[0]!);
}

export async function listaProvvedimentiPerAssegnazione(db: Db, assegnazioneId: string): Promise<Provvedimento[]> {
  const r = await db.query<RigaProvvedimento>(
    `SELECT ${COLONNE_SELECT} FROM provvedimenti_mancato_utilizzo WHERE assegnazione_id = $1 ORDER BY emesso_il DESC`,
    [assegnazioneId],
  );
  return r.rows.map(daRiga);
}

export interface VoceCodaMancatiUtilizzi {
  assegnazioneId: string;
  mancatiDefinitivi: number;
  sogliaDiffida: number;
  sogliaDecadenza: number;
  diffidaRaggiunta: boolean;
  decadenzaRaggiunta: boolean;
  diffidaGiaEmessa: boolean;
  decadenzaGiaEmessa: boolean;
}

interface RigaConteggio {
  assegnazione_id: string;
  mancati_definitivi: string;
}

// "Definitivo" ai fini del conteggio soglie B.35: la finestra è scaduta senza che
// l'associazione presentasse nulla, OPPURE la giustificazione presentata è stata
// esplicitamente rigettata (giustificazione_decisa_il valorizzato — un accoglimento
// sposta esito a 'non_utilizzato_giustificato' e la riga esce da questo filtro da sé).
// Le finestre ancora aperte non contano: l'associazione ha ancora la possibilità di
// giustificare, contarle già ora anticiperebbe l'escalation.
export async function codaMancatiUtilizzi(db: Db, associazioneId: string, stagioneId: string): Promise<VoceCodaMancatiUtilizzi[]> {
  const parametrico = await leggiVersioneAttiva(db);
  if (!parametrico) {
    throw new Error('nessuna versione parametrica attiva');
  }
  const conteggi = await db.query<RigaConteggio>(
    `SELECT a.id AS assegnazione_id, count(*) AS mancati_definitivi
     FROM utilizzi_effettivi ue
     JOIN assegnazioni a ON a.id = ue.assegnazione_id
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     WHERE a.associazione_id = $1 AND st.stagione_id = $2
       AND ue.esito = 'non_utilizzato_non_giustificato'
       AND ((ue.giustificazione_presentata_il IS NULL AND ue.giustificazione_scade_il < now())
            OR ue.giustificazione_decisa_il IS NOT NULL)
     GROUP BY a.id`,
    [associazioneId, stagioneId],
  );
  const esito: VoceCodaMancatiUtilizzi[] = [];
  for (const riga of conteggi.rows) {
    const mancati = Number(riga.mancati_definitivi);
    const provvedimenti = await db.query<{ tipo: TipoProvvedimento }>(
      `SELECT tipo FROM provvedimenti_mancato_utilizzo WHERE assegnazione_id = $1 AND tipo IN ('diffida', 'decadenza')`,
      [riga.assegnazione_id],
    );
    const tipiEmessi = new Set(provvedimenti.rows.map((p) => p.tipo));
    esito.push({
      assegnazioneId: riga.assegnazione_id,
      mancatiDefinitivi: mancati,
      sogliaDiffida: parametrico.sogliaMancatiUtilizziDiffida,
      sogliaDecadenza: parametrico.sogliaMancatiUtilizziDecadenza,
      diffidaRaggiunta: mancati >= parametrico.sogliaMancatiUtilizziDiffida,
      decadenzaRaggiunta: mancati >= parametrico.sogliaMancatiUtilizziDecadenza,
      diffidaGiaEmessa: tipiEmessi.has('diffida'),
      decadenzaGiaEmessa: tipiEmessi.has('decadenza'),
    });
  }
  return esito;
}

// art. B.35: "lo spazio torna a disposizione quale fascia libera" — un UPDATE guardato,
// mai su un'assegnazione già decaduta/sostituita. Lo slot liberato ridiventa visibile come
// libero a trovaProprietarioOccorrenza (variazioni.ts, blocco precedente) senza alcuna
// modifica a quel file: quella funzione legge assegnazioni WHERE stato IN
// ('provvisoria','validata'), quindi una riga 'decaduta' semplicemente non compare più.
export async function applicaDecadenza(db: Db, assegnazioneId: string, motivazione: string): Promise<void> {
  const r = await db.query(
    `UPDATE assegnazioni SET stato = 'decaduta', decaduta_il = now(), decaduta_motivazione = $2
     WHERE id = $1 AND stato IN ('provvisoria', 'validata')`,
    [assegnazioneId, motivazione],
  );
  if ((r.rowCount ?? 0) === 0) {
    throw new ErroreStatoNonValidoPerTransizione('assegnazione non più in uno stato decadibile');
  }
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/provvedimenti.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc`)
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/provvedimenti.ts backend-node/src/provvedimenti.test.ts
git commit -m "feat(backend): provvedimenti mancato utilizzo + coda diffida/decadenza (art. B.35)"
```

---

### Task 6: Route backoffice — registrazione utilizzi + giustificazione

**Files:**
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Create: `backend-node/src/server.utilizziEffettivi.test.ts`

**Interfaces:**
- Consumes: `registraUtilizzo`, `trovaUtilizzoPerId`, `listaUtilizziPerAssegnazione`, `accogliGiustificazione`, `rigettaGiustificazione` (`./utilizziEffettivi.ts`, Task 3-4).
- Produces: `POST /backoffice/assegnazioni/:id/utilizzi`, `GET /backoffice/assegnazioni/:id/utilizzi`, `PUT /backoffice/utilizzi/:id/accogli-giustificazione`, `PUT /backoffice/utilizzi/:id/rigetta-giustificazione`.

- [ ] **Step 1: Aggiungi gli schema zod in `backofficeSchema.ts`**

In fondo al file:

```ts
export const schemaRegistraUtilizzo = z.object({
  data: zDataIso,
  esito: z.enum(['utilizzato', 'non_utilizzato_giustificato', 'non_utilizzato_non_giustificato', 'indisponibilita_impianto']),
  note: z.string().min(1).optional(),
});
export type RegistraUtilizzoRequest = z.infer<typeof schemaRegistraUtilizzo>;

export const schemaRigettaGiustificazione = z.object({
  motivazione: z.string().min(1),
});
export type RigettaGiustificazioneRequest = z.infer<typeof schemaRigettaGiustificazione>;
```

- [ ] **Step 2: Scrivi il test HTTP**

Crea `backend-node/src/server.utilizziEffettivi.test.ts`, stesso harness dei blocchi precedenti (`avviaServerTest`, `creaAdmin`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

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
  const email = `util-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaFixtureAssegnazione(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `RUGBY-${randomUUID().slice(0, 8)}`, denominazione: 'Rugby' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto util http ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra util http', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo util http', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-util-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD util http ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Util', $2, 'spid') RETURNING id`,
    [`TSTUTH${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
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
  const assegnazione = await pool.query<{ id: string }>(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria') RETURNING id`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  return { assegnazioneId: assegnazione.rows[0]!.id };
}

test('POST .../utilizzi crea, GET .../utilizzi la trova', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const rCrea = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-07', esito: 'non_utilizzato_non_giustificato', note: 'nessuno presente' }),
  });
  assert.equal(rCrea.status, 201);
  const creato = (await rCrea.json()) as { esito: string; giustificazioneScadeIl: string | null };
  assert.equal(creato.esito, 'non_utilizzato_non_giustificato');
  assert.ok(creato.giustificazioneScadeIl !== null);

  const rLista = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rLista.status, 200);
  assert.equal(((await rLista.json()) as unknown[]).length, 1);
});

test('POST .../utilizzi: 400 su UUID malformato nel path, 400 su data inesistente', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const rMalformato = await fetch(`${base}/backoffice/assegnazioni/non-un-uuid/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-07', esito: 'utilizzato' }),
  });
  assert.equal(rMalformato.status, 400);

  const rDataInvalida = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-13-45', esito: 'utilizzato' }),
  });
  assert.equal(rDataInvalida.status, 400);
});

test('flusso giustificazione: presenta (via repository, la route pubblica è nel Task 8) → accogli → 200', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const rCrea = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' }),
  });
  const utilizzo = (await rCrea.json()) as { id: string };
  await pool.query(
    `UPDATE utilizzi_effettivi SET giustificazione_testo = 'motivo', giustificazione_presentata_il = now() WHERE id = $1`,
    [utilizzo.id],
  );

  const rAccogli = await fetch(`${base}/backoffice/utilizzi/${utilizzo.id}/accogli-giustificazione`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(rAccogli.status, 200);
  assert.equal(((await rAccogli.json()) as { esito: string }).esito, 'non_utilizzato_giustificato');
});

test('PUT .../rigetta-giustificazione: 409 se nessuna giustificazione presentata', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const rCrea = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-14', esito: 'non_utilizzato_non_giustificato' }),
  });
  const utilizzo = (await rCrea.json()) as { id: string };

  const r = await fetch(`${base}/backoffice/utilizzi/${utilizzo.id}/rigetta-giustificazione`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivazione: 'non pertinente' }),
  });
  assert.equal(r.status, 409);
});
```

- [ ] **Step 3: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.utilizziEffettivi.test.ts`
Expected: FAIL — 404 sulle route non ancora esistenti.

- [ ] **Step 4: Aggiungi le route in `server.ts`**

Aggiungi l'import: `import { registraUtilizzo, trovaUtilizzoPerId, listaUtilizziPerAssegnazione, accogliGiustificazione, rigettaGiustificazione } from './utilizziEffettivi.ts';` e unisci `schemaRegistraUtilizzo, schemaRigettaGiustificazione` con l'import esistente da `./backofficeSchema.ts`.

Aggiungi le route dopo il blocco variazioni ordinarie (Task 6 del blocco precedente, art. B.32) esistente:

```ts
  // --- Rilevazione utilizzo effettivo (art. B.34) ---

  app.post(
    '/backoffice/assegnazioni/:id/utilizzi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const assegnazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaRegistraUtilizzo.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const utilizzo = await eseguiInTransazione(pool, async (client) => {
          const u = await registraUtilizzo(client, { assegnazioneId, ...parsed.data });
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'registra_utilizzo_effettivo',
            entitaTipo: 'utilizzi_effettivi',
            entitaId: u.id,
            dettaglio: u as unknown as Record<string, unknown>,
          });
          return u;
        });
        res.status(201).json(utilizzo);
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
    '/backoffice/assegnazioni/:id/utilizzi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const assegnazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        res.status(200).json(await listaUtilizziPerAssegnazione(pool, assegnazioneId));
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

  app.put(
    '/backoffice/utilizzi/:id/accogli-giustificazione',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const aggiornato = await eseguiInTransazione(pool, async (client) => {
          const u = await accogliGiustificazione(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'accoglie_giustificazione',
            entitaTipo: 'utilizzi_effettivi',
            entitaId: u.id,
            dettaglio: { esito: u.esito },
          });
          return u;
        });
        res.status(200).json(aggiornato);
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

  app.put(
    '/backoffice/utilizzi/:id/rigetta-giustificazione',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaRigettaGiustificazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const aggiornato = await eseguiInTransazione(pool, async (client) => {
          const u = await rigettaGiustificazione(client, id, req.utente!.sub, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'rigetta_giustificazione',
            entitaTipo: 'utilizzi_effettivi',
            entitaId: u.id,
            dettaglio: { motivazione: parsed.data.motivazione },
          });
          return u;
        });
        res.status(200).json(aggiornato);
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

`trovaUtilizzoPerId` è importato ma non ancora usato in questo task — resta importato per il Task 8 (route pubblica), che lo consuma direttamente da `server.ts`; se il linter/typecheck segnalasse un import inutilizzato in questo task intermedio, è atteso e si risolve da sé al Task 8 (nessuna azione qui).

- [ ] **Step 5: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.utilizziEffettivi.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc`)
Expected: nessun errore. Se segnala `trovaUtilizzoPerId` importato e non usato, rimuovilo temporaneamente dall'import di questo task (verrà reintrodotto al Task 8) — TypeScript con le impostazioni di questo progetto non ha `noUnusedLocals` attivo di default per gli import applicativi in `server.ts` (verificato nei blocchi precedenti), ma se il comando fallisse comunque per questo motivo, rimuovi l'import inutilizzato.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/backofficeSchema.ts backend-node/src/server.utilizziEffettivi.test.ts
git commit -m "feat(backend): route backoffice registrazione utilizzi + accogli/rigetta giustificazione (art. B.34-35)"
```

---

### Task 7: Route backoffice — coda mancati utilizzi + provvedimenti

**Files:**
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/backofficeSchema.ts`
- Create: `backend-node/src/server.provvedimenti.test.ts`

**Interfaces:**
- Consumes: `codaMancatiUtilizzi`, `creaProvvedimento`, `listaProvvedimentiPerAssegnazione`, `applicaDecadenza` (`./provvedimenti.ts`, Task 5).
- Produces: `GET /backoffice/associazioni/:id/mancati-utilizzi`, `POST /backoffice/assegnazioni/:id/provvedimenti`, `GET /backoffice/assegnazioni/:id/provvedimenti`.

- [ ] **Step 1: Aggiungi lo schema zod in `backofficeSchema.ts`**

In fondo al file:

```ts
export const schemaCreaProvvedimento = z.object({
  tipo: z.enum(['diffida', 'decadenza']),
  motivazione: z.string().min(1),
});
export type CreaProvvedimentoRequest = z.infer<typeof schemaCreaProvvedimento>;
```

- [ ] **Step 2: Scrivi il test HTTP**

Crea `backend-node/src/server.provvedimenti.test.ts`, riusa lo stesso harness (`avviaServerTest`, `creaAdmin`, `creaFixtureAssegnazione`) di `server.utilizziEffettivi.test.ts` — copialo identico in questo file (stesso contenuto delle funzioni helper, import inclusi), poi aggiungi:

```ts
test('GET .../mancati-utilizzi: coda vuota se nessun mancato utilizzo definitivo', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const r = await fetch(`${base}/backoffice/associazioni/${fx.associazioneId}/mancati-utilizzi?stagioneId=${fx.stagioneId}`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), []);
});

test('POST .../provvedimenti tipo diffida: 201, nessun effetto su assegnazioni.stato', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const r = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/provvedimenti`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'diffida', motivazione: 'superata soglia' }),
  });
  assert.equal(r.status, 201);
  const provvedimento = (await r.json()) as { tipo: string; emessoDa: string };
  assert.equal(provvedimento.tipo, 'diffida');
  assert.equal(provvedimento.emessoDa, admin.id);

  const riga = await pool.query<{ stato: string }>(`SELECT stato FROM assegnazioni WHERE id = $1`, [fx.assegnazioneId]);
  assert.equal(riga.rows[0]!.stato, 'provvisoria');
});

test('POST .../provvedimenti tipo decadenza: 201, assegnazioni.stato passa a decaduta', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureAssegnazione(pool);

  const r = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/provvedimenti`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'decadenza', motivazione: 'mancati utilizzi ripetuti' }),
  });
  assert.equal(r.status, 201);

  const riga = await pool.query<{ stato: string }>(`SELECT stato FROM assegnazioni WHERE id = $1`, [fx.assegnazioneId]);
  assert.equal(riga.rows[0]!.stato, 'decaduta');

  const rRipetuto = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/provvedimenti`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'decadenza', motivazione: 'seconda decadenza' }),
  });
  assert.equal(rRipetuto.status, 409);
});

test('GET .../provvedimenti: 400 su UUID malformato', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);

  const r = await fetch(`${base}/backoffice/assegnazioni/non-un-uuid/provvedimenti`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(r.status, 400);
});
```

- [ ] **Step 3: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.provvedimenti.test.ts`
Expected: FAIL — route inesistenti (404).

- [ ] **Step 4: Aggiungi le route in `server.ts`**

Aggiungi l'import: `import { codaMancatiUtilizzi, creaProvvedimento, listaProvvedimentiPerAssegnazione, applicaDecadenza } from './provvedimenti.ts';` e unisci `schemaCreaProvvedimento` con l'import esistente da `./backofficeSchema.ts`.

Aggiungi le route dopo il blocco Task 6:

```ts
  // --- Coda mancati utilizzi + provvedimenti (art. B.35) ---

  app.get(
    '/backoffice/associazioni/:id/mancati-utilizzi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const associazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      if (!stagioneId) {
        res.status(400).json({ errore: 'stagioneId è richiesto come query param' });
        return;
      }
      try {
        res.status(200).json(await codaMancatiUtilizzi(pool, associazioneId, stagioneId));
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
    '/backoffice/assegnazioni/:id/provvedimenti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const assegnazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaCreaProvvedimento.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const provvedimento = await eseguiInTransazione(pool, async (client) => {
          const riga = await client.query<{ associazione_id: string }>(
            `SELECT associazione_id FROM assegnazioni WHERE id = $1`,
            [assegnazioneId],
          );
          if ((riga.rowCount ?? 0) === 0) {
            throw new ErroreNonTrovato('assegnazione non trovata');
          }
          const associazioneId = riga.rows[0]!.associazione_id;
          if (parsed.data.tipo === 'decadenza') {
            await applicaDecadenza(client, assegnazioneId, parsed.data.motivazione);
          }
          const p = await creaProvvedimento(client, {
            associazioneId, assegnazioneId, tipo: parsed.data.tipo,
            motivazione: parsed.data.motivazione, emessoDa: req.utente!.sub,
          });
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'emette_provvedimento_mancato_utilizzo',
            entitaTipo: 'provvedimenti_mancato_utilizzo',
            entitaId: p.id,
            dettaglio: p as unknown as Record<string, unknown>,
          });
          return p;
        });
        res.status(201).json(provvedimento);
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
    '/backoffice/assegnazioni/:id/provvedimenti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const assegnazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        res.status(200).json(await listaProvvedimentiPerAssegnazione(pool, assegnazioneId));
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

- [ ] **Step 5: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.provvedimenti.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Verifica il typecheck**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc`)
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/backofficeSchema.ts backend-node/src/server.provvedimenti.test.ts
git commit -m "feat(backend): coda mancati utilizzi + emissione diffida/decadenza (art. B.35)"
```

---

### Task 8: Route pubblico — giustificazione + lettura storico

**Files:**
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/pubblicoSchema.ts`
- Create: `backend-node/src/server.giustificazionePubblica.test.ts`

**Interfaces:**
- Consumes: `trovaUtilizzoPerId` (già importato da Task 6, `./utilizziEffettivi.ts`), `presentaGiustificazione`, `listaUtilizziPerAssociazione` (`./utilizziEffettivi.ts`, Task 3-4); `trovaAbilitazioneAttiva` (`./abilitazioni.ts`, già importato in `server.ts`).
- Produces: `POST /pubblico/utilizzi/:id/giustificazione`, `GET /pubblico/associazioni/:id/utilizzi`.

- [ ] **Step 1: Aggiungi lo schema zod in `pubblicoSchema.ts`**

In fondo al file:

```ts
export const schemaPresentaGiustificazione = z.object({
  testo: z.string().min(1),
});
export type PresentaGiustificazioneRequest = z.infer<typeof schemaPresentaGiustificazione>;
```

- [ ] **Step 2: Scrivi il test HTTP end-to-end**

Crea `backend-node/src/server.giustificazionePubblica.test.ts`, stesso harness delle route pubbliche viste nei blocchi precedenti (token pubblico + abilitazione attiva, admin per la registrazione iniziale):

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
  const email = `giust-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaFixtureConAbilitazione(pool: Pool, adminId: string) {
  const disciplina = await creaDisciplina(pool, { codice: `VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto giust ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra giust', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo giust', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-giust-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD giust ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTGST${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Giust', $2, 'spid') RETURNING id`,
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
  const assegnazione = await pool.query<{ id: string }>(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria') RETURNING id`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  const tokenPubblico = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: 'Giust' });
  return { stagioneId, assegnazioneId: assegnazione.rows[0]!.id, associazioneId: associazione.rows[0]!.id, tokenPubblico };
}

test('flusso end-to-end: registra mancato utilizzo → presenta giustificazione via API pubblica → lettura storico pubblica', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureConAbilitazione(pool, admin.id);

  const rCrea = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-07', esito: 'non_utilizzato_non_giustificato' }),
  });
  const utilizzo = (await rCrea.json()) as { id: string };

  const rGiustifica = await fetch(`${base}/pubblico/utilizzi/${utilizzo.id}/giustificazione`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.tokenPubblico}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ testo: 'assenza per lavori improvvisi comunicati in anticipo' }),
  });
  assert.equal(rGiustifica.status, 200);
  assert.ok(((await rGiustifica.json()) as { giustificazionePresentataIl: string | null }).giustificazionePresentataIl !== null);

  const rLista = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/utilizzi?stagioneId=${fx.stagioneId}`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  assert.equal(rLista.status, 200);
  assert.equal(((await rLista.json()) as unknown[]).length, 1);
});

test('POST .../giustificazione: 403 senza abilitazione attiva sull\'associazione titolare', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureConAbilitazione(pool, admin.id);
  const estraneo = generaAccessTokenPubblico({ sub: randomUUID(), codiceFiscale: 'XXXXXXXXXXX', nome: 'X', cognome: 'Y' });

  const rCrea = await fetch(`${base}/backoffice/assegnazioni/${fx.assegnazioneId}/utilizzi`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: '2030-10-14', esito: 'non_utilizzato_non_giustificato' }),
  });
  const utilizzo = (await rCrea.json()) as { id: string };

  const r = await fetch(`${base}/pubblico/utilizzi/${utilizzo.id}/giustificazione`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${estraneo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ testo: 'tentativo non autorizzato' }),
  });
  assert.equal(r.status, 403);
});

test('POST .../giustificazione: 404 su utilizzo inesistente, 400 su UUID malformato', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureConAbilitazione(pool, admin.id);

  const rInesistente = await fetch(`${base}/pubblico/utilizzi/${randomUUID()}/giustificazione`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.tokenPubblico}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ testo: 'x' }),
  });
  assert.equal(rInesistente.status, 404);

  const rMalformato = await fetch(`${base}/pubblico/utilizzi/non-un-uuid/giustificazione`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.tokenPubblico}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ testo: 'x' }),
  });
  assert.equal(rMalformato.status, 400);
});
```

- [ ] **Step 3: Esegui i test, verifica che falliscano**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.giustificazionePubblica.test.ts`
Expected: FAIL — route inesistenti (404 dove il test si aspetta altro).

- [ ] **Step 4: Aggiungi le route in `server.ts`**

Aggiungi `presentaGiustificazione, listaUtilizziPerAssociazione` all'import esistente da `./utilizziEffettivi.ts` (già presente dal Task 6, che importava `registraUtilizzo, trovaUtilizzoPerId, listaUtilizziPerAssegnazione, accogliGiustificazione, rigettaGiustificazione`), e unisci `schemaPresentaGiustificazione` con l'import esistente da `./pubblicoSchema.ts`.

Aggiungi le route dopo il blocco Task 7:

```ts
  // --- Giustificazione mancato utilizzo (pubblico) + lettura storico (art. B.34-35) ---

  app.post(
    '/pubblico/utilizzi/:id/giustificazione',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaPresentaGiustificazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const utilizzo = await trovaUtilizzoPerId(pool, id);
        if (!utilizzo) {
          res.status(404).json({ errore: 'utilizzo non trovato' });
          return;
        }
        const contesto = await pool.query<{ associazione_id: string; stagione_id: string }>(
          `SELECT a.associazione_id, st.stagione_id
           FROM assegnazioni a JOIN slot_settimana_tipo st ON st.id = a.slot_id
           WHERE a.id = $1`,
          [utilizzo.assegnazioneId],
        );
        const { associazione_id: associazioneId, stagione_id: stagioneId } = contesto.rows[0]!;
        const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, associazioneId, stagioneId);
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        const aggiornato = await eseguiInTransazione(pool, async (client) => {
          const u = await presentaGiustificazione(client, id, parsed.data.testo);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId, ruolo: delegante.ruolo },
            azione: 'presenta_giustificazione_mancato_utilizzo',
            entitaTipo: 'utilizzi_effettivi',
            entitaId: u.id,
            dettaglio: { giustificazioneTesto: u.giustificazioneTesto },
          });
          return u;
        });
        res.status(200).json(aggiornato);
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
    '/pubblico/associazioni/:id/utilizzi',
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
        res.status(200).json(await listaUtilizziPerAssociazione(pool, associazioneId, stagioneId));
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

- [ ] **Step 5: Esegui i test, verifica che passino**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test src/server.giustificazionePubblica.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Verifica il typecheck e l'intera suite**

Run: `cd backend-node && pnpm exec tsc` (fallback `./node_modules/.bin/tsc`)
Expected: nessun errore.

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" node --test "src/**/*.test.ts"` (quotato)
Expected: tutti i test passano, nessuna regressione sul resto della suite.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/pubblicoSchema.ts backend-node/src/server.giustificazionePubblica.test.ts
git commit -m "feat(backend): route pubblica giustificazione + lettura storico utilizzi (art. B.34-35)"
```

---

## Self-Review Notes

- **Spec coverage**: B.34 (Task 3: registrazione utilizzo, solo `registro_impianto`). B.35 (Task 3-7: tutti e 3 i passi della scala graduata — richiesta di giustificazione implicita nella registrazione, diffida, decadenza — ciclo di giustificazione a due fasi, coda soglie, effetto decadenza su `assegnazioni.stato`). B.36 (Task 3, 8: storico interrogabile via `listaUtilizziPerAssegnazione`/`listaUtilizziPerAssociazione`/route pubblica di lettura — nessun aggancio a calcolo, come da scope concordato). Fuori scope confermato: autodichiarazione/check-in digitale, aggancio CSD.
- **Placeholder scan**: nessun TODO/TBD residuo. Il Task 6 nota esplicitamente il caso limite dell'import `trovaUtilizzoPerId` non ancora usato fino al Task 8 — non un placeholder, un'interfaccia dichiarata in anticipo e consumata due task dopo, comportamento atteso e documentato.
- **Type consistency**: `UtilizzoEffettivo`/`EsitoUtilizzo`/`RilevatoTramite` definiti in Task 3, usati identici in Task 4, 6, 8. `Provvedimento`/`TipoProvvedimento`/`VoceCodaMancatiUtilizzi` definiti in Task 5, usati identici in Task 7. `VersioneParametrica.termineGiustificazioneGiorni` definito in Task 2, consumato in Task 3 (`registraUtilizzo`) e Task 5 (`codaMancatiUtilizzi`) con lo stesso nome.
