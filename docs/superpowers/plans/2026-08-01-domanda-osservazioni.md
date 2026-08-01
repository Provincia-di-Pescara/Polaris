# Domanda + Osservazioni Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Espone via HTTP il flusso "domanda" del sistema POLARIS: presentazione (art. B.5-B.6), verifica ammissibilità backoffice (art. B.7), pubblicazione esiti (art. B.10) e osservazioni/riesame (art. B.11).

**Architecture:** Backend Node/Express esistente (`backend-node/src`). Due nuovi file repository top-level (`domande.ts`, `osservazioni.ts`, stesso livello di `associazioni.ts`/`abilitazioni.ts` — non sotto `repository/`, che ospita solo i moduli legati ad auth/parametrico). Nuove route in `server.ts`, inserite subito prima di `return app;` in fondo al file. Schema DB già completo (migration `000001`); una sola migration nuova per la sequence del numero di protocollo.

**Tech Stack:** Node 24, TypeScript 7 (no build, type-check con `tsc --noEmit`), Express, zod, `pg` diretto (no ORM), `node --test` contro Postgres reale.

## Global Constraints

- Niente ORM: SQL puro parametrizzato, stesso stile di ogni altro file del repo.
- Valori `NUMERIC` sempre letti con `::text` nella SELECT/RETURNING e mai fatti passare per binding numerico diretto — coerente col resto del progetto (motore Go, `repository/parametrico.ts`).
- Ogni route di scrittura passa da `eseguiInTransazione(pool, ...)` + `registraOperazione` (art. B.39) nella stessa transazione.
- Mapping errori: `23505`→409 (`ErroreValoreDuplicato`), `22P02`/`23503`/`22003`→400 (`comeErroreRiferimentoNonValido`), zod fallito→400. Applicare il mapping 22P02 anche sulle GET-by-id, non solo sulle route di scrittura (pattern consolidato nei blocchi precedenti).
- `exactOptionalPropertyTypes: true` in `tsconfig.json`: ogni campo opzionale nelle interfacce `Dati*` va dichiarato `campo?: T | undefined`, non solo `campo?: T`.
- Test con `node --test` contro Postgres reale (`TEST_DATABASE_URL`), server HTTP vero via `app.listen(0)` + `fetch`, mai mock. Skip pulito (`{ skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }`) se la env non è impostata.
- Autorizzazione pubblica: `trovaAbilitazioneAttiva(pool, personaFisicaId, associazioneId, stagioneId)` da `abilitazioni.ts` — 403 se `null`. Nessuna distinzione di ruolo rappresentante/operatore in questo blocco (vedi assunzione aperta nello spec).
- Autorizzazione backoffice: `richiedeRuolo('admin', 'operatore')` su tutte le route di questo blocco (nessuna è admin-only).

---

### Task 1: Migration protocollo + presentazione domanda (`POST /pubblico/domande`)

**Files:**
- Create: `db/migrations/000009_sequenza_protocollo_domande.up.sql`
- Create: `db/migrations/000009_sequenza_protocollo_domande.down.sql`
- Create: `backend-node/src/domande.ts`
- Modify: `backend-node/src/pubblicoSchema.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/domande.test.ts` (nuovo, unit sul repository)
- Test: `backend-node/src/server.domande.test.ts` (nuovo, HTTP end-to-end)

**Interfaces:**
- Produce: `domande.ts` esporta `Domanda`, `Preferenza`, `BloccoAllenamento`, `RichiestaGiornataGara`, `DatiCreaDomanda`, `DatiRichiestaGiornataGara`, `StatoDomanda`, `creaDomanda(db: Db, dati: DatiCreaDomanda, presentataDaPersonaFisicaId: string): Promise<Domanda>`, `trovaDomandaPerId(db: Db, id: string): Promise<Domanda | null>`, `listaDomandePerAssociazione(db: Db, associazioneId: string, stagioneId?: string): Promise<Domanda[]>`.
- Produce: `pubblicoSchema.ts` esporta `schemaCreaDomanda`, `schemaRichiestaGiornataGara`, tipo `CreaDomandaRequest`.
- Consuma da codice esistente: `Db` (`db.ts`), `ErroreValoreDuplicato`/`ErroreNonTrovato` (`erroriDominio.ts`), `trovaAbilitazioneAttiva` (`abilitazioni.ts`), `eseguiInTransazione`/`registraOperazione`/`comeErroreRiferimentoNonValido`/`RequestAutenticataPubblico`/`richiedeAutenticazionePubblico` (già importati in `server.ts`).

#### Passo 1: Migration sequence protocollo

`db/migrations/000009_sequenza_protocollo_domande.up.sql`:
```sql
-- Sequence dedicata per il numero di protocollo di `domande` (art. B.5: "la domanda è
-- protocollata automaticamente"). Formato generato lato applicativo/SQL:
-- 'DOM-' || anno corrente || '-' || progressivo 6 cifre, es. DOM-2026-000042.
CREATE SEQUENCE domande_protocollo_seq;
```

`db/migrations/000009_sequenza_protocollo_domande.down.sql`:
```sql
DROP SEQUENCE domande_protocollo_seq;
```

Applica a mano contro Postgres locale per verificarla (stesso pattern di ogni migration precedente in questo progetto — CLAUDE.md, sezione "Schema DB"):
```
psql postgresql://postgres:test@localhost:5432/palestre -f db/migrations/000009_sequenza_protocollo_domande.up.sql
```
Verifica che esista: `psql ... -c "SELECT nextval('domande_protocollo_seq');"` deve restituire `1`.

#### Passo 2: `backend-node/src/domande.ts` — tipi e repository di creazione/lettura

```typescript
import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

export type StatoDomanda = 'presentata' | 'ammessa' | 'esclusa' | 'riesame_richiesto' | 'riesame_deciso';

export interface Preferenza {
  slotId: string;
  ordinePreferenza: number;
}

export interface BloccoAllenamento {
  id: string;
  slotIds: string[];
}

export interface RichiestaGiornataGara {
  id: string;
  federazione: string;
  campionato: string;
  categoria: string;
  requisitiTecnici: string | null;
  necessitaImpiantoOmologato: boolean;
  stato: 'in_esame' | 'assegnata' | 'non_assegnata';
}

export interface Domanda {
  id: string;
  numeroProtocollo: string;
  associazioneId: string;
  stagioneId: string;
  presentataDaPersonaFisicaId: string;
  presentataIl: string;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  numeroSquadreFederaliStagionePrecedente: number;
  attivitaGiovanile: boolean;
  attivitaAgonistica: boolean;
  attivitaParalimpicaInclusiva: boolean;
  classeAttivitaCodice: string | null;
  livelloCampionato: string | null;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
  richiedeGiornataGara: boolean;
  stato: StatoDomanda;
  motivazioneEsclusione: string | null;
  discipline: string[];
  preferenze: Preferenza[];
  blocchiAllenamento: BloccoAllenamento[];
  richiesteGiornataGara: RichiestaGiornataGara[];
}

interface RigaDomanda {
  id: string;
  numero_protocollo: string;
  associazione_id: string;
  stagione_id: string;
  presentata_da_persona_fisica_id: string;
  presentata_il: Date;
  numero_tesserati: number;
  numero_atleti_partecipanti: number;
  numero_squadre: number;
  numero_squadre_federali_stagione_precedente: number;
  attivita_giovanile: boolean;
  attivita_agonistica: boolean;
  attivita_paralimpica_inclusiva: boolean;
  classe_attivita_codice: string | null;
  livello_campionato: string | null;
  fabbisogno_minimo_minuti: string;
  fabbisogno_ottimale_minuti: string;
  richiede_giornata_gara: boolean;
  stato: StatoDomanda;
  motivazione_esclusione: string | null;
}

// presentata_il è TIMESTAMPTZ: il driver pg lo restituisce come Date, mai come stringa —
// conversione esplicita a .toISOString(), stesso motivo già documentato in
// repository/parametrico.ts per validaDal/creataIl.
const COLONNE_SELECT_DOMANDA = `id, numero_protocollo, associazione_id, stagione_id,
  presentata_da_persona_fisica_id, presentata_il, numero_tesserati, numero_atleti_partecipanti,
  numero_squadre, numero_squadre_federali_stagione_precedente, attivita_giovanile,
  attivita_agonistica, attivita_paralimpica_inclusiva, classe_attivita_codice, livello_campionato,
  fabbisogno_minimo_minuti::text, fabbisogno_ottimale_minuti::text, richiede_giornata_gara,
  stato, motivazione_esclusione`;

interface Correlati {
  discipline: string[];
  preferenze: Preferenza[];
  blocchiAllenamento: BloccoAllenamento[];
  richiesteGiornataGara: RichiestaGiornataGara[];
}

async function caricaCorrelati(db: Db, domandaId: string): Promise<Correlati> {
  const discipline = await db.query<{ disciplina_codice: string }>(
    `SELECT disciplina_codice FROM domanda_discipline WHERE domanda_id = $1 ORDER BY disciplina_codice`,
    [domandaId],
  );
  const preferenzeRes = await db.query<{ slot_id: string; ordine_preferenza: number }>(
    `SELECT slot_id, ordine_preferenza FROM preferenze WHERE domanda_id = $1 ORDER BY ordine_preferenza`,
    [domandaId],
  );
  const blocchiRes = await db.query<{ id: string }>(
    `SELECT id FROM blocchi_allenamento_richiesti WHERE domanda_id = $1 ORDER BY id`,
    [domandaId],
  );
  const blocchiAllenamento: BloccoAllenamento[] = [];
  for (const blocco of blocchiRes.rows) {
    const slotRes = await db.query<{ slot_id: string }>(
      `SELECT slot_id FROM blocco_allenamento_slot WHERE blocco_id = $1 ORDER BY slot_id`,
      [blocco.id],
    );
    blocchiAllenamento.push({ id: blocco.id, slotIds: slotRes.rows.map((r) => r.slot_id) });
  }
  const rggRes = await db.query<{
    id: string;
    federazione: string;
    campionato: string;
    categoria: string;
    requisiti_tecnici: string | null;
    necessita_impianto_omologato: boolean;
    stato: 'in_esame' | 'assegnata' | 'non_assegnata';
  }>(
    `SELECT id, federazione, campionato, categoria, requisiti_tecnici, necessita_impianto_omologato, stato
     FROM richieste_giornata_gara WHERE domanda_id = $1 ORDER BY id`,
    [domandaId],
  );
  return {
    discipline: discipline.rows.map((r) => r.disciplina_codice),
    preferenze: preferenzeRes.rows.map((r) => ({ slotId: r.slot_id, ordinePreferenza: r.ordine_preferenza })),
    blocchiAllenamento,
    richiesteGiornataGara: rggRes.rows.map((r) => ({
      id: r.id,
      federazione: r.federazione,
      campionato: r.campionato,
      categoria: r.categoria,
      requisitiTecnici: r.requisiti_tecnici,
      necessitaImpiantoOmologato: r.necessita_impianto_omologato,
      stato: r.stato,
    })),
  };
}

function assembla(r: RigaDomanda, correlati: Correlati): Domanda {
  return {
    id: r.id,
    numeroProtocollo: r.numero_protocollo,
    associazioneId: r.associazione_id,
    stagioneId: r.stagione_id,
    presentataDaPersonaFisicaId: r.presentata_da_persona_fisica_id,
    presentataIl: r.presentata_il.toISOString(),
    numeroTesserati: r.numero_tesserati,
    numeroAtletiPartecipanti: r.numero_atleti_partecipanti,
    numeroSquadre: r.numero_squadre,
    numeroSquadreFederaliStagionePrecedente: r.numero_squadre_federali_stagione_precedente,
    attivitaGiovanile: r.attivita_giovanile,
    attivitaAgonistica: r.attivita_agonistica,
    attivitaParalimpicaInclusiva: r.attivita_paralimpica_inclusiva,
    classeAttivitaCodice: r.classe_attivita_codice,
    livelloCampionato: r.livello_campionato,
    fabbisognoMinimoMinuti: r.fabbisogno_minimo_minuti,
    fabbisognoOttimaleMinuti: r.fabbisogno_ottimale_minuti,
    richiedeGiornataGara: r.richiede_giornata_gara,
    stato: r.stato,
    motivazioneEsclusione: r.motivazione_esclusione,
    discipline: correlati.discipline,
    preferenze: correlati.preferenze,
    blocchiAllenamento: correlati.blocchiAllenamento,
    richiesteGiornataGara: correlati.richiesteGiornataGara,
  };
}

export interface DatiRichiestaGiornataGara {
  federazione: string;
  campionato: string;
  categoria: string;
  requisitiTecnici?: string | undefined;
  necessitaImpiantoOmologato: boolean;
}

export interface DatiCreaDomanda {
  associazioneId: string;
  stagioneId: string;
  disciplineCodici: string[];
  classeAttivitaCodice?: string | undefined;
  livelloCampionato?: 'provinciale' | 'regionale' | 'interregionale' | 'nazionale' | undefined;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  numeroSquadreFederaliStagionePrecedente: number;
  attivitaGiovanile: boolean;
  attivitaAgonistica: boolean;
  attivitaParalimpicaInclusiva: boolean;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
  preferenze: string[];
  blocchiAllenamento: string[][];
  richiedeGiornataGara: boolean;
  richiesteGiornataGara: DatiRichiestaGiornataGara[];
}

export async function creaDomanda(
  db: Db,
  dati: DatiCreaDomanda,
  presentataDaPersonaFisicaId: string,
): Promise<Domanda> {
  let riga: RigaDomanda;
  try {
    const r = await db.query<RigaDomanda>(
      `INSERT INTO domande
         (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
          numero_tesserati, numero_atleti_partecipanti, numero_squadre,
          numero_squadre_federali_stagione_precedente, attivita_giovanile, attivita_agonistica,
          attivita_paralimpica_inclusiva, classe_attivita_codice, livello_campionato,
          fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, richiede_giornata_gara)
       VALUES
         ('DOM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('domande_protocollo_seq')::text, 6, '0'),
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING ${COLONNE_SELECT_DOMANDA}`,
      [
        dati.associazioneId,
        dati.stagioneId,
        presentataDaPersonaFisicaId,
        dati.numeroTesserati,
        dati.numeroAtletiPartecipanti,
        dati.numeroSquadre,
        dati.numeroSquadreFederaliStagionePrecedente,
        dati.attivitaGiovanile,
        dati.attivitaAgonistica,
        dati.attivitaParalimpicaInclusiva,
        dati.classeAttivitaCodice ?? null,
        dati.livelloCampionato ?? null,
        dati.fabbisognoMinimoMinuti,
        dati.fabbisognoOttimaleMinuti,
        dati.richiedeGiornataGara,
      ],
    );
    riga = r.rows[0]!;
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('esiste già una domanda di questa associazione per questa stagione');
    }
    throw err;
  }

  for (const codice of dati.disciplineCodici) {
    await db.query(`INSERT INTO domanda_discipline (domanda_id, disciplina_codice) VALUES ($1, $2)`, [riga.id, codice]);
  }
  for (let i = 0; i < dati.preferenze.length; i++) {
    await db.query(
      `INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, $3)`,
      [riga.id, dati.preferenze[i], i + 1],
    );
  }
  for (const blocco of dati.blocchiAllenamento) {
    const b = await db.query<{ id: string }>(
      `INSERT INTO blocchi_allenamento_richiesti (domanda_id) VALUES ($1) RETURNING id`,
      [riga.id],
    );
    const bloccoId = b.rows[0]!.id;
    for (const slotId of blocco) {
      await db.query(`INSERT INTO blocco_allenamento_slot (blocco_id, slot_id) VALUES ($1, $2)`, [bloccoId, slotId]);
    }
  }
  for (const rgg of dati.richiesteGiornataGara) {
    await db.query(
      `INSERT INTO richieste_giornata_gara
         (domanda_id, federazione, campionato, categoria, requisiti_tecnici, necessita_impianto_omologato)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [riga.id, rgg.federazione, rgg.campionato, rgg.categoria, rgg.requisitiTecnici ?? null, rgg.necessitaImpiantoOmologato],
    );
  }

  const correlati = await caricaCorrelati(db, riga.id);
  return assembla(riga, correlati);
}

export async function trovaDomandaPerId(db: Db, id: string): Promise<Domanda | null> {
  const r = await db.query<RigaDomanda>(`SELECT ${COLONNE_SELECT_DOMANDA} FROM domande WHERE id = $1`, [id]);
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  const correlati = await caricaCorrelati(db, riga.id);
  return assembla(riga, correlati);
}

export async function listaDomandePerAssociazione(
  db: Db,
  associazioneId: string,
  stagioneId?: string,
): Promise<Domanda[]> {
  const r = stagioneId
    ? await db.query<RigaDomanda>(
        `SELECT ${COLONNE_SELECT_DOMANDA} FROM domande WHERE associazione_id = $1 AND stagione_id = $2 ORDER BY presentata_il DESC`,
        [associazioneId, stagioneId],
      )
    : await db.query<RigaDomanda>(
        `SELECT ${COLONNE_SELECT_DOMANDA} FROM domande WHERE associazione_id = $1 ORDER BY presentata_il DESC`,
        [associazioneId],
      );
  const risultato: Domanda[] = [];
  for (const riga of r.rows) {
    const correlati = await caricaCorrelati(db, riga.id);
    risultato.push(assembla(riga, correlati));
  }
  return risultato;
}
```

Nota per l'implementatore: `ErroreNonTrovato` è importato ma non ancora usato in questo task (verrà usato nel Task 3 per `ammettiDomanda`/`escludiDomanda` nello stesso file) — se il linter/tsc segnala un import inutilizzato in questo task, è atteso e verrà consumato dal task successivo; non rimuoverlo.

#### Passo 3: `backend-node/src/pubblicoSchema.ts` — aggiungi in fondo al file

```typescript
const REGEX_MINUTI = /^\d{1,7}(\.\d{1,3})?$/; // coerente con NUMERIC(10,3) di domande.fabbisogno_*_minuti

export const schemaRichiestaGiornataGara = z.object({
  federazione: z.string().min(1),
  campionato: z.string().min(1),
  categoria: z.string().min(1),
  requisitiTecnici: z.string().min(1).optional(),
  necessitaImpiantoOmologato: z.boolean().default(true),
});

export const schemaCreaDomanda = z
  .object({
    associazioneId: z.string().uuid(),
    stagioneId: z.string().uuid(),
    disciplineCodici: z.array(z.string().min(1)).min(1),
    classeAttivitaCodice: z.string().min(1).optional(),
    livelloCampionato: z.enum(['provinciale', 'regionale', 'interregionale', 'nazionale']).optional(),
    numeroTesserati: z.number().int().min(0).default(0),
    numeroAtletiPartecipanti: z.number().int().min(0).default(0),
    numeroSquadre: z.number().int().min(0).default(0),
    numeroSquadreFederaliStagionePrecedente: z.number().int().min(0).default(0),
    attivitaGiovanile: z.boolean().default(false),
    attivitaAgonistica: z.boolean().default(false),
    attivitaParalimpicaInclusiva: z.boolean().default(false),
    fabbisognoMinimoMinuti: z.string().regex(REGEX_MINUTI),
    fabbisognoOttimaleMinuti: z.string().regex(REGEX_MINUTI),
    preferenze: z.array(z.string().uuid()).min(1),
    blocchiAllenamento: z.array(z.array(z.string().uuid()).min(2)).default([]),
    richiedeGiornataGara: z.boolean().default(false),
    richiesteGiornataGara: z.array(schemaRichiestaGiornataGara).default([]),
  })
  .refine((d) => Number(d.fabbisognoOttimaleMinuti) >= Number(d.fabbisognoMinimoMinuti), {
    message: 'fabbisognoOttimaleMinuti deve essere >= fabbisognoMinimoMinuti',
    path: ['fabbisognoOttimaleMinuti'],
  })
  .refine((d) => new Set(d.preferenze).size === d.preferenze.length, {
    message: 'preferenze contiene slotId duplicati',
    path: ['preferenze'],
  })
  .refine((d) => d.blocchiAllenamento.every((blocco) => new Set(blocco).size === blocco.length), {
    message: 'un blocco allenamento contiene slotId duplicati',
    path: ['blocchiAllenamento'],
  })
  .refine(
    (d) => d.blocchiAllenamento.every((blocco) => blocco.every((slotId) => d.preferenze.includes(slotId))),
    { message: 'ogni fascia di un blocco allenamento deve comparire anche tra le preferenze', path: ['blocchiAllenamento'] },
  )
  .refine((d) => !d.richiedeGiornataGara || d.richiesteGiornataGara.length > 0, {
    message: 'richiesteGiornataGara non può essere vuoto se richiedeGiornataGara è true',
    path: ['richiesteGiornataGara'],
  })
  .refine((d) => d.richiedeGiornataGara || d.richiesteGiornataGara.length === 0, {
    message: 'richiesteGiornataGara deve essere vuoto se richiedeGiornataGara è false',
    path: ['richiesteGiornataGara'],
  });
export type CreaDomandaRequest = z.infer<typeof schemaCreaDomanda>;
```

#### Passo 4: `backend-node/src/server.ts` — route `POST /pubblico/domande`

Aggiungi all'import esistente da `./pubblicoSchema.ts` (riga con `schemaCreaAssociazione, schemaCaricaDocumento, schemaCreaDelega`) anche `schemaCreaDomanda`:
```typescript
import { schemaCreaAssociazione, schemaCaricaDocumento, schemaCreaDelega, schemaCreaDomanda } from './pubblicoSchema.ts';
```

Aggiungi un nuovo import per `./domande.ts` (vicino agli import di `./abilitazioni.ts`):
```typescript
import { creaDomanda, trovaDomandaPerId, listaDomandePerAssociazione } from './domande.ts';
```

Aggiungi la route subito prima di `return app;` in fondo al file (dopo l'ultimo blocco `app.post('/backoffice/parametrico', ...)`):

```typescript
  // --- Pubblico: presentazione domanda (Allegato B art. B.5-B.6) ---

  app.post(
    '/pubblico/domande',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaDomanda.safeParse(req.body);
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
        const domanda = await eseguiInTransazione(pool, async (client) => {
          const d = await creaDomanda(client, parsed.data, req.persona!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'crea_domanda',
            entitaTipo: 'domande',
            entitaId: d.id,
            dettaglio: d as unknown as Record<string, unknown>,
          });
          return d;
        });
        res.status(201).json(domanda);
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

  return app;
}
```

(`trovaDomandaPerId`/`listaDomandePerAssociazione` importati qui verranno usati dal Task 2 — se tsc segnala import inutilizzato dopo questo task, è atteso.)

- [ ] **Step 1: Scrivi i test falliti per `domande.ts` — `backend-node/src/domande.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaDomanda, trovaDomandaPerId, listaDomandePerAssociazione } from './domande.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto test ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra test', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo A', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-domanda-test-${randomUUID()}`],
  );
  const slot1 = await creaSlot(pool, { stagioneId: stagione.rows[0]!.id, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slot2 = await creaSlot(pool, { stagioneId: stagione.rows[0]!.id, spazioId: spazio.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD test ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [`TSTDOM${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  return {
    disciplina,
    stagioneId: stagione.rows[0]!.id,
    slot1Id: slot1.id,
    slot2Id: slot2.id,
    associazioneId: associazione.rows[0]!.id,
    personaId: persona.rows[0]!.id,
  };
}

test('creaDomanda + trovaDomandaPerId + listaDomandePerAssociazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: fx.associazioneId,
      stagioneId: fx.stagioneId,
      disciplineCodici: [fx.disciplina.codice],
      numeroTesserati: 20,
      numeroAtletiPartecipanti: 15,
      numeroSquadre: 1,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000',
      fabbisognoOttimaleMinuti: '120.000',
      preferenze: [fx.slot1Id, fx.slot2Id],
      blocchiAllenamento: [[fx.slot1Id, fx.slot2Id]],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    fx.personaId,
  );

  assert.match(domanda.numeroProtocollo, /^DOM-\d{4}-\d{6}$/);
  assert.equal(domanda.discipline.length, 1);
  assert.equal(domanda.preferenze.length, 2);
  assert.equal(domanda.preferenze[0]?.ordinePreferenza, 1);
  assert.equal(domanda.preferenze[1]?.ordinePreferenza, 2);
  assert.equal(domanda.blocchiAllenamento.length, 1);
  assert.deepEqual(domanda.blocchiAllenamento[0]?.slotIds.sort(), [fx.slot1Id, fx.slot2Id].sort());
  assert.equal(domanda.stato, 'presentata');

  const trovata = await trovaDomandaPerId(pool, domanda.id);
  assert.equal(trovata?.id, domanda.id);

  const lista = await listaDomandePerAssociazione(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(lista.length, 1);

  await assert.rejects(
    () =>
      creaDomanda(
        pool,
        {
          associazioneId: fx.associazioneId,
          stagioneId: fx.stagioneId,
          disciplineCodici: [fx.disciplina.codice],
          numeroTesserati: 0,
          numeroAtletiPartecipanti: 0,
          numeroSquadre: 0,
          numeroSquadreFederaliStagionePrecedente: 0,
          attivitaGiovanile: false,
          attivitaAgonistica: false,
          attivitaParalimpicaInclusiva: false,
          fabbisognoMinimoMinuti: '10.000',
          fabbisognoOttimaleMinuti: '10.000',
          preferenze: [fx.slot1Id],
          blocchiAllenamento: [],
          richiedeGiornataGara: false,
          richiesteGiornataGara: [],
        },
        fx.personaId,
      ),
    ErroreValoreDuplicato,
  );
});
```

- [ ] **Step 2: Esegui e verifica FAIL**

Run (da `backend-node/`, con `TEST_DATABASE_URL` puntato a un Postgres con le migration `000001`-`000009` applicate):
```
node --test src/domande.test.ts
```
Expected: FAIL — `Cannot find module './domande.ts'` (il file repository non esiste ancora).

- [ ] **Step 3: Applica la migration 000009, crea `domande.ts` (Passo 2 sopra), aggiorna `pubblicoSchema.ts` (Passo 3) e `server.ts` (Passo 4)**

- [ ] **Step 4: Esegui e verifica PASS**

```
node --test src/domande.test.ts
```
Expected: PASS.

- [ ] **Step 5: Scrivi il test HTTP end-to-end — `backend-node/src/server.domande.test.ts`**

```typescript
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
  const cf = `TSTDOM${randomUUID().slice(0, 10).toUpperCase()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessTokenPubblico({ sub: id, codiceFiscale: cf, nome: 'Mario', cognome: 'Rossi' });
  return { id, token };
}

async function creaFixtureCompleta(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto HTTP test ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra HTTP test', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo A', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-domanda-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD HTTP test ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const associazioneId = associazione.rows[0]!.id;
  return { disciplinaCodice: disciplina.codice, stagioneId, slotId: slot.id, associazioneId };
}

async function corpoDomandaValido(fx: Awaited<ReturnType<typeof creaFixtureCompleta>>) {
  return {
    associazioneId: fx.associazioneId,
    stagioneId: fx.stagioneId,
    disciplineCodici: [fx.disciplinaCodice],
    numeroTesserati: 10,
    numeroAtletiPartecipanti: 8,
    numeroSquadre: 1,
    numeroSquadreFederaliStagionePrecedente: 0,
    fabbisognoMinimoMinuti: '60.000',
    fabbisognoOttimaleMinuti: '60.000',
    preferenze: [fx.slotId],
    blocchiAllenamento: [],
    richiedeGiornataGara: false,
    richiesteGiornataGara: [],
  };
}

test('POST /pubblico/domande', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  await t.test('senza abilitazione: 403', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(await corpoDomandaValido(fx)),
    });
    assert.equal(r.status, 403);
  });

  await t.test('con abilitazione approvata: 201, log scritto', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(await corpoDomandaValido(fx)),
    });
    assert.equal(r.status, 201);
    const body = (await r.json()) as { id: string; numeroProtocollo: string };
    assert.match(body.numeroProtocollo, /^DOM-\d{4}-\d{6}$/);

    const log = await pool.query(`SELECT azione FROM log_operazioni WHERE azione = 'crea_domanda' AND entita_id = $1`, [body.id]);
    assert.equal(log.rows.length, 1);
  });

  await t.test('doppia domanda stessa associazione+stagione: 409', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const corpo = await corpoDomandaValido(fx);
    const primo = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(primo.status, 201);
    const secondo = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(secondo.status, 409);
  });

  await t.test('fabbisognoOttimale < fabbisognoMinimo: 400', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const corpo = { ...(await corpoDomandaValido(fx)), fabbisognoMinimoMinuti: '100.000', fabbisognoOttimaleMinuti: '50.000' };
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(r.status, 400);
  });

  await t.test('blocco con slot non tra le preferenze: 400', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const slot2 = await creaSlot(pool, { stagioneId: fx.stagioneId, spazioId: (await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [fx.slotId])).rows[0]!.spazio_id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });
    const corpo = { ...(await corpoDomandaValido(fx)), blocchiAllenamento: [[fx.slotId, slot2.id]] };
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(r.status, 400);
  });

  await t.test('richiedeGiornataGara=true con richiesteGiornataGara vuoto: 400', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const corpo = { ...(await corpoDomandaValido(fx)), richiedeGiornataGara: true };
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(r.status, 400);
  });
});
```

- [ ] **Step 6: Esegui e verifica PASS**

```
node --test src/server.domande.test.ts
```
Expected: PASS (5 sotto-test).

- [ ] **Step 7: Typecheck**

```
cd backend-node && node_modules/.bin/tsc --noEmit
```
Expected: nessun errore (se il workspace pnpm dà problemi non legati al codice, usa questo fallback diretto — vedi CLAUDE.md).

- [ ] **Step 8: Commit**

```bash
git add db/migrations/000009_sequenza_protocollo_domande.up.sql db/migrations/000009_sequenza_protocollo_domande.down.sql backend-node/src/domande.ts backend-node/src/pubblicoSchema.ts backend-node/src/server.ts backend-node/src/domande.test.ts backend-node/src/server.domande.test.ts
git commit -m "feat(backend): presentazione domanda pubblica (art. B.5-B.6)"
```

---

### Task 2: Lettura pubblica della propria domanda

**Files:**
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.domande.test.ts` (estendi il file del Task 1)

**Interfaces:**
- Consuma: `trovaDomandaPerId`, `listaDomandePerAssociazione` (già importati in `server.ts` dal Task 1), `trovaAbilitazioneAttiva`.
- Non introduce nuove funzioni repository.

Aggiungi due route in `server.ts`, subito dopo la route `POST /pubblico/domande` (Task 1) e prima di `return app;`:

```typescript
  app.get(
    '/pubblico/associazioni/:associazioneId/domande',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const associazioneId = typeof req.params.associazioneId === 'string' ? req.params.associazioneId : '';
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      try {
        const abilitazione = await pool.query(
          `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato IN ('in_attesa', 'approvata') LIMIT 1`,
          [req.persona!.sub, associazioneId],
        );
        if (abilitazione.rows.length === 0) {
          res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione' });
          return;
        }
        res.status(200).json(await listaDomandePerAssociazione(pool, associazioneId, stagioneId));
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

  app.get('/pubblico/domande/:id', richiedeAutenticazionePubblico, async (req: RequestAutenticataPubblico, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    try {
      const domanda = await trovaDomandaPerId(pool, id);
      if (!domanda) {
        res.status(404).json({ errore: 'domanda non trovata' });
        return;
      }
      const abilitazione = await pool.query(
        `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato IN ('in_attesa', 'approvata') LIMIT 1`,
        [req.persona!.sub, domanda.associazioneId],
      );
      if (abilitazione.rows.length === 0) {
        res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione' });
        return;
      }
      res.status(200).json(domanda);
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  return app;
}
```

(La verifica su `associazioneId` usa `stato IN ('in_attesa','approvata')`, stesso pattern già in uso per l'upload documenti — non solo `'approvata'` come `trovaAbilitazioneAttiva`, perché qui basta dimostrare un legame con l'associazione per leggerne le domande, non per presentarne una nuova.)

- [ ] **Step 1: Aggiungi i test falliti in `server.domande.test.ts`** (nuovo blocco `test(...)` in fondo al file)

```typescript
test('GET /pubblico/associazioni/:id/domande e GET /pubblico/domande/:id', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const altraPersona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };

  await t.test('lista propria: 200', async () => {
    const r = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/domande`, {
      headers: { Authorization: `Bearer ${persona.token}` },
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as unknown[];
    assert.equal(body.length, 1);
  });

  await t.test('lista di associazione altrui: 403', async () => {
    const r = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/domande`, {
      headers: { Authorization: `Bearer ${altraPersona.token}` },
    });
    assert.equal(r.status, 403);
  });

  await t.test('dettaglio proprio: 200', async () => {
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert.equal(r.status, 200);
  });

  await t.test('dettaglio di associazione altrui: 403', async () => {
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${altraPersona.token}` } });
    assert.equal(r.status, 403);
  });

  await t.test('dettaglio inesistente: 404', async () => {
    const r = await fetch(`${base}/pubblico/domande/${randomUUID()}`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert.equal(r.status, 404);
  });

  await t.test('dettaglio id malformato: 400', async () => {
    const r = await fetch(`${base}/pubblico/domande/non-un-uuid`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert.equal(r.status, 400);
  });
});
```

- [ ] **Step 2: Run — verifica FAIL** (`node --test src/server.domande.test.ts`, atteso 404/altro perché le route non esistono ancora — Express risponde 404 di default su path sconosciuto, quindi il test `dettaglio id malformato: 400` fallirà con 404 ricevuto invece di 400)

- [ ] **Step 3: Aggiungi le due route in `server.ts` come sopra**

- [ ] **Step 4: Run — verifica PASS**

```
node --test src/server.domande.test.ts
```

- [ ] **Step 5: Typecheck** — `node_modules/.bin/tsc --noEmit` da `backend-node/`

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.domande.test.ts
git commit -m "feat(backend): lettura pubblica propria domanda"
```

---

### Task 3: Verifica ammissibilità backoffice (`ammetti`/`escludi`) + lista/dettaglio backoffice

**Files:**
- Modify: `backend-node/src/erroriDominio.ts`
- Modify: `backend-node/src/domande.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/domande.test.ts` (estendi)
- Test: `backend-node/src/server.domande.test.ts` (estendi)

**Interfaces:**
- Produce: `erroriDominio.ts` esporta `ErroreStatoNonValidoPerTransizione` (nuova classe, mappata 409).
- Produce: `domande.ts` esporta `ammettiDomanda(db: Db, id: string): Promise<Domanda>`, `escludiDomanda(db: Db, id: string, motivazione: string): Promise<Domanda>`, `listaDomandeBackoffice(db: Db, stagioneId?: string): Promise<Domanda[]>`, `trovaDomandaConEsitoPerId(db: Db, id: string): Promise<DomandaConEsito | null>`, tipo `DomandaConEsito` (estende `Domanda` con `fabbisognoRiconosciuto` e `coefficienti` nullable).
- Consuma da `backofficeSchema.ts`: `schemaRespingiDelega` (riusato tale e quale per il body `{motivazione}` di `escludi` — stessa shape, niente duplicazione).

#### Passo 1: `erroriDominio.ts` — aggiungi in fondo al file

```typescript
// Guardia di transizione di stato: un'operazione che richiede la macchina a stati in un
// punto preciso (es. ammetti/escludi solo da 'presentata', decisione osservazione solo da
// 'in_esame') la trova altrove. Sempre 409 — la richiesta è sintatticamente valida ma non
// applicabile allo stato corrente della risorsa, stesso motivo di ErroreValoreDuplicato ma
// senza vincolo UNIQUE coinvolto.
export class ErroreStatoNonValidoPerTransizione extends Error {}
```

#### Passo 2: `domande.ts` — aggiungi in fondo al file

```typescript
export async function ammettiDomanda(db: Db, id: string): Promise<Domanda> {
  const check = await db.query<{ stato: StatoDomanda }>(`SELECT stato FROM domande WHERE id = $1`, [id]);
  const riga = check.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('domanda non trovata');
  }
  if (riga.stato !== 'presentata') {
    throw new ErroreStatoNonValidoPerTransizione('la domanda non è in stato presentata');
  }
  await db.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [id]);
  return (await trovaDomandaPerId(db, id))!;
}

export async function escludiDomanda(db: Db, id: string, motivazione: string): Promise<Domanda> {
  const check = await db.query<{ stato: StatoDomanda }>(`SELECT stato FROM domande WHERE id = $1`, [id]);
  const riga = check.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('domanda non trovata');
  }
  if (riga.stato !== 'presentata') {
    throw new ErroreStatoNonValidoPerTransizione('la domanda non è in stato presentata');
  }
  await db.query(`UPDATE domande SET stato = 'esclusa', motivazione_esclusione = $2 WHERE id = $1`, [id, motivazione]);
  return (await trovaDomandaPerId(db, id))!;
}

export async function listaDomandeBackoffice(db: Db, stagioneId?: string): Promise<Domanda[]> {
  const r = stagioneId
    ? await db.query<RigaDomanda>(`SELECT ${COLONNE_SELECT_DOMANDA} FROM domande WHERE stagione_id = $1 ORDER BY presentata_il DESC`, [stagioneId])
    : await db.query<RigaDomanda>(`SELECT ${COLONNE_SELECT_DOMANDA} FROM domande ORDER BY presentata_il DESC`);
  const risultato: Domanda[] = [];
  for (const riga of r.rows) {
    const correlati = await caricaCorrelati(db, riga.id);
    risultato.push(assembla(riga, correlati));
  }
  return risultato;
}

export interface EsitoIstruttoria {
  frCalcolatoMinuti: string;
  fdMinuti: string;
  frFinaleMinuti: string;
}

export interface EsitoCoefficienti {
  crs: string;
  caa: string;
  csd: string;
  cp: string;
}

export interface DomandaConEsito extends Domanda {
  fabbisognoRiconosciuto: EsitoIstruttoria | null;
  coefficienti: EsitoCoefficienti | null;
}

export async function trovaDomandaConEsitoPerId(db: Db, id: string): Promise<DomandaConEsito | null> {
  const base = await trovaDomandaPerId(db, id);
  if (!base) {
    return null;
  }
  const r = await db.query<{
    fr_calcolato_minuti: string | null;
    fd_minuti: string | null;
    fr_finale_minuti: string | null;
    crs: string | null;
    caa: string | null;
    csd: string | null;
    cp: string | null;
  }>(
    `SELECT fr.fr_calcolato_minuti::text, fr.fd_minuti::text, fr.fr_finale_minuti::text,
            c.crs::text, c.caa::text, c.csd::text, c.cp::text
     FROM domande d
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = d.id
     LEFT JOIN coefficienti_associazione c ON c.domanda_id = d.id
     WHERE d.id = $1`,
    [id],
  );
  const riga = r.rows[0];
  const fabbisognoRiconosciuto =
    riga?.fr_calcolato_minuti != null
      ? { frCalcolatoMinuti: riga.fr_calcolato_minuti, fdMinuti: riga.fd_minuti!, frFinaleMinuti: riga.fr_finale_minuti! }
      : null;
  const coefficienti =
    riga?.crs != null ? { crs: riga.crs, caa: riga.caa!, csd: riga.csd!, cp: riga.cp! } : null;
  return { ...base, fabbisognoRiconosciuto, coefficienti };
}
```

Aggiorna l'import in cima a `domande.ts` per includere la nuova classe:
```typescript
import { ErroreValoreDuplicato, ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
```

#### Passo 3: `server.ts` — nuovi import e route

Estendi l'import da `./domande.ts`:
```typescript
import {
  creaDomanda,
  trovaDomandaPerId,
  listaDomandePerAssociazione,
  ammettiDomanda,
  escludiDomanda,
  listaDomandeBackoffice,
  trovaDomandaConEsitoPerId,
} from './domande.ts';
```
Aggiungi `ErroreStatoNonValidoPerTransizione` all'import esistente da `./erroriDominio.ts`:
```typescript
import { ErroreValoreDuplicato, ErroreNonTrovato, ErroreStatoNonValidoPerTransizione, comeErroreRiferimentoNonValido } from './erroriDominio.ts';
```
Aggiungi `schemaRespingiDelega` se non già importato in questo scope (è già importato — vedi riga con `schemaCreaStagione, schemaRespingiDelega, ...` in cima al file, riusala tale e quale, nessun nuovo schema).

Route, subito prima di `return app;`:

```typescript
  // --- Backoffice: verifica ammissibilità domanda (art. B.7) ---

  app.put(
    '/backoffice/domande/:id/ammetti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const domanda = await eseguiInTransazione(pool, async (client) => {
          const d = await ammettiDomanda(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'ammetti_domanda',
            entitaTipo: 'domande',
            entitaId: d.id,
            dettaglio: { stato: d.stato },
          });
          return d;
        });
        res.status(200).json(domanda);
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
    '/backoffice/domande/:id/escludi',
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
        const domanda = await eseguiInTransazione(pool, async (client) => {
          const d = await escludiDomanda(client, id, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'escludi_domanda',
            entitaTipo: 'domande',
            entitaId: d.id,
            dettaglio: { stato: d.stato, motivazioneEsclusione: d.motivazioneEsclusione },
          });
          return d;
        });
        res.status(200).json(domanda);
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

  app.get('/backoffice/domande', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    try {
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      res.status(200).json(await listaDomandeBackoffice(pool, stagioneId));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/domande/:id', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    try {
      const domanda = await trovaDomandaConEsitoPerId(pool, id);
      if (!domanda) {
        res.status(404).json({ errore: 'domanda non trovata' });
        return;
      }
      res.status(200).json(domanda);
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  return app;
}
```

- [ ] **Step 1: Aggiungi test unit falliti a `domande.test.ts`** (nuovo blocco `test(...)`)

```typescript
test('ammettiDomanda + escludiDomanda + listaDomandeBackoffice + trovaDomandaConEsitoPerId', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const domanda1 = await creaDomanda(
    pool,
    {
      associazioneId: fx.associazioneId,
      stagioneId: fx.stagioneId,
      disciplineCodici: [fx.disciplina.codice],
      numeroTesserati: 0,
      numeroAtletiPartecipanti: 0,
      numeroSquadre: 0,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: false,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '30.000',
      fabbisognoOttimaleMinuti: '30.000',
      preferenze: [fx.slot1Id],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    fx.personaId,
  );

  const ammessa = await ammettiDomanda(pool, domanda1.id);
  assert.equal(ammessa.stato, 'ammessa');

  await assert.rejects(() => ammettiDomanda(pool, domanda1.id), ErroreStatoNonValidoPerTransizione);
  await assert.rejects(() => ammettiDomanda(pool, randomUUID()), ErroreNonTrovato);

  const lista = await listaDomandeBackoffice(pool, fx.stagioneId);
  assert.ok(lista.some((d) => d.id === domanda1.id));

  const conEsito = await trovaDomandaConEsitoPerId(pool, domanda1.id);
  assert.equal(conEsito?.fabbisognoRiconosciuto, null);
  assert.equal(conEsito?.coefficienti, null);
});
```

Aggiungi gli import necessari in cima a `domande.test.ts`:
```typescript
import { ammettiDomanda, escludiDomanda, listaDomandeBackoffice, trovaDomandaConEsitoPerId } from './domande.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
```
(unisci con l'import già esistente da `./domande.ts` in un'unica riga d'import, non duplicarla)

- [ ] **Step 2: Run — verifica FAIL** (`node --test src/domande.test.ts`)

- [ ] **Step 3: Applica Passo 1 e Passo 2 sopra** (`erroriDominio.ts`, `domande.ts`)

- [ ] **Step 4: Run — verifica PASS**

- [ ] **Step 5: Aggiungi test HTTP falliti a `server.domande.test.ts`**

```typescript
test('PUT /backoffice/domande/:id/{ammetti,escludi}, GET /backoffice/domande', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };

  const operatore = await creaUtenteBackofficeTest(pool, 'operatore');

  await t.test('pubblico non può ammettere: 401', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, { method: 'PUT' });
    assert.equal(r.status, 401);
  });

  await t.test('operatore ammette: 200', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { stato: string };
    assert.equal(body.stato, 'ammessa');
  });

  await t.test('doppia ammissione: 409', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(r.status, 409);
  });

  await t.test('escludi su domanda già ammessa: 409', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}/escludi`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
      body: JSON.stringify({ motivazione: 'test' }),
    });
    assert.equal(r.status, 409);
  });

  await t.test('lista backoffice: 200, contiene la domanda', async () => {
    const r = await fetch(`${base}/backoffice/domande?stagioneId=${fx.stagioneId}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { id: string }[];
    assert.ok(body.some((d) => d.id === domanda.id));
  });

  await t.test('dettaglio backoffice: 200, fabbisognoRiconosciuto null', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { fabbisognoRiconosciuto: unknown };
    assert.equal(body.fabbisognoRiconosciuto, null);
  });
});
```

Serve un helper `creaUtenteBackofficeTest` in `server.domande.test.ts` (non esiste ancora in questo file — copialo identico da `server.parametrico.test.ts`):
```typescript
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';

async function creaUtenteBackofficeTest(pool: Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `domande-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Domande', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}
```

- [ ] **Step 6: Run — verifica FAIL, poi applica Passo 3 (`server.ts`), poi run — verifica PASS**

- [ ] **Step 7: Typecheck** — `node_modules/.bin/tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add backend-node/src/erroriDominio.ts backend-node/src/domande.ts backend-node/src/server.ts backend-node/src/domande.test.ts backend-node/src/server.domande.test.ts
git commit -m "feat(backend): verifica ammissibilità domanda + lista/dettaglio backoffice (art. B.7)"
```

---

### Task 4: Pubblicazione esiti (art. B.10)

**Files:**
- Modify: `backend-node/src/domande.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/domande.test.ts` (estendi)
- Test: `backend-node/src/server.domande.test.ts` (estendi)

**Interfaces:**
- Produce: `domande.ts` esporta `EsitoPubblicato` (tipo) e `elencoEsitiPubblicati(db: Db, stagioneId: string): Promise<EsitoPubblicato[]>`.

#### Passo 1: `domande.ts` — aggiungi in fondo al file

```typescript
export interface EsitoPubblicato {
  domandaId: string;
  associazioneId: string;
  stato: StatoDomanda;
  motivazioneEsclusione: string | null;
  fabbisognoRiconosciuto: EsitoIstruttoria | null;
  coefficienti: EsitoCoefficienti | null;
}

export async function elencoEsitiPubblicati(db: Db, stagioneId: string): Promise<EsitoPubblicato[]> {
  const r = await db.query<{
    id: string;
    associazione_id: string;
    stato: StatoDomanda;
    motivazione_esclusione: string | null;
    fr_calcolato_minuti: string | null;
    fd_minuti: string | null;
    fr_finale_minuti: string | null;
    crs: string | null;
    caa: string | null;
    csd: string | null;
    cp: string | null;
  }>(
    `SELECT d.id, d.associazione_id, d.stato, d.motivazione_esclusione,
            fr.fr_calcolato_minuti::text, fr.fd_minuti::text, fr.fr_finale_minuti::text,
            c.crs::text, c.caa::text, c.csd::text, c.cp::text
     FROM domande d
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = d.id
     LEFT JOIN coefficienti_associazione c ON c.domanda_id = d.id
     WHERE d.stagione_id = $1 AND d.stato <> 'presentata'
     ORDER BY d.presentata_il`,
    [stagioneId],
  );
  return r.rows.map((riga) => ({
    domandaId: riga.id,
    associazioneId: riga.associazione_id,
    stato: riga.stato,
    motivazioneEsclusione: riga.motivazione_esclusione,
    fabbisognoRiconosciuto:
      riga.fr_calcolato_minuti != null
        ? { frCalcolatoMinuti: riga.fr_calcolato_minuti, fdMinuti: riga.fd_minuti!, frFinaleMinuti: riga.fr_finale_minuti! }
        : null,
    coefficienti: riga.crs != null ? { crs: riga.crs, caa: riga.caa!, csd: riga.csd!, cp: riga.cp! } : null,
  }));
}
```

#### Passo 2: `server.ts`

Aggiungi `elencoEsitiPubblicati` all'import esistente da `./domande.ts`. Route, prima di `return app;`:

```typescript
  // --- Pubblico: pubblicazione esiti istruttoria (art. B.10) ---

  app.get(
    '/pubblico/stagioni/:stagioneId/domande/esiti',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.stagioneId === 'string' ? req.params.stagioneId : '';
      try {
        res.status(200).json(await elencoEsitiPubblicati(pool, stagioneId));
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

- [ ] **Step 1: Test unit fallito in `domande.test.ts`**

```typescript
test('elencoEsitiPubblicati esclude le domande ancora presentata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);
  const dati = {
    associazioneId: fx.associazioneId,
    stagioneId: fx.stagioneId,
    disciplineCodici: [fx.disciplina.codice],
    numeroTesserati: 0,
    numeroAtletiPartecipanti: 0,
    numeroSquadre: 0,
    numeroSquadreFederaliStagionePrecedente: 0,
    attivitaGiovanile: false,
    attivitaAgonistica: false,
    attivitaParalimpicaInclusiva: false,
    fabbisognoMinimoMinuti: '30.000',
    fabbisognoOttimaleMinuti: '30.000',
    preferenze: [fx.slot1Id],
    blocchiAllenamento: [],
    richiedeGiornataGara: false,
    richiesteGiornataGara: [],
  };
  const domanda = await creaDomanda(pool, dati, fx.personaId);

  const primaAmmissione = await elencoEsitiPubblicati(pool, fx.stagioneId);
  assert.equal(primaAmmissione.length, 0);

  await ammettiDomanda(pool, domanda.id);
  const dopoAmmissione = await elencoEsitiPubblicati(pool, fx.stagioneId);
  assert.equal(dopoAmmissione.length, 1);
  assert.equal(dopoAmmissione[0]?.stato, 'ammessa');
  assert.equal(dopoAmmissione[0]?.fabbisognoRiconosciuto, null);
});
```
Aggiungi `elencoEsitiPubblicati` all'import esistente da `./domande.ts` in cima al file.

- [ ] **Step 2: Run — FAIL, poi applica Passo 1 sopra, poi run — PASS**

- [ ] **Step 3: Test HTTP in `server.domande.test.ts`**

```typescript
test('GET /pubblico/stagioni/:id/domande/esiti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };

  await t.test('senza token: 401', async () => {
    const r = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/domande/esiti`);
    assert.equal(r.status, 401);
  });

  await t.test('prima della decisione: lista vuota', async () => {
    const r = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/domande/esiti`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  });

  const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
  await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, { method: 'PUT', headers: { Authorization: `Bearer ${operatore.token}` } });

  await t.test('dopo ammissione: presente, esito ammessa', async () => {
    const r = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/domande/esiti`, { headers: { Authorization: `Bearer ${persona.token}` } });
    const body = (await r.json()) as { domandaId: string; stato: string }[];
    assert.ok(body.some((e) => e.domandaId === domanda.id && e.stato === 'ammessa'));
  });
});
```

- [ ] **Step 4: Run — FAIL, poi applica Passo 2 sopra (`server.ts`), poi run — PASS**

- [ ] **Step 5: Typecheck** — `node_modules/.bin/tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/domande.ts backend-node/src/server.ts backend-node/src/domande.test.ts backend-node/src/server.domande.test.ts
git commit -m "feat(backend): pubblicazione esiti istruttoria (art. B.10)"
```

---

### Task 5: Presentazione osservazione (art. B.11, parte pubblica)

**Files:**
- Create: `backend-node/src/osservazioni.ts`
- Modify: `backend-node/src/pubblicoSchema.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/osservazioni.test.ts` (nuovo)
- Test: `backend-node/src/server.domande.test.ts` (estendi)

**Interfaces:**
- Produce: `osservazioni.ts` esporta `Osservazione`, `presentaOsservazione(db: Db, dati: { domandaId: string; personaFisicaId: string; testo: string }): Promise<Osservazione>`, `trovaOsservazionePerId(db: Db, id: string): Promise<Osservazione | null>`.
- Consuma: `ErroreNonTrovato`, `ErroreStatoNonValidoPerTransizione` (`erroriDominio.ts`).

#### Passo 1: `backend-node/src/osservazioni.ts`

```typescript
import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
import type { StatoDomanda } from './domande.ts';

export interface Osservazione {
  id: string;
  domandaId: string;
  presentataDaPersonaFisicaId: string;
  testo: string;
  presentataIl: string;
  stato: 'in_esame' | 'accolta' | 'respinta';
  decisioneMotivazione: string | null;
  decisaIl: string | null;
  decisaDa: string | null;
}

interface RigaOsservazione {
  id: string;
  domanda_id: string;
  presentata_da_persona_fisica_id: string;
  testo: string;
  presentata_il: Date;
  stato: 'in_esame' | 'accolta' | 'respinta';
  decisione_motivazione: string | null;
  decisa_il: Date | null;
  decisa_da: string | null;
}

const COLONNE_SELECT_OSSERVAZIONE = `id, domanda_id, presentata_da_persona_fisica_id, testo,
  presentata_il, stato, decisione_motivazione, decisa_il, decisa_da`;

function daRiga(r: RigaOsservazione): Osservazione {
  return {
    id: r.id,
    domandaId: r.domanda_id,
    presentataDaPersonaFisicaId: r.presentata_da_persona_fisica_id,
    testo: r.testo,
    presentataIl: r.presentata_il.toISOString(),
    stato: r.stato,
    decisioneMotivazione: r.decisione_motivazione,
    decisaIl: r.decisa_il ? r.decisa_il.toISOString() : null,
    decisaDa: r.decisa_da,
  };
}

const STATI_DOMANDA_OSSERVABILI: StatoDomanda[] = ['ammessa', 'esclusa', 'riesame_richiesto'];

export async function presentaOsservazione(
  db: Db,
  dati: { domandaId: string; personaFisicaId: string; testo: string },
): Promise<Osservazione> {
  const check = await db.query<{ stato: StatoDomanda }>(`SELECT stato FROM domande WHERE id = $1`, [dati.domandaId]);
  const domanda = check.rows[0];
  if (!domanda) {
    throw new ErroreNonTrovato('domanda non trovata');
  }
  if (!STATI_DOMANDA_OSSERVABILI.includes(domanda.stato)) {
    throw new ErroreStatoNonValidoPerTransizione('la domanda non ha ancora un esito pubblicato');
  }
  const r = await db.query<RigaOsservazione>(
    `INSERT INTO osservazioni_istruttoria (domanda_id, presentata_da_persona_fisica_id, testo)
     VALUES ($1, $2, $3)
     RETURNING ${COLONNE_SELECT_OSSERVAZIONE}`,
    [dati.domandaId, dati.personaFisicaId, dati.testo],
  );
  if (domanda.stato !== 'riesame_richiesto') {
    await db.query(`UPDATE domande SET stato = 'riesame_richiesto' WHERE id = $1`, [dati.domandaId]);
  }
  return daRiga(r.rows[0]!);
}

export async function trovaOsservazionePerId(db: Db, id: string): Promise<Osservazione | null> {
  const r = await db.query<RigaOsservazione>(`SELECT ${COLONNE_SELECT_OSSERVAZIONE} FROM osservazioni_istruttoria WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}
```

#### Passo 2: `pubblicoSchema.ts` — aggiungi in fondo

```typescript
export const schemaCreaOsservazione = z.object({
  testo: z.string().min(1),
});
export type CreaOsservazioneRequest = z.infer<typeof schemaCreaOsservazione>;
```

#### Passo 3: `server.ts`

Nuovo import:
```typescript
import { presentaOsservazione, trovaOsservazionePerId } from './osservazioni.ts';
```
Aggiungi `schemaCreaOsservazione` all'import esistente da `./pubblicoSchema.ts`.

Route, prima di `return app;`:

```typescript
  // --- Pubblico: presentazione osservazione (art. B.11) ---

  app.post(
    '/pubblico/domande/:id/osservazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const domandaId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaCreaOsservazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const domanda = await trovaDomandaPerId(pool, domandaId);
        if (!domanda) {
          res.status(404).json({ errore: 'domanda non trovata' });
          return;
        }
        const abilitazione = await pool.query(
          `SELECT ruolo FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato = 'approvata' LIMIT 1`,
          [req.persona!.sub, domanda.associazioneId],
        );
        const ruoloDelegante = abilitazione.rows[0]?.ruolo as string | undefined;
        if (!ruoloDelegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione' });
          return;
        }
        const osservazione = await eseguiInTransazione(pool, async (client) => {
          const o = await presentaOsservazione(client, {
            domandaId,
            personaFisicaId: req.persona!.sub,
            testo: parsed.data.testo,
          });
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: domanda.associazioneId, ruolo: ruoloDelegante },
            azione: 'presenta_osservazione',
            entitaTipo: 'osservazioni_istruttoria',
            entitaId: o.id,
            dettaglio: o as unknown as Record<string, unknown>,
          });
          return o;
        });
        res.status(201).json(osservazione);
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

  return app;
}
```

(`trovaOsservazionePerId` importato qui verrà usato dal Task 6 — import inutilizzato atteso fino ad allora.)

- [ ] **Step 1: Test unit falliti — `backend-node/src/osservazioni.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { presentaOsservazione, trovaOsservazionePerId } from './osservazioni.ts';
import { creaDomanda, ammettiDomanda } from './domande.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { ErroreStatoNonValidoPerTransizione, ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaDomandaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto oss test ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra oss test', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo A', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-oss-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD oss test ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [`TSTOSS${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id,
      stagioneId,
      disciplineCodici: [disciplina.codice],
      numeroTesserati: 0,
      numeroAtletiPartecipanti: 0,
      numeroSquadre: 0,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: false,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '30.000',
      fabbisognoOttimaleMinuti: '30.000',
      preferenze: [slot.id],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  return { domanda, personaId: persona.rows[0]!.id };
}

test('presentaOsservazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { domanda, personaId } = await creaDomandaFixture(pool);

  await assert.rejects(
    () => presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'osservazione precoce' }),
    ErroreStatoNonValidoPerTransizione,
  );

  await ammettiDomanda(pool, domanda.id);
  const osservazione = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'non concordo con FR' });
  assert.equal(osservazione.stato, 'in_esame');

  const domandaAggiornata = await pool.query<{ stato: string }>(`SELECT stato FROM domande WHERE id = $1`, [domanda.id]);
  assert.equal(domandaAggiornata.rows[0]?.stato, 'riesame_richiesto');

  const seconda = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'seconda osservazione' });
  assert.equal(seconda.stato, 'in_esame');

  const trovata = await trovaOsservazionePerId(pool, osservazione.id);
  assert.equal(trovata?.id, osservazione.id);

  await assert.rejects(
    () => presentaOsservazione(pool, { domandaId: randomUUID(), personaFisicaId: personaId, testo: 'x' }),
    ErroreNonTrovato,
  );
});
```

- [ ] **Step 2: Run — FAIL** (`node --test src/osservazioni.test.ts`)

- [ ] **Step 3: Applica Passo 1 (`osservazioni.ts`)**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Test HTTP in `server.domande.test.ts`**

```typescript
test('POST /pubblico/domande/:id/osservazioni', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };

  await t.test('domanda ancora presentata: 409', async () => {
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify({ testo: 'troppo presto' }),
    });
    assert.equal(r.status, 409);
  });

  const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
  await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, { method: 'PUT', headers: { Authorization: `Bearer ${operatore.token}` } });

  await t.test('dopo ammissione: 201, domanda passa a riesame_richiesto', async () => {
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify({ testo: 'non concordo con FR' }),
    });
    assert.equal(r.status, 201);
    const dettaglio = await fetch(`${base}/pubblico/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${persona.token}` } });
    const body = (await dettaglio.json()) as { stato: string };
    assert.equal(body.stato, 'riesame_richiesto');
  });

  await t.test('senza abilitazione su quella domanda: 403', async () => {
    const altraPersona = await creaPersonaFisicaTest(pool);
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${altraPersona.token}` },
      body: JSON.stringify({ testo: 'x' }),
    });
    assert.equal(r.status, 403);
  });
});
```

- [ ] **Step 6: Run — FAIL, poi applica Passo 2 e Passo 3 sopra, poi run — PASS**

- [ ] **Step 7: Typecheck** — `node_modules/.bin/tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add backend-node/src/osservazioni.ts backend-node/src/pubblicoSchema.ts backend-node/src/server.ts backend-node/src/osservazioni.test.ts backend-node/src/server.domande.test.ts
git commit -m "feat(backend): presentazione osservazione istruttoria (art. B.11)"
```

---

### Task 6: Decisione osservazione backoffice (`accogli`/`respingi`) + consolidamento stato domanda

**Files:**
- Modify: `backend-node/src/osservazioni.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/osservazioni.test.ts` (estendi)
- Test: `backend-node/src/server.domande.test.ts` (estendi)

**Interfaces:**
- Produce: `osservazioni.ts` esporta `accogliOsservazione(db: Db, id: string, decisaDa: string): Promise<Osservazione>`, `respingiOsservazione(db: Db, id: string, decisaDa: string, motivazione: string): Promise<Osservazione>`.

#### Passo 1: `osservazioni.ts` — aggiungi in fondo al file

```typescript
async function consolidaSeCompletata(db: Db, domandaId: string): Promise<void> {
  const rimaste = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM osservazioni_istruttoria WHERE domanda_id = $1 AND stato = 'in_esame'`,
    [domandaId],
  );
  if (rimaste.rows[0]?.count === '0') {
    await db.query(`UPDATE domande SET stato = 'riesame_deciso' WHERE id = $1 AND stato = 'riesame_richiesto'`, [domandaId]);
  }
}

export async function accogliOsservazione(db: Db, id: string, decisaDa: string): Promise<Osservazione> {
  const check = await db.query<{ stato: string; domanda_id: string }>(
    `SELECT stato, domanda_id FROM osservazioni_istruttoria WHERE id = $1`,
    [id],
  );
  const riga = check.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('osservazione non trovata');
  }
  if (riga.stato !== 'in_esame') {
    throw new ErroreStatoNonValidoPerTransizione('osservazione non in esame');
  }
  await db.query(
    `UPDATE osservazioni_istruttoria SET stato = 'accolta', decisa_il = now(), decisa_da = $2 WHERE id = $1`,
    [id, decisaDa],
  );
  await consolidaSeCompletata(db, riga.domanda_id);
  return (await trovaOsservazionePerId(db, id))!;
}

export async function respingiOsservazione(db: Db, id: string, decisaDa: string, motivazione: string): Promise<Osservazione> {
  const check = await db.query<{ stato: string; domanda_id: string }>(
    `SELECT stato, domanda_id FROM osservazioni_istruttoria WHERE id = $1`,
    [id],
  );
  const riga = check.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('osservazione non trovata');
  }
  if (riga.stato !== 'in_esame') {
    throw new ErroreStatoNonValidoPerTransizione('osservazione non in esame');
  }
  await db.query(
    `UPDATE osservazioni_istruttoria SET stato = 'respinta', decisa_il = now(), decisa_da = $2, decisione_motivazione = $3 WHERE id = $1`,
    [id, decisaDa, motivazione],
  );
  await consolidaSeCompletata(db, riga.domanda_id);
  return (await trovaOsservazionePerId(db, id))!;
}
```

#### Passo 2: `server.ts`

Estendi l'import da `./osservazioni.ts`:
```typescript
import { presentaOsservazione, trovaOsservazionePerId, accogliOsservazione, respingiOsservazione } from './osservazioni.ts';
```

Route, prima di `return app;` (riusa `schemaRespingiDelega` già importato per il body `{motivazione}` di `respingi`):

```typescript
  // --- Backoffice: decisione osservazione (art. B.11) ---

  app.put(
    '/backoffice/osservazioni/:id/accogli',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const osservazione = await eseguiInTransazione(pool, async (client) => {
          const o = await accogliOsservazione(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'accogli_osservazione',
            entitaTipo: 'osservazioni_istruttoria',
            entitaId: o.id,
            dettaglio: { stato: o.stato },
          });
          return o;
        });
        res.status(200).json(osservazione);
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
    '/backoffice/osservazioni/:id/respingi',
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
        const osservazione = await eseguiInTransazione(pool, async (client) => {
          const o = await respingiOsservazione(client, id, req.utente!.sub, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'respingi_osservazione',
            entitaTipo: 'osservazioni_istruttoria',
            entitaId: o.id,
            dettaglio: { stato: o.stato, decisioneMotivazione: o.decisioneMotivazione },
          });
          return o;
        });
        res.status(200).json(osservazione);
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

  return app;
}
```

- [ ] **Step 1: Test unit falliti — estendi `osservazioni.test.ts`**

```typescript
import { accogliOsservazione, respingiOsservazione } from './osservazioni.ts';

test('accogliOsservazione + respingiOsservazione consolidano lo stato domanda', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { domanda, personaId } = await creaDomandaFixture(pool);
  await ammettiDomanda(pool, domanda.id);

  const oss1 = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'prima' });
  const oss2 = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'seconda' });

  const decisore = randomUUID();

  const accolta = await accogliOsservazione(pool, oss1.id, decisore);
  assert.equal(accolta.stato, 'accolta');

  let statoDomanda = await pool.query<{ stato: string }>(`SELECT stato FROM domande WHERE id = $1`, [domanda.id]);
  assert.equal(statoDomanda.rows[0]?.stato, 'riesame_richiesto');

  const respinta = await respingiOsservazione(pool, oss2.id, decisore, 'non fondata');
  assert.equal(respinta.stato, 'respinta');
  assert.equal(respinta.decisioneMotivazione, 'non fondata');

  statoDomanda = await pool.query<{ stato: string }>(`SELECT stato FROM domande WHERE id = $1`, [domanda.id]);
  assert.equal(statoDomanda.rows[0]?.stato, 'riesame_deciso');

  await assert.rejects(() => accogliOsservazione(pool, oss1.id, decisore), ErroreStatoNonValidoPerTransizione);
});
```

- [ ] **Step 2: Run — FAIL, poi applica Passo 1 sopra (`osservazioni.ts`), poi run — PASS**

- [ ] **Step 3: Test HTTP — estendi `server.domande.test.ts`**

```typescript
test('PUT /backoffice/osservazioni/:id/{accogli,respingi}', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };
  const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
  await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, { method: 'PUT', headers: { Authorization: `Bearer ${operatore.token}` } });
  const osservazioneRes = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify({ testo: 'non concordo' }),
  });
  const osservazione = (await osservazioneRes.json()) as { id: string };

  await t.test('pubblico non può decidere: 401', async () => {
    const r = await fetch(`${base}/backoffice/osservazioni/${osservazione.id}/accogli`, { method: 'PUT' });
    assert.equal(r.status, 401);
  });

  await t.test('respingi senza motivazione: 400', async () => {
    const r = await fetch(`${base}/backoffice/osservazioni/${osservazione.id}/respingi`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
  });

  await t.test('accogli: 200, domanda consolidata a riesame_deciso', async () => {
    const r = await fetch(`${base}/backoffice/osservazioni/${osservazione.id}/accogli`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(r.status, 200);
    const dettaglio = await fetch(`${base}/backoffice/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    const body = (await dettaglio.json()) as { stato: string };
    assert.equal(body.stato, 'riesame_deciso');
  });

  await t.test('doppia decisione: 409', async () => {
    const r = await fetch(`${base}/backoffice/osservazioni/${osservazione.id}/accogli`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(r.status, 409);
  });
});
```

- [ ] **Step 4: Run — FAIL, poi applica Passo 2 sopra (`server.ts`), poi run — PASS**

- [ ] **Step 5: Suite completa e typecheck**

```
cd backend-node && node --test "src/**/*.test.ts" && node_modules/.bin/tsc --noEmit
```
Expected: tutti i test passano (nessuna regressione sulle suite preesistenti), zero errori tsc. Ricorda: quotare il glob `"src/**/*.test.ts"` — senza quote in bash degrada silenziosamente a `*` e i test top-level (`domande.test.ts`, `osservazioni.test.ts`) non verrebbero eseguiti (gotcha già documentato in CLAUDE.md).

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/osservazioni.ts backend-node/src/server.ts backend-node/src/osservazioni.test.ts backend-node/src/server.domande.test.ts
git commit -m "feat(backend): decisione osservazione + consolidamento stato domanda (art. B.11)"
```

---

## Self-review (fatta in fase di scrittura piano)

- **Copertura spec**: presentazione domanda (Task 1) ✅, lettura pubblica (Task 2) ✅, ammissibilità (Task 3) ✅, pubblicazione esiti (Task 4) ✅, osservazione pubblica (Task 5) ✅, decisione+consolidamento (Task 6) ✅. Tutti i punti dello spec `docs/superpowers/specs/2026-08-01-domanda-osservazioni-design.md` coperti.
- **Placeholder**: nessuno — ogni step ha codice completo, nessun TBD/TODO.
- **Coerenza tipi**: `Domanda`/`StatoDomanda`/`Preferenza`/`BloccoAllenamento`/`RichiestaGiornataGara` definiti in Task 1, riusati identici in Task 3/4/5/6 senza rinominazioni. `EsitoIstruttoria`/`EsitoCoefficienti` definiti in Task 3, riusati in Task 4. `ErroreStatoNonValidoPerTransizione` definito in Task 3, riusato in Task 5/6.
- Import "anticipati" (`trovaDomandaPerId`/`listaDomandePerAssociazione` nel Task 1, `trovaOsservazionePerId` nel Task 5) sono segnalati esplicitamente come attesi finché il task successivo non li consuma — evita che un reviewer li scambi per un errore.
