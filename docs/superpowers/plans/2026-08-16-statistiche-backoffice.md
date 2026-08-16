# StatisticheView backoffice — collegamento API reali Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collegare `StatisticheView.tsx` (ultima vista backoffice ancora su dati mock) a un nuovo endpoint di aggregazione backend, chiudendo "UI Fase 5" lato backoffice al 100%.

**Architecture:** Un endpoint sola-lettura (`GET /backoffice/stagioni/:id/statistiche`) che aggrega dati già esistenti (nessuna tabella/migration nuova) in `src/statistiche.ts`; la vista frontend passa da dati hardcoded a un fetch reale, riusando il pattern `useOutletContext` già in uso in `ImpiantiSpaziView`/`ControlRoomView` per la stagione selezionata dall'Header.

**Tech Stack:** Node.js 24 + TypeScript (no build step), Express 5, `pg` diretto, `node --test` contro Postgres reale; React 19 + TypeScript, Vitest + Testing Library.

## Global Constraints

- Decimal-as-string: ogni valore NUMERIC/percentuale calcolato in SQL è letto via `::text`, mai binding numerico diretto (vedi CLAUDE.md, stesso principio già seguito in `repository/parametrico.ts`).
- Minuti grezzi vs valore ponderato (CLAUDE.md, blocco 3/4 concertazione): per i KPI di utilizzo/saturazione si usano SEMPRE i minuti grezzi di `slot_settimana_tipo.durata_minuti`, MAI `assegnazioni.valore_minuti` (che per le fasce pregiate è già ponderato ×peso_fascia_pregiata) — mischiare le due basi di calcolo falserebbe silenziosamente il rapporto numeratore/denominatore. Il valore ponderato (`assegnazioni.valore_minuti`) si usa SOLO per il calcolo ISF (VA/FR), dove è la definizione corretta (art. A.9).
- ISF = N/A per associazioni con FR=0 (regola di dominio consolidata, mai divisione per zero) — un'associazione con FR>0 ma zero minuti assegnati ha ISF=0 (un dato valido, va incluso nella media), non N/A: la query deve partire da `domande`/`fabbisogni_riconosciuti`, non da `assegnazioni`, altrimenti le associazioni senza alcuna assegnazione attiva spariscono silenziosamente dalla media invece di contribuire con 0.
- Tutte le metriche sono scoped alla stagione passata come path param, stesso pattern delle altre route `/backoffice/stagioni/:id/...` già in `server.ts` (elaborazioni, sorteggi).
- Nessuna colonna "comune": lo schema non ne ha una strutturata (solo `indirizzo` testo libero) — il grafico "saturazione" è raggruppato per impianto (`impianti.denominazione`), non per comune.
- Route sola lettura: nessun `registraOperazione`/audit log (il progetto registra solo le scritture, mai le letture — vincolo fisso).

---

### Task 1: Repository backend — aggregazione statistiche stagione

**Files:**
- Create: `backend-node/src/statistiche.ts`
- Test: `backend-node/src/statistiche.test.ts`

**Interfaces:**
- Consumes: `Db` da `./db.ts` (interfaccia minima `Pool|PoolClient`, stesso tipo usato da `sorteggi.ts`/`propostaProvvisoria.ts`).
- Produces: `calcolaStatisticheStagione(db: Db, stagioneId: string): Promise<StatisticheStagione>` — nessuna verifica di esistenza della stagione qui dentro (la fa il chiamante, stesso pattern di `listaSorteggiPerStagione`/la route `elaborazioni`: se la stagione non esiste, le query ritornano semplicemente zero righe/valori null, non è compito del repository lanciare `ErroreNonTrovato`).

- [ ] **Step 1: Scrivere il file con le interfacce e la funzione**

```typescript
import type { Db } from './db.ts';

export interface VoceDisciplina {
  disciplinaCodice: string;
  disciplinaDenominazione: string;
  minuti: string;
}

export interface VoceImpianto {
  impiantoId: string;
  impiantoDenominazione: string;
  tassoUtilizzoPct: string | null;
}

export interface StatisticheStagione {
  tassoUtilizzoImpiantiPct: string | null;
  fascePregiateAssegnatePct: string | null;
  isfMedioAssociazioni: string | null;
  sociAtletiCoinvolti: number;
  distribuzioneMinutiPerDisciplina: VoceDisciplina[];
  saturazionePerImpianto: VoceImpianto[];
}

interface RigaUtilizzoGlobale {
  tasso_utilizzo_impianti_pct: string | null;
  fasce_pregiate_assegnate_pct: string | null;
}

interface RigaIsfMedio {
  isf_medio_associazioni: string | null;
}

interface RigaSociAtleti {
  soci_atleti_coinvolti: number;
}

interface RigaDisciplina {
  disciplina_codice: string;
  disciplina_denominazione: string;
  minuti: string;
}

interface RigaImpianto {
  impianto_id: string;
  impianto_denominazione: string;
  tasso_utilizzo_pct: string | null;
}

// KPI 1+2: minuti GREZZI (durata_minuti), mai valore_minuti (ponderato per le
// fasce pregiate, vedi Global Constraints) — numeratore e denominatore devono
// stare sulla stessa base o il rapporto è falsato silenziosamente. Una CTE
// unica calcola i 4 totali in una scansione sola, poi il SELECT esterno
// applica il rapporto con guardia divisione-per-zero (stagione senza slot, o
// senza fasce pregiate: entrambi casi reali per una stagione appena creata).
async function leggiUtilizzoGlobale(db: Db, stagioneId: string): Promise<RigaUtilizzoGlobale> {
  const r = await db.query<RigaUtilizzoGlobale>(
    `WITH agg AS (
       SELECT
         SUM(st.durata_minuti) AS totale,
         SUM(st.durata_minuti) FILTER (WHERE a.id IS NOT NULL) AS utilizzati,
         SUM(st.durata_minuti) FILTER (WHERE st.pregiata) AS totale_pregiate,
         SUM(st.durata_minuti) FILTER (WHERE st.pregiata AND a.id IS NOT NULL) AS utilizzate_pregiate
       FROM slot_settimana_tipo st
       LEFT JOIN assegnazioni a ON a.slot_id = st.id AND a.stato IN ('provvisoria', 'validata')
       WHERE st.stagione_id = $1 AND st.indisponibile_permanente = false
     )
     SELECT
       (CASE WHEN totale IS NULL OR totale = 0 THEN NULL
             ELSE ROUND(COALESCE(utilizzati, 0)::numeric / totale, 3) END)::text AS tasso_utilizzo_impianti_pct,
       (CASE WHEN totale_pregiate IS NULL OR totale_pregiate = 0 THEN NULL
             ELSE ROUND(COALESCE(utilizzate_pregiate, 0)::numeric / totale_pregiate, 3) END)::text AS fasce_pregiate_assegnate_pct
     FROM agg`,
    [stagioneId],
  );
  return r.rows[0]!;
}

// ISF = VA cumulativa / FR finale (art. A.13), VA = valore_minuti PONDERATO
// (a differenza del KPI sopra — qui è la definizione corretta, art. A.9).
// Si parte da `domande`/`fabbisogni_riconosciuti` (non da `assegnazioni`):
// un'associazione ammessa con FR>0 ma zero assegnazioni attive ha ISF=0, un
// dato valido che deve contribuire alla media — partire da `assegnazioni`
// la farebbe sparire dalla query, gonfiando artificialmente la media verso
// l'alto. FR=0 resta N/A (mai nel denominatore), regola di dominio consolidata.
async function leggiIsfMedio(db: Db, stagioneId: string): Promise<RigaIsfMedio> {
  const r = await db.query<RigaIsfMedio>(
    `SELECT ROUND(AVG(
       CASE WHEN fr.fr_finale_minuti > 0 THEN COALESCE(va.totale, 0) / fr.fr_finale_minuti END
     ), 3)::text AS isf_medio_associazioni
     FROM domande d
     JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = d.id
     LEFT JOIN (
       SELECT a.associazione_id, SUM(a.valore_minuti) AS totale
       FROM assegnazioni a
       JOIN slot_settimana_tipo st ON st.id = a.slot_id
       WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
       GROUP BY a.associazione_id
     ) va ON va.associazione_id = d.associazione_id
     WHERE d.stagione_id = $1 AND d.stato = 'ammessa'`,
    [stagioneId, stagioneId],
  );
  return r.rows[0]!;
}

async function leggiSociAtleti(db: Db, stagioneId: string): Promise<RigaSociAtleti> {
  const r = await db.query<RigaSociAtleti>(
    `SELECT COALESCE(SUM(numero_atleti_partecipanti), 0)::int AS soci_atleti_coinvolti
     FROM domande WHERE stagione_id = $1 AND stato = 'ammessa'`,
    [stagioneId],
  );
  return r.rows[0]!;
}

// Disciplina di un'assegnazione = intersezione tra le discipline dichiarate
// nella domanda (domanda_discipline) e le discipline compatibili dello
// spazio del suo slot (spazio_disciplina_compatibile) — decisione presa in
// brainstorming: "dipende dagli slot selezionati nel calendario, non dalla
// domanda". Se l'intersezione ha più di una disciplina, i minuti grezzi
// dello slot sono divisi equamente tra le discipline dell'intersezione
// (euristica di visualizzazione, non una regola normativa — vedi design
// doc). Se l'intersezione è vuota, l'assegnazione è esclusa dal grafico
// (nessun JOIN la produce, silenziosamente corretto: non c'è FK che
// garantisca un'intersezione non vuota).
async function leggiDistribuzionePerDisciplina(db: Db, stagioneId: string): Promise<RigaDisciplina[]> {
  const r = await db.query<RigaDisciplina>(
    `WITH assegnazioni_attive AS (
       SELECT a.id, a.domanda_id, st.spazio_id, st.durata_minuti
       FROM assegnazioni a
       JOIN slot_settimana_tipo st ON st.id = a.slot_id
       WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
     ),
     discipline_match AS (
       SELECT aa.id AS assegnazione_id, dd.disciplina_codice, aa.durata_minuti,
              COUNT(*) OVER (PARTITION BY aa.id) AS numero_discipline
       FROM assegnazioni_attive aa
       JOIN domanda_discipline dd ON dd.domanda_id = aa.domanda_id
       JOIN spazio_disciplina_compatibile sdc
         ON sdc.spazio_id = aa.spazio_id AND sdc.disciplina_codice = dd.disciplina_codice
     )
     SELECT ds.codice AS disciplina_codice, ds.denominazione AS disciplina_denominazione,
            ROUND(SUM(dm.durata_minuti / dm.numero_discipline::numeric), 3)::text AS minuti
     FROM discipline_match dm
     JOIN discipline_sportive ds ON ds.codice = dm.disciplina_codice
     GROUP BY ds.codice, ds.denominazione
     ORDER BY minuti DESC, ds.codice`,
    [stagioneId],
  );
  return r.rows;
}

async function leggiSaturazionePerImpianto(db: Db, stagioneId: string): Promise<RigaImpianto[]> {
  const r = await db.query<RigaImpianto>(
    `SELECT i.id AS impianto_id, i.denominazione AS impianto_denominazione,
            (CASE WHEN SUM(st.durata_minuti) = 0 THEN NULL
                  ELSE ROUND(COALESCE(SUM(st.durata_minuti) FILTER (WHERE a.id IS NOT NULL), 0)::numeric / SUM(st.durata_minuti), 3) END)::text AS tasso_utilizzo_pct
     FROM slot_settimana_tipo st
     JOIN spazi_sportivi sp ON sp.id = st.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     LEFT JOIN assegnazioni a ON a.slot_id = st.id AND a.stato IN ('provvisoria', 'validata')
     WHERE st.stagione_id = $1 AND st.indisponibile_permanente = false
     GROUP BY i.id, i.denominazione
     ORDER BY i.denominazione`,
    [stagioneId],
  );
  return r.rows;
}

export async function calcolaStatisticheStagione(db: Db, stagioneId: string): Promise<StatisticheStagione> {
  const [globale, isf, sociAtleti, disciplina, impianto] = await Promise.all([
    leggiUtilizzoGlobale(db, stagioneId),
    leggiIsfMedio(db, stagioneId),
    leggiSociAtleti(db, stagioneId),
    leggiDistribuzionePerDisciplina(db, stagioneId),
    leggiSaturazionePerImpianto(db, stagioneId),
  ]);
  return {
    tassoUtilizzoImpiantiPct: globale.tasso_utilizzo_impianti_pct,
    fascePregiateAssegnatePct: globale.fasce_pregiate_assegnate_pct,
    isfMedioAssociazioni: isf.isf_medio_associazioni,
    sociAtletiCoinvolti: sociAtleti.soci_atleti_coinvolti,
    distribuzioneMinutiPerDisciplina: disciplina.map((v) => ({
      disciplinaCodice: v.disciplina_codice,
      disciplinaDenominazione: v.disciplina_denominazione,
      minuti: v.minuti,
    })),
    saturazionePerImpianto: impianto.map((v) => ({
      impiantoId: v.impianto_id,
      impiantoDenominazione: v.impianto_denominazione,
      tassoUtilizzoPct: v.tasso_utilizzo_pct,
    })),
  };
}
```

- [ ] **Step 2: Scrivere il test contro Postgres reale**

Il test costruisce una fixture completa (stagione, istituzione, impianto, 2 spazi, discipline, slot pregiati/non pregiati, associazioni, domande ammesse, fabbisogni riconosciuti, assegnazioni attive) e verifica ogni metrica con valori calcolati a mano — stesso pattern fixture di `propostaProvvisoria.test.ts::creaFixtureConAssegnazione`.

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { calcolaStatisticheStagione } from './statistiche.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaStagione(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine, stato) VALUES ($1, '2030-09-01', '2031-06-30', 'prima_assegnazione') RETURNING id`,
    [`stagione-statistiche-test-${randomUUID()}`],
  );
  return r.rows[0]!.id;
}

async function creaAssociazioneEPersona(pool: Pool, etichetta: string): Promise<{ associazioneId: string; personaId: string }> {
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD statistiche ${etichetta} ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', $2, $3, 'spid') RETURNING id`,
    [`TSTSTA${randomUUID().slice(0, 10).toUpperCase()}`, etichetta, randomUUID()],
  );
  return { associazioneId: associazione.rows[0]!.id, personaId: persona.rows[0]!.id };
}

async function ammettiDomandaConFr(
  pool: Pool,
  domandaId: string,
  frFinaleMinuti: number,
): Promise<void> {
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domandaId]);
  const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
  await pool.query(
    `INSERT INTO fabbisogni_riconosciuti (domanda_id, parametrico_versione_id, peso_base, incremento_squadre, fr_calcolato_minuti, fd_minuti, fr_finale_minuti)
     VALUES ($1, $2, 1, 0, $3, $3, $3)`,
    [domandaId, versione.rows[0]!.id, frFinaleMinuti],
  );
}

async function creaAssegnazioneAttiva(pool: Pool, slotId: string, domandaId: string, associazioneId: string, valoreMinuti: number): Promise<void> {
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', $4, 'validata')`,
    [slotId, domandaId, associazioneId, valoreMinuti],
  );
}

test(
  'calcolaStatisticheStagione: KPI e grafici su una stagione con dati misti (pregiate, FR=0, multi-disciplina)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const discPallavolo = await creaDisciplina(pool, { codice: `STA-VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo test' });
    const discBasket = await creaDisciplina(pool, { codice: `STA-BASKET-${randomUUID().slice(0, 8)}`, denominazione: 'Basket test' });
    const istituzione = await creaIstituzione(pool, { denominazione: `Istituto statistiche ${randomUUID()}` });
    const impianto = await creaImpianto(pool, { denominazione: 'Palestra statistiche', istituzioneScolasticaId: istituzione.id });
    // spazio1: compatibile con ENTRAMBE le discipline (intersezione multi-disciplina)
    const spazio1 = await creaSpazio(pool, {
      impiantoId: impianto.id,
      denominazione: 'Campo 1',
      disciplineCompatibili: [discPallavolo.codice, discBasket.codice],
    });
    const stagioneId = await creaStagione(pool);

    // slot1: NON pregiata, 60 min, assegnata -> utilizzata
    const slot1 = await creaSlot(pool, { stagioneId, spazioId: spazio1.id, giornoSettimana: 1, orarioInizio: '09:00', orarioFine: '10:00' });
    // slot2: PREGIATA, 60 min, assegnata -> utilizzata (pregiata)
    const slot2 = await creaSlot(pool, { stagioneId, spazioId: spazio1.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00', pregiata: true });
    // slot3: PREGIATA, 60 min, MAI assegnata -> conta nel totale pregiate ma non nell'utilizzato
    const slot3 = await creaSlot(pool, { stagioneId, spazioId: spazio1.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00', pregiata: true });

    const { associazioneId: assocA, personaId: personaA } = await creaAssociazioneEPersona(pool, 'A');
    const domandaA = await creaDomanda(
      pool,
      {
        associazioneId: assocA,
        stagioneId,
        disciplineCodici: [discPallavolo.codice, discBasket.codice],
        numeroTesserati: 20,
        numeroAtletiPartecipanti: 15,
        numeroSquadre: 1,
        numeroSquadreFederaliStagionePrecedente: 0,
        attivitaGiovanile: true,
        attivitaAgonistica: false,
        attivitaParalimpicaInclusiva: false,
        fabbisognoMinimoMinuti: '60.000',
        fabbisognoOttimaleMinuti: '120.000',
        preferenze: [slot1.id, slot2.id],
        blocchiAllenamento: [],
        richiedeGiornataGara: false,
        richiesteGiornataGara: [],
      },
      personaA,
    );
    // FR finale = 100: VA cumulativa (slot1=60 + slot2=60) = 120 -> ISF = 1.200
    await ammettiDomandaConFr(pool, domandaA.id, 100);
    await creaAssegnazioneAttiva(pool, slot1.id, domandaA.id, assocA, 60);
    await creaAssegnazioneAttiva(pool, slot2.id, domandaA.id, assocA, 75); // ponderata (pregiata), MAI usata nei KPI 1/2

    // Associazione B: FR>0 ma NESSUNA assegnazione attiva -> ISF=0, deve contribuire alla media
    const { associazioneId: assocB, personaId: personaB } = await creaAssociazioneEPersona(pool, 'B');
    const domandaB = await creaDomanda(
      pool,
      {
        associazioneId: assocB,
        stagioneId,
        disciplineCodici: [discPallavolo.codice],
        numeroTesserati: 5,
        numeroAtletiPartecipanti: 4,
        numeroSquadre: 1,
        numeroSquadreFederaliStagionePrecedente: 0,
        attivitaGiovanile: false,
        attivitaAgonistica: false,
        attivitaParalimpicaInclusiva: false,
        fabbisognoMinimoMinuti: '60.000',
        fabbisognoOttimaleMinuti: '60.000',
        preferenze: [slot3.id],
        blocchiAllenamento: [],
        richiedeGiornataGara: false,
        richiesteGiornataGara: [],
      },
      personaB,
    );
    await ammettiDomandaConFr(pool, domandaB.id, 50); // FR=50, VA=0 -> ISF=0

    const stat = await calcolaStatisticheStagione(pool, stagioneId);

    // Totale minuti stagione = slot1(60) + slot2(60) + slot3(60) = 180, utilizzati = slot1+slot2 = 120
    assert.equal(stat.tassoUtilizzoImpiantiPct, '0.667');
    // Pregiate: totale = slot2+slot3 = 120, utilizzate = slot2 = 60
    assert.equal(stat.fascePregiateAssegnatePct, '0.500');
    // ISF medio = AVG(1.200, 0.000) = 0.600 -- associazione B (FR=50,VA=0) CONTA nella media
    assert.equal(stat.isfMedioAssociazioni, '0.600');
    // Soci/atleti = 15 (A, ammessa) + 4 (B, ammessa) = 19
    assert.equal(stat.sociAtletiCoinvolti, 19);

    // Disciplina: slot1(60min, intersezione={pallavolo,basket}) split 30/30;
    // slot2(60min, stessa intersezione) split 30/30 -> pallavolo=60, basket=60
    const pallavolo = stat.distribuzioneMinutiPerDisciplina.find((d) => d.disciplinaCodice === discPallavolo.codice);
    const basket = stat.distribuzioneMinutiPerDisciplina.find((d) => d.disciplinaCodice === discBasket.codice);
    assert.equal(pallavolo?.minuti, '60.000');
    assert.equal(basket?.minuti, '60.000');

    // Saturazione per impianto: stesso impianto, stessi totali del KPI 1
    assert.equal(stat.saturazionePerImpianto.length, 1);
    assert.equal(stat.saturazionePerImpianto[0]!.impiantoId, impianto.id);
    assert.equal(stat.saturazionePerImpianto[0]!.tassoUtilizzoPct, '0.667');
  },
);

test(
  'calcolaStatisticheStagione: stagione senza alcun dato ritorna valori null/zero, mai un errore',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());
    const stagioneId = await creaStagione(pool);

    const stat = await calcolaStatisticheStagione(pool, stagioneId);
    assert.equal(stat.tassoUtilizzoImpiantiPct, null);
    assert.equal(stat.fascePregiateAssegnatePct, null);
    assert.equal(stat.isfMedioAssociazioni, null);
    assert.equal(stat.sociAtletiCoinvolti, 0);
    assert.deepEqual(stat.distribuzioneMinutiPerDisciplina, []);
    assert.deepEqual(stat.saturazionePerImpianto, []);
  },
);
```

Nota per l'implementatore: verificare la firma esatta di `creaSlot` in `backend-node/src/slot.ts` per il parametro `pregiata` (opzionale, default `false`) prima di usarlo nella fixture — se il nome del campo differisse da quanto scritto sopra, adattare la chiamata mantenendo l'intento (slot2/slot3 devono risultare `pregiata = true` in DB).

- [ ] **Step 3: Eseguire i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata-pg-palestre-dev>/palestre?sslmode=disable node --test src/statistiche.test.ts`
Expected: PASS su entrambi i test.

- [ ] **Step 4: Commit**

```bash
cd backend-node && git add src/statistiche.ts src/statistiche.test.ts
git commit -m "feat(backend-node): aggregazione statistiche stagione (utilizzo impianti, ISF medio, distribuzione discipline)"
```

---

### Task 2: Route HTTP + test server

**Files:**
- Modify: `backend-node/src/server.ts` (aggiungere import + route)
- Test: `backend-node/src/server.statistiche.test.ts`

**Interfaces:**
- Consumes: `calcolaStatisticheStagione` (Task 1), `validaStagioneIdUuid`/`verificaStagioneEsiste`/`comeErroreRiferimentoNonValido`/`ErroreNonTrovato` (già presenti in `server.ts`, stesso pattern della route `/backoffice/stagioni/:id/elaborazioni`).
- Produces: `GET /backoffice/stagioni/:id/statistiche` — 200 `StatisticheStagione`, 404 stagione inesistente, 400 id malformato, 403 ruolo non admin/operatore, 401 non autenticato.

- [ ] **Step 1: Aggiungere l'import**

In `backend-node/src/server.ts`, vicino alla riga dell'import di `sorteggi.ts` (cercare `from './sorteggi.ts'`), aggiungere sulla riga successiva:

```typescript
import { calcolaStatisticheStagione } from './statistiche.ts';
```

- [ ] **Step 2: Aggiungere la route**

Individuare il blocco `app.get('/backoffice/sorteggi/:id', ...)` (route immediatamente successiva a `/backoffice/stagioni/:id/sorteggi`) e il commento `// --- Approvazione settimana tipo definitiva (art. B.30) ---` subito dopo la sua chiusura. Inserire la nuova route tra la chiusura di `/backoffice/sorteggi/:id` e quel commento:

```typescript
  app.get(
    '/backoffice/stagioni/:id/statistiche',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        validaStagioneIdUuid(stagioneId);
        await verificaStagioneEsiste(pool, stagioneId);
        const statistiche = await calcolaStatisticheStagione(pool, stagioneId);
        res.status(200).json(statistiche);
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

- [ ] **Step 3: Scrivere il test HTTP**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  const email = `statistiche-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Statistiche', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

async function creaStagioneTest(base: string, token: string): Promise<string> {
  const r = await fetch(`${base}/backoffice/stagioni`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nome: `Stagione statistiche route ${randomUUID()}`, dataInizio: '2033-09-01', dataFine: '2034-06-30' }),
  });
  const { id } = await r.json();
  return id;
}

test(
  'GET /backoffice/stagioni/:id/statistiche',
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

    await t.test('401 senza token', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${randomUUID()}/statistiche`);
      assert.equal(r.status, 401);
    });

    await t.test('404 su stagione inesistente', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${randomUUID()}/statistiche`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('400 su id malformato', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/non-un-uuid/statistiche`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 400);
    });

    await t.test('200 con shape della risposta su stagione vuota (admin)', async () => {
      const stagioneId = await creaStagioneTest(base, admin.token);
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/statistiche`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.tassoUtilizzoImpiantiPct, null);
      assert.equal(body.sociAtletiCoinvolti, 0);
      assert.deepEqual(body.distribuzioneMinutiPerDisciplina, []);
      assert.deepEqual(body.saturazionePerImpianto, []);
    });

    await t.test('200 per operatore (route non admin-only)', async () => {
      const stagioneId = await creaStagioneTest(base, admin.token);
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/statistiche`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
    });
  },
);
```

Nota per l'implementatore: stesso pattern esatto di `server.parametrico.test.ts` (nessun helper condiviso in `testutil/` per server+login — ogni file `server.*.test.ts` dichiara le proprie funzioni locali). Verificare la firma esatta di `creaApp` in `backend-node/src/server.ts` prima di scrivere il test, per allinearsi a eventuali parametri aggiuntivi.


- [ ] **Step 4: Eseguire i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata-pg-palestre-dev>/palestre?sslmode=disable node --test src/server.statistiche.test.ts`
Expected: PASS su tutti gli scenari.

- [ ] **Step 5: Commit**

```bash
cd backend-node && git add src/server.ts src/server.statistiche.test.ts
git commit -m "feat(backend-node): GET /backoffice/stagioni/:id/statistiche"
```

---

### Task 3: Modulo API frontend

**Files:**
- Create: `frontend-backoffice/src/api/statistiche.ts`
- Test: `frontend-backoffice/src/api/statistiche.test.ts`

**Interfaces:**
- Consumes: `richiedi`/`ErroreRichiestaApi` da `./client.ts` (Task 2 del blocco precedente, già esistente).
- Produces: `leggiStatisticheStagione(stagioneId: string): Promise<StatisticheStagione>`, tipi `StatisticheStagione`/`VoceDisciplina`/`VoceImpianto` per il consumo in Task 4.

- [ ] **Step 1: Scrivere il modulo**

```typescript
import { ErroreRichiestaApi, richiedi } from './client.ts';

export { ErroreRichiestaApi };

export interface VoceDisciplina {
  disciplinaCodice: string;
  disciplinaDenominazione: string;
  minuti: string;
}

export interface VoceImpianto {
  impiantoId: string;
  impiantoDenominazione: string;
  tassoUtilizzoPct: string | null;
}

export interface StatisticheStagione {
  tassoUtilizzoImpiantiPct: string | null;
  fascePregiateAssegnatePct: string | null;
  isfMedioAssociazioni: string | null;
  sociAtletiCoinvolti: number;
  distribuzioneMinutiPerDisciplina: VoceDisciplina[];
  saturazionePerImpianto: VoceImpianto[];
}

export function leggiStatisticheStagione(stagioneId: string): Promise<StatisticheStagione> {
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/statistiche`);
}
```

- [ ] **Step 2: Scrivere il test di interazione (vi.spyOn su fetch, no backend)**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { leggiStatisticheStagione, ErroreRichiestaApi } from './statistiche.ts';
import { impostaTokens, rimuoviTokens } from './client.ts';

describe('leggiStatisticheStagione', () => {
  beforeEach(() => {
    impostaTokens('access-test', 'refresh-test');
  });
  afterEach(() => {
    rimuoviTokens();
    vi.restoreAllMocks();
  });

  it('chiama il path corretto ed effettua il parse della risposta', async () => {
    const corpo = {
      tassoUtilizzoImpiantiPct: '0.667',
      fascePregiateAssegnatePct: '0.500',
      isfMedioAssociazioni: '0.600',
      sociAtletiCoinvolti: 19,
      distribuzioneMinutiPerDisciplina: [],
      saturazionePerImpianto: [],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const risultato = await leggiStatisticheStagione('stagione-123');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/backoffice/stagioni/stagione-123/statistiche'),
      expect.anything(),
    );
    expect(risultato).toEqual(corpo);
  });

  it('lancia ErroreRichiestaApi con il messaggio del backend su risposta non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errore: 'stagione non trovata' }), { status: 404, headers: { 'content-type': 'application/json' } }),
    );

    await expect(leggiStatisticheStagione('inesistente')).rejects.toThrow(ErroreRichiestaApi);
  });
});
```

- [ ] **Step 3: Eseguire i test**

Run: `cd frontend-backoffice && pnpm exec vitest run src/api/statistiche.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd frontend-backoffice && git add src/api/statistiche.ts src/api/statistiche.test.ts
git commit -m "feat(frontend-backoffice): modulo api statistiche stagione"
```

---

### Task 4: Riscrivere StatisticheView.tsx sui dati reali

**Files:**
- Modify: `frontend-backoffice/src/components/StatisticheView.tsx`
- Test: `frontend-backoffice/src/components/StatisticheView.test.tsx`

**Interfaces:**
- Consumes: `leggiStatisticheStagione`, `StatisticheStagione`, `VoceDisciplina`, `VoceImpianto`, `ErroreRichiestaApi` da `../api/statistiche.ts` (Task 3); `useOutletContext<string>()` da `react-router` (stesso pattern di `ControlRoomView.tsx`/`ImpiantiSpaziView.tsx`, riga `const stagioneId = useOutletContext<string>() ?? '';` + guardia `{!stagioneId && ...}`).
- Produces: componente `StatisticheView: React.FC` (stessa firma pubblica di prima — nessun cambio nel modo in cui `routes.tsx` la referenzia).

- [ ] **Step 1: Riscrivere il componente**

```typescript
import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { BarChart3, TrendingUp, PieChart, Building2, Users, Clock } from 'lucide-react';
import {
  leggiStatisticheStagione,
  type StatisticheStagione,
  ErroreRichiestaApi,
} from '../api/statistiche.ts';

function formatPct(valore: string | null): string {
  if (valore === null) return 'N/D';
  return `${(parseFloat(valore) * 100).toFixed(1)}%`;
}

function formatMinuti(valore: string): string {
  return `${Math.round(parseFloat(valore)).toLocaleString('it-IT')} min`;
}

const COLORI_DISCIPLINA = ['var(--pa-blue-primary)', '#00C5CA', '#8E44AD', '#F39C12', '#27AE60', '#E74C3C'];

export const StatisticheView: React.FC = () => {
  const stagioneId = useOutletContext<string>() ?? '';
  const [statistiche, setStatistiche] = useState<StatisticheStagione | null>(null);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);

  useEffect(() => {
    if (!stagioneId) return;
    setCaricamento(true);
    setErroreCaricamento(null);
    leggiStatisticheStagione(stagioneId)
      .then(setStatistiche)
      .catch((err) => setErroreCaricamento(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare le statistiche.'))
      .finally(() => setCaricamento(false));
  }, [stagioneId]);

  const totaleMinutiDisciplina = statistiche
    ? statistiche.distribuzioneMinutiPerDisciplina.reduce((acc, v) => acc + parseFloat(v.minuti), 0)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Analisi & Statistiche Assegnazione</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Metriche di saturazione impianti, equità di distribuzione e soddisfazione fabbisogni (ISF)
        </p>
      </div>

      {!stagioneId && <div style={{ color: 'var(--pa-text-muted)' }}>Seleziona una stagione nell'Header per iniziare.</div>}
      {stagioneId && caricamento && <div style={{ color: 'var(--pa-text-muted)' }}>Caricamento statistiche...</div>}
      {erroreCaricamento && <div style={{ color: 'var(--pa-error, #C0392B)' }}>{erroreCaricamento}</div>}

      {stagioneId && statistiche && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <div className="pa-card">
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>
                <Building2 size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                Tasso Utilizzo Impianti
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-dark)', margin: '0.2rem 0' }}>
                {formatPct(statistiche.tassoUtilizzoImpiantiPct)}
              </div>
            </div>

            <div className="pa-card">
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>
                <TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                Fasce Pregiate Assegnate
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-primary)', margin: '0.2rem 0' }}>
                {formatPct(statistiche.fascePregiateAssegnatePct)}
              </div>
            </div>

            <div className="pa-card">
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>
                <BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                ISF Medio Associazioni
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#8E44AD', margin: '0.2rem 0' }}>
                {statistiche.isfMedioAssociazioni === null ? 'N/D' : `${statistiche.isfMedioAssociazioni} (${formatPct(statistiche.isfMedioAssociazioni)})`}
              </div>
            </div>

            <div className="pa-card">
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>
                <Users size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                Soci & Atleti Coinvolti
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-success)', margin: '0.2rem 0' }}>
                {statistiche.sociAtletiCoinvolti.toLocaleString('it-IT')}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <div className="pa-card">
              <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>
                <PieChart size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                Distribuzione Minuti Assegnati per Disciplina
              </h3>
              {statistiche.distribuzioneMinutiPerDisciplina.length === 0 && (
                <div style={{ color: 'var(--pa-text-muted)', fontSize: '0.85rem' }}>Nessuna assegnazione attiva in questa stagione.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {statistiche.distribuzioneMinutiPerDisciplina.map((v, i) => {
                  const pct = totaleMinutiDisciplina > 0 ? (parseFloat(v.minuti) / totaleMinutiDisciplina) * 100 : 0;
                  return (
                    <div key={v.disciplinaCodice}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                        <span>{v.disciplinaDenominazione}</span>
                        <strong>{formatMinuti(v.minuti)} ({pct.toFixed(1)}%)</strong>
                      </div>
                      <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: COLORI_DISCIPLINA[i % COLORI_DISCIPLINA.length] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pa-card">
              <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>
                <Clock size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                Saturazione Palestre per Impianto
              </h3>
              {statistiche.saturazionePerImpianto.length === 0 && (
                <div style={{ color: 'var(--pa-text-muted)', fontSize: '0.85rem' }}>Nessuno slot definito per questa stagione.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {statistiche.saturazionePerImpianto.map((v) => (
                  <div key={v.impiantoId}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                      <span>{v.impiantoDenominazione}</span>
                      <strong>{formatPct(v.tassoUtilizzoPct)} Occupazione</strong>
                    </div>
                    <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: v.tassoUtilizzoPct === null ? '0%' : `${parseFloat(v.tassoUtilizzoPct) * 100}%`,
                          height: '100%',
                          backgroundColor: 'var(--pa-success)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Scrivere il test di interazione (vi.spyOn su `api/statistiche.ts`, no backend)**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import * as apiStatistiche from '../api/statistiche.ts';
import { StatisticheView } from './StatisticheView.tsx';

// Stesso pattern di ControlRoomView.test.tsx::renderConStagione: useOutletContext
// richiede un Outlet reale, non un mock del hook.
function renderConStagione(stagioneId: string) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={stagioneId} />,
      children: [{ index: true, element: <StatisticheView /> }],
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('StatisticheView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mostra il messaggio di selezione stagione se nessuna stagione è selezionata', () => {
    renderConStagione('');
    expect(screen.getByText(/seleziona una stagione/i)).toBeInTheDocument();
  });

  it('carica e mostra le statistiche quando una stagione è selezionata', async () => {
    vi.spyOn(apiStatistiche, 'leggiStatisticheStagione').mockResolvedValue({
      tassoUtilizzoImpiantiPct: '0.667',
      fascePregiateAssegnatePct: '0.500',
      isfMedioAssociazioni: '0.600',
      sociAtletiCoinvolti: 19,
      distribuzioneMinutiPerDisciplina: [{ disciplinaCodice: 'VOLLEY', disciplinaDenominazione: 'Pallavolo', minuti: '60.000' }],
      saturazionePerImpianto: [{ impiantoId: 'imp-1', impiantoDenominazione: 'Palestra Test', tassoUtilizzoPct: '0.667' }],
    });

    renderConStagione('stagione-1');

    await waitFor(() => expect(screen.getByText('66.7%')).toBeInTheDocument());
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText(/Pallavolo/)).toBeInTheDocument();
    expect(screen.getByText(/Palestra Test/)).toBeInTheDocument();
  });

  it('mostra un messaggio di errore se il caricamento fallisce', async () => {
    vi.spyOn(apiStatistiche, 'leggiStatisticheStagione').mockRejectedValue(
      new apiStatistiche.ErroreRichiestaApi(500, 'errore interno'),
    );

    renderConStagione('stagione-1');

    await waitFor(() => expect(screen.getByText('errore interno')).toBeInTheDocument());
  });
});
```

Nota per l'implementatore: pattern `renderConStagione` copiato da `ControlRoomView.test.tsx` (già verificato funzionante in quel file) — nessun bisogno di reinventarlo.


- [ ] **Step 3: Eseguire i test**

Run: `cd frontend-backoffice && pnpm exec vitest run src/components/StatisticheView.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd frontend-backoffice && git add src/components/StatisticheView.tsx src/components/StatisticheView.test.tsx
git commit -m "feat(frontend-backoffice): StatisticheView collegata alle API reali"
```

---

### Task 5: Smoke test end-to-end contro backend reale

**Files:**
- Create: `frontend-backoffice/src/components/StatisticheView.realBackend.test.tsx`

**Interfaces:**
- Consumes: `avviaBackendReale`/`BackendReale` da `../testUtil/backendReale.ts`, `creaUtenteTest`/`UtenteTest` da `../testUtil/creaUtenteTest.ts`, `impostaTokens`/`rimuoviTokens` da `../api/client.ts`, `routes` da `../routes.tsx`, `AuthProvider` da `../auth/AuthContext.tsx` — stesso identico pattern di `ImpiantiSpaziView.test.tsx::renderApp` (Global Constraints del blocco precedente: "ogni nuova vista deve avere almeno uno smoke test reale").

- [ ] **Step 1: Scrivere il test**

Crea una stagione reale via API, uno slot reale, verifica che il valore `sociAtletiCoinvolti` (inizialmente 0, un campo semplice da un round-trip Postgres→JSON→DOM) compaia nel DOM dopo aver selezionato quella stagione — non serve una fixture complessa: lo scopo di questo test è solo verificare il cablaggio end-to-end (routing, outlet context, fetch, render), le regole di calcolo sono già coperte a fondo da `statistiche.test.ts` (Task 1).

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '../auth/AuthContext.tsx';
import { routes } from '../routes.tsx';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest, type UtenteTest } from '../testUtil/creaUtenteTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens } from '../api/client.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('StatisticheView (backend reale)', () => {
  let backend: BackendReale;
  const utentiCreati: UtenteTest[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(utentiCreati.map((u) => u.elimina()));
  });

  function renderApp(initialEntry: string) {
    const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
    return render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
  }

  it('carica le statistiche reali della stagione selezionata nell\'Header (round-trip Postgres->JSON->DOM)', async () => {
    const u = await creaUtenteTest(dsn!, 'admin');
    utentiCreati.push(u);
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);

    const suffisso = randomUUID().slice(0, 8);
    const stagioneRes = await apiFetch('/backoffice/stagioni', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: `Stagione statistiche smoke ${suffisso}`, dataInizio: '2036-09-01', dataFine: '2037-06-30' }),
    });
    const stagione = await stagioneRes.json();

    renderApp('/statistiche');

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument(), { timeout: 15000 });
    const selectStagione = screen.getByRole('combobox');
    await waitFor(() => expect(within(selectStagione).getByText(new RegExp(`Stagione statistiche smoke ${suffisso}`))).toBeInTheDocument());
    (selectStagione as HTMLSelectElement).value = stagione.id;
    selectStagione.dispatchEvent(new Event('change', { bubbles: true }));

    // Stagione appena creata, nessuna domanda -> sociAtletiCoinvolti reale = 0,
    // valore che deve attraversare Postgres->backend->frontend intatto.
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument(), { timeout: 15000 });
  }, 30000);
});
```

Nota per l'implementatore: verificare in `ImpiantiSpaziView.test.tsx` (blocco `describe('propagazione della stagione selezionata in Header ...')`) il meccanismo ESATTO con cui il test seleziona una stagione diversa nel combobox dell'Header (`selectStagione.value = ...` + evento `change` potrebbe non bastare con un `<select>` controllato React — se il test di riferimento usa `userEvent.selectOptions(...)` invece, allineare questo test allo stesso meccanismo, che è già verificato funzionante).

- [ ] **Step 2: Eseguire il test**

Run: `cd frontend-backoffice && TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata-pg-palestre-dev>/palestre?sslmode=disable pnpm exec vitest run src/components/StatisticheView.realBackend.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd frontend-backoffice && git add src/components/StatisticheView.realBackend.test.tsx
git commit -m "test(frontend-backoffice): smoke test end-to-end StatisticheView contro backend reale"
```

---

## Nota finale per il final reviewer

Dopo il Task 5, verificare che `CLAUDE.md` venga aggiornato con la chiusura di questo blocco (stesso pattern di ogni blocco precedente: "Residui noti" perde la voce `StatisticheView backoffice ancora su mock`, sezione "Backend Node"/"frontend backoffice" guadagna un paragrafo di chiusura) — non è un task di questo piano (è un passo separato, whole-branch, eseguito dal coordinator dopo il merge), ma va segnalato se dimenticato.
