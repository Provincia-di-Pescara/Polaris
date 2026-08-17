# Estensione anagrafica associazioni (Associazioni_Documenti.docx) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estendere lo schema `associazioni` e il form di accreditamento (`AccreditamentoDelegaView`, già collegato alle API reali) con tutti i campi richiesti da `documenti/Associazioni_Documenti.docx`: anagrafica estesa (RL/delegato/indirizzo/PEC/email/tipologia soggetto), iscrizione RASD + organismo sportivo affiliato, assicurazioni RCT/RCO, due referenti (sicurezza + emergenze/DAE).

**Architecture:** 4 migration additive (nessuna tocca dati esistenti), estensione di `pubblicoSchema.ts`/`associazioni.ts`/`server.ts` già esistenti (nessun nuovo file backend eccetto `organismiSportivi.ts`), estensione del form React già collegato alle API reali. Nessuna modifica al motore Go, nessuna modifica alle altre 4 view mock.

## Global Constraints

- **Niente enforcement sulla domanda stagionale**: `tipologia_soggetto` resta un campo anagrafico informativo in questo blocco. `POST /pubblico/domande` NON va toccato, resta raggiungibile da qualunque abilitazione approvata indipendentemente dalla categoria — il flusso "richiesta spot" per le 7 categorie non-sportive non è specificato, fuori scope.
- **Validazione cross-campo RL/delegato/persona OIDC**: se `delegatoNome`/`delegatoCognome` sono presenti, `req.persona.nome`/`req.persona.cognome` (claim OIDC reali) devono combaciare con essi (case-insensitive, trim); se assenti, devono combaciare con `rappresentanteLegaleNome`/`rappresentanteLegaleCognome`. Mismatch → 400. Non cambia la logica esistente che assegna sempre `titolo='legale_rappresentante'` a chi sottoscrive (`creaAbilitazionePrincipale`, invariata).
- **Massimali assicurativi**: `NUMERIC(12,2)`, letti/scritti sempre come stringa (`::text` in SQL, regex zod lato input) — mai un binding numerico diretto, stesso vincolo decimal-come-stringa già in uso in tutto il progetto per valori monetari/decimali.
- **DAE**: solo dato anagrafico statico del referente emergenze in questo blocco (marca/matricola/scadenza) — non implementa la regola operativa "DAE disponibile per prenotazione/multipli/accordo scuola", esplicitamente fuori scope.
- **`organismi_sportivi`**: tabella di lookup seedata via migration (stesso pattern di `classi_attivita`), non un enum zod hardcoded — un domani l'Ente potrà aggiungere sigle senza migration di schema (solo un INSERT).
- **Cardinalità referenti/assicurazioni**: esattamente 1 riga `associazioni_referenti` per `tipo` (`'sicurezza'`/`'emergenze_dae'`) e 1 riga `associazioni_assicurazioni` per `tipo` (`'rct'`/`'rco'`) per associazione — garantito da `UNIQUE(associazione_id, tipo)` a livello DB, non solo assunto lato applicativo.
- Italiano per nomi funzione/variabile/commenti/messaggi UI, coerente col resto del repo.

---

### Task 1: Migration — estensione schema

**Files:**
- Create: `db/migrations/000018_estensione_anagrafica_associazioni.up.sql` / `.down.sql`
- Create: `db/migrations/000019_associazioni_referenti.up.sql` / `.down.sql`
- Create: `db/migrations/000020_associazioni_assicurazioni.up.sql` / `.down.sql`
- Create: `db/migrations/000021_organismi_sportivi.up.sql` / `.down.sql`

**Interfaces:**
- Produces (usate da Task 2): colonne su `associazioni` (`rappresentante_legale_nome`, `rappresentante_legale_cognome`, `delegato_nome`, `delegato_cognome`, `indirizzo_via`, `indirizzo_civico`, `indirizzo_citta`, `pec`, `email`, `tipologia_soggetto`, `iscritta_rasd`, `organismo_sportivo_codice`, `codice_affiliazione`, `ha_personale_assunto`); tabelle `associazioni_referenti`, `associazioni_assicurazioni`, `organismi_sportivi`.

- [ ] **Step 1: `000018_estensione_anagrafica_associazioni.up.sql`**

```sql
ALTER TABLE associazioni
  ADD COLUMN rappresentante_legale_nome TEXT,
  ADD COLUMN rappresentante_legale_cognome TEXT,
  ADD COLUMN delegato_nome TEXT,
  ADD COLUMN delegato_cognome TEXT,
  ADD COLUMN indirizzo_via TEXT,
  ADD COLUMN indirizzo_civico TEXT,
  ADD COLUMN indirizzo_citta TEXT,
  ADD COLUMN pec TEXT,
  ADD COLUMN email TEXT,
  ADD COLUMN tipologia_soggetto TEXT,
  ADD COLUMN iscritta_rasd BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN organismo_sportivo_codice TEXT,
  ADD COLUMN codice_affiliazione TEXT,
  ADD COLUMN ha_personale_assunto BOOLEAN NOT NULL DEFAULT false;

-- Le colonne anagrafiche restano NULLABLE a livello DB (le righe già esistenti,
-- create prima di questo blocco, non le hanno) — l'obbligatorietà per le NUOVE
-- righe è imposta da zod (schemaCreaAssociazione, Task 2), non da un NOT NULL
-- che romperebbe le righe storiche. Stesso approccio già seguito per altre
-- estensioni additive dello schema in questo progetto.

ALTER TABLE associazioni ADD CONSTRAINT associazioni_delegato_coerente
  CHECK (num_nonnulls(delegato_nome, delegato_cognome) <> 1);

ALTER TABLE associazioni ADD CONSTRAINT associazioni_tipologia_soggetto_check
  CHECK (tipologia_soggetto IS NULL OR tipologia_soggetto IN (
    'associazione_sportiva',
    'cooperativa_ente_promozione_sportiva',
    'ente_promozione_culturale_giovanile_anziani',
    'ente_assistenza_handicap_volontariato',
    'soggetto_singolo_no_profit',
    'organizzazione_sindacale',
    'movimento_partito_politico',
    'gruppo_privati_circolo'
  ));

ALTER TABLE associazioni ADD CONSTRAINT associazioni_rasd_organismo_coerente
  CHECK (NOT iscritta_rasd OR (organismo_sportivo_codice IS NOT NULL AND codice_affiliazione IS NOT NULL));
```

- [ ] **Step 2: `000018_estensione_anagrafica_associazioni.down.sql`**

```sql
ALTER TABLE associazioni DROP CONSTRAINT associazioni_rasd_organismo_coerente;
ALTER TABLE associazioni DROP CONSTRAINT associazioni_tipologia_soggetto_check;
ALTER TABLE associazioni DROP CONSTRAINT associazioni_delegato_coerente;
ALTER TABLE associazioni
  DROP COLUMN rappresentante_legale_nome,
  DROP COLUMN rappresentante_legale_cognome,
  DROP COLUMN delegato_nome,
  DROP COLUMN delegato_cognome,
  DROP COLUMN indirizzo_via,
  DROP COLUMN indirizzo_civico,
  DROP COLUMN indirizzo_citta,
  DROP COLUMN pec,
  DROP COLUMN email,
  DROP COLUMN tipologia_soggetto,
  DROP COLUMN iscritta_rasd,
  DROP COLUMN organismo_sportivo_codice,
  DROP COLUMN codice_affiliazione,
  DROP COLUMN ha_personale_assunto;
```

- [ ] **Step 3: `000019_associazioni_referenti.up.sql`**

```sql
CREATE TABLE associazioni_referenti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associazione_id UUID NOT NULL REFERENCES associazioni(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('sicurezza', 'emergenze_dae')),
    nome TEXT NOT NULL,
    cognome TEXT NOT NULL,
    nato_a TEXT NOT NULL,
    nato_il DATE NOT NULL,
    residente_via TEXT NOT NULL,
    residente_citta TEXT NOT NULL,
    cellulare TEXT NOT NULL,
    carta_identita TEXT NOT NULL,
    dae_marca TEXT,
    dae_matricola TEXT,
    dae_scadenza DATE,
    creato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT associazioni_referenti_tipo_uq UNIQUE (associazione_id, tipo),
    -- Il DAE è dato solo dal referente 'emergenze_dae': un referente 'sicurezza'
    -- con DAE valorizzato indicherebbe un bug applicativo, non solo un dato mancante.
    CONSTRAINT associazioni_referenti_dae_coerente CHECK (
        tipo = 'emergenze_dae' OR (dae_marca IS NULL AND dae_matricola IS NULL AND dae_scadenza IS NULL)
    )
);
```

- [ ] **Step 4: `000019_associazioni_referenti.down.sql`**

```sql
DROP TABLE associazioni_referenti;
```

- [ ] **Step 5: `000020_associazioni_assicurazioni.up.sql`**

```sql
CREATE TABLE associazioni_assicurazioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associazione_id UUID NOT NULL REFERENCES associazioni(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('rct', 'rco')),
    compagnia TEXT NOT NULL,
    agenzia TEXT,
    numero_polizza TEXT NOT NULL,
    massimale NUMERIC(12,2) NOT NULL,
    copertura_dal DATE NOT NULL,
    copertura_al DATE NOT NULL,
    creato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT associazioni_assicurazioni_tipo_uq UNIQUE (associazione_id, tipo),
    CONSTRAINT associazioni_assicurazioni_periodo_valido CHECK (copertura_al > copertura_dal)
);
```

- [ ] **Step 6: `000020_associazioni_assicurazioni.down.sql`**

```sql
DROP TABLE associazioni_assicurazioni;
```

- [ ] **Step 7: `000021_organismi_sportivi.up.sql`**

```sql
CREATE TABLE organismi_sportivi (
    codice TEXT PRIMARY KEY,
    denominazione TEXT NOT NULL
);

-- Elenco 1 del documento (documenti/Associazioni_Documenti.docx): sigle degli
-- organismi sportivi affiliabili al RASD. Il documento non fornisce una
-- denominazione estesa separata dalla sigla — denominazione = codice per ora,
-- estendibile in futuro con un semplice UPDATE (nessuna migration di schema).
INSERT INTO organismi_sportivi (codice, denominazione) VALUES
    ('ACI', 'ACI'), ('ACSI', 'ACSI'), ('AICS', 'AICS'), ('ASC', 'ASC'), ('AeCI', 'AeCI'),
    ('CNS_Libertas', 'CNS_Libertas'), ('CSAIn', 'CSAIn'), ('CSEN', 'CSEN'), ('CSI', 'CSI'), ('ISI', 'ISI'),
    ('ENDAS', 'ENDAS'), ('FASI', 'FASI'), ('FCI', 'FCI'), ('FCrI', 'FCrI'), ('FGI', 'FGI'),
    ('FIB', 'FIB'), ('FIBa', 'FIBa'), ('FIC', 'FIC'), ('FICK', 'FICK'), ('FICSF', 'FICSF'),
    ('FICr', 'FICr'), ('FID', 'FID'), ('FIDAF', 'FIDAF'), ('FIDAL', 'FIDAL'), ('FIDASC', 'FIDASC'),
    ('FIDESM', 'FIDESM'), ('FIG', 'FIG'), ('FIGB', 'FIGB'), ('FIGC', 'FIGC'), ('FIGH', 'FIGH'),
    ('FIGS', 'FIGS'), ('FIGeST', 'FIGeST'), ('FIH', 'FIH'), ('FIJLKAM', 'FIJLKAM'), ('FIM', 'FIM'),
    ('FIN', 'FIN'), ('FIP', 'FIP'), ('FIPAV', 'FIPAV'), ('FIPR', 'FIPR'), ('FIPM', 'FIPM'),
    ('FIPSAS', 'FIPSAS'), ('FIPT', 'FIPT'), ('FIR', 'FIR'), ('FIRaft', 'FIRaft'), ('FIS', 'FIS'),
    ('FISB', 'FISB'), ('FISBB', 'FISBB'), ('FISE', 'FISE'), ('FISG', 'FISG'), ('FISI', 'FISI'),
    ('FISO', 'FISO'), ('FISR', 'FISR'), ('FISSW', 'FISSW'), ('FITA', 'FITA'), ('FITARCO', 'FITARCO'),
    ('FITAV', 'FITAV'), ('FITDS', 'FITDS'), ('FITP', 'FITP'), ('FITeT', 'FITeT'), ('FITri', 'FITri'),
    ('FITw', 'FITw'), ('FIV', 'FIV'), ('FIWuk', 'FIWuk'), ('FK', 'FK'), ('FMI', 'FMI'),
    ('FMSI', 'FMSI'), ('FPI', 'FPI'), ('FSI', 'FSI'), ('FederCUSI', 'FederCUSI'), ('MSP_Italia', 'MSP_Italia'),
    ('OPES', 'OPES'), ('PGS', 'PGS'), ('UISP', 'UISP'), ('UITS', 'UITS'), ('USSA', 'USSA'),
    ('US_ACLI', 'US_ACLI'), ('VSS', 'VSS');
```

- [ ] **Step 8: `000021_organismi_sportivi.down.sql`**

```sql
DROP TABLE organismi_sportivi;
```

- [ ] **Step 9: Valida le migration contro Postgres reale**

Run (container persistente `pg-palestre-dev`, avviarlo se serve — vedi `docs/claude/schema-db.md` per il flusso Docker Desktop):
```bash
docker exec -i pg-palestre-dev psql -U postgres -d palestre < db/migrations/000018_estensione_anagrafica_associazioni.up.sql
docker exec -i pg-palestre-dev psql -U postgres -d palestre < db/migrations/000019_associazioni_referenti.up.sql
docker exec -i pg-palestre-dev psql -U postgres -d palestre < db/migrations/000020_associazioni_assicurazioni.up.sql
docker exec -i pg-palestre-dev psql -U postgres -d palestre < db/migrations/000021_organismi_sportivi.up.sql
```
Expected: nessun errore. Poi verifica i down in ordine inverso (021→018) sullo stesso DB, poi riapplica gli up (021 escluso — servirà per Task 2+): conferma che l'intero ciclo up/down/up sia pulito, stesso standard già richiesto per ogni migration di questo progetto.

Se `docker exec -i ... < file.sql` fallisce silenziosamente (gotcha noto Git Bash/Windows, vedi `docs/claude/schema-db.md`), usa `docker cp` + `docker exec ... psql -f /tmp/x.sql` come da gotcha documentato.

- [ ] **Step 10: Commit**

```bash
git add db/migrations/000018_estensione_anagrafica_associazioni.up.sql db/migrations/000018_estensione_anagrafica_associazioni.down.sql db/migrations/000019_associazioni_referenti.up.sql db/migrations/000019_associazioni_referenti.down.sql db/migrations/000020_associazioni_assicurazioni.up.sql db/migrations/000020_associazioni_assicurazioni.down.sql db/migrations/000021_organismi_sportivi.up.sql db/migrations/000021_organismi_sportivi.down.sql
git commit -m "feat(schema): estende associazioni con anagrafica RASD/assicurazioni/referenti+DAE (Associazioni_Documenti.docx)"
```

---

### Task 2: Backend — repository + validazione zod

**Files:**
- Modify: `backend-node/src/associazioni.ts`
- Modify: `backend-node/src/pubblicoSchema.ts`
- Create: `backend-node/src/organismiSportivi.ts`
- Test: `backend-node/src/associazioni.test.ts` (se non esiste ancora un file di test per questo modulo, crealo; altrimenti estendilo)
- Test: `backend-node/src/organismiSportivi.test.ts`

**Interfaces:**
- Consumes: migration Task 1.
- Produces (usate da Task 3): `Associazione` estesa con tutti i nuovi campi; `DatiCreaAssociazione` estesa; `creaAssociazione` (stessa firma, ora inserisce anche le nuove colonne); `creaReferenteAssociazione(db, dati)`, `creaAssicurazioneAssociazione(db, dati)` (nuove); `listaOrganismiSportivi(db)` in `organismiSportivi.ts`; `schemaCreaAssociazione` esteso con tutti i nuovi campi e refinement.

- [ ] **Step 1: Estendi `Associazione`/`RigaAssociazione`/`DatiCreaAssociazione` in `associazioni.ts`**

Sostituisci le righe 5-38 del file attuale:

```typescript
export interface Associazione {
  id: string;
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione: string | null;
  dataCostituzione: string | null;
  rappresentanteLegaleNome: string | null;
  rappresentanteLegaleCognome: string | null;
  delegatoNome: string | null;
  delegatoCognome: string | null;
  indirizzoVia: string | null;
  indirizzoCivico: string | null;
  indirizzoCitta: string | null;
  pec: string | null;
  email: string | null;
  tipologiaSoggetto: string | null;
  iscrittaRasd: boolean;
  organismoSportivoCodice: string | null;
  codiceAffiliazione: string | null;
  haPersonaleAssunto: boolean;
}

interface RigaAssociazione {
  id: string;
  denominazione: string;
  codice_fiscale_partita_iva: string;
  rna_numero_iscrizione: string | null;
  data_costituzione: string | null;
  rappresentante_legale_nome: string | null;
  rappresentante_legale_cognome: string | null;
  delegato_nome: string | null;
  delegato_cognome: string | null;
  indirizzo_via: string | null;
  indirizzo_civico: string | null;
  indirizzo_citta: string | null;
  pec: string | null;
  email: string | null;
  tipologia_soggetto: string | null;
  iscritta_rasd: boolean;
  organismo_sportivo_codice: string | null;
  codice_affiliazione: string | null;
  ha_personale_assunto: boolean;
}

function daRiga(r: RigaAssociazione): Associazione {
  return {
    id: r.id,
    denominazione: r.denominazione,
    codiceFiscalePartitaIva: r.codice_fiscale_partita_iva,
    rnaNumeroIscrizione: r.rna_numero_iscrizione,
    dataCostituzione: r.data_costituzione,
    rappresentanteLegaleNome: r.rappresentante_legale_nome,
    rappresentanteLegaleCognome: r.rappresentante_legale_cognome,
    delegatoNome: r.delegato_nome,
    delegatoCognome: r.delegato_cognome,
    indirizzoVia: r.indirizzo_via,
    indirizzoCivico: r.indirizzo_civico,
    indirizzoCitta: r.indirizzo_citta,
    pec: r.pec,
    email: r.email,
    tipologiaSoggetto: r.tipologia_soggetto,
    iscrittaRasd: r.iscritta_rasd,
    organismoSportivoCodice: r.organismo_sportivo_codice,
    codiceAffiliazione: r.codice_affiliazione,
    haPersonaleAssunto: r.ha_personale_assunto,
  };
}

const COLONNE_SELECT = `id, denominazione, codice_fiscale_partita_iva, rna_numero_iscrizione, data_costituzione,
  rappresentante_legale_nome, rappresentante_legale_cognome, delegato_nome, delegato_cognome,
  indirizzo_via, indirizzo_civico, indirizzo_citta, pec, email, tipologia_soggetto,
  iscritta_rasd, organismo_sportivo_codice, codice_affiliazione, ha_personale_assunto`;

export interface DatiCreaAssociazione {
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione?: string | undefined;
  dataCostituzione?: string | undefined;
  rappresentanteLegaleNome: string;
  rappresentanteLegaleCognome: string;
  delegatoNome?: string | undefined;
  delegatoCognome?: string | undefined;
  indirizzoVia: string;
  indirizzoCivico: string;
  indirizzoCitta: string;
  pec?: string | undefined;
  email: string;
  tipologiaSoggetto: string;
  iscrittaRasd: boolean;
  organismoSportivoCodice?: string | undefined;
  codiceAffiliazione?: string | undefined;
  haPersonaleAssunto: boolean;
}
```

- [ ] **Step 2: Estendi `creaAssociazione`**

Sostituisci il corpo della funzione (righe 40-55 del file attuale):

```typescript
export async function creaAssociazione(db: Db, dati: DatiCreaAssociazione): Promise<Associazione> {
  try {
    const r = await db.query<RigaAssociazione>(
      `INSERT INTO associazioni (
         denominazione, codice_fiscale_partita_iva, rna_numero_iscrizione, data_costituzione,
         rappresentante_legale_nome, rappresentante_legale_cognome, delegato_nome, delegato_cognome,
         indirizzo_via, indirizzo_civico, indirizzo_citta, pec, email, tipologia_soggetto,
         iscritta_rasd, organismo_sportivo_codice, codice_affiliazione, ha_personale_assunto
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING ${COLONNE_SELECT}`,
      [
        dati.denominazione,
        dati.codiceFiscalePartitaIva,
        dati.rnaNumeroIscrizione ?? null,
        dati.dataCostituzione ?? null,
        dati.rappresentanteLegaleNome,
        dati.rappresentanteLegaleCognome,
        dati.delegatoNome ?? null,
        dati.delegatoCognome ?? null,
        dati.indirizzoVia,
        dati.indirizzoCivico,
        dati.indirizzoCitta,
        dati.pec ?? null,
        dati.email,
        dati.tipologiaSoggetto,
        dati.iscrittaRasd,
        dati.organismoSportivoCodice ?? null,
        dati.codiceAffiliazione ?? null,
        dati.haPersonaleAssunto,
      ],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('associazione già accreditata con questo codice fiscale/partita IVA');
    }
    throw err;
  }
}
```

`trovaAssociazionePerId` resta invariata nella firma, aggiorna solo la query per usare la nuova `COLONNE_SELECT` (già fatto sopra, la costante è condivisa).

- [ ] **Step 3: Aggiungi `creaReferenteAssociazione`/`creaAssicurazioneAssociazione` in fondo ad `associazioni.ts`**

```typescript
export interface ReferenteAssociazione {
  id: string;
  associazioneId: string;
  tipo: 'sicurezza' | 'emergenze_dae';
  nome: string;
  cognome: string;
  natoA: string;
  natoIl: string;
  residenteVia: string;
  residenteCitta: string;
  cellulare: string;
  cartaIdentita: string;
  daeMarca: string | null;
  daeMatricola: string | null;
  daeScadenza: string | null;
}

export interface DatiCreaReferenteAssociazione {
  associazioneId: string;
  tipo: 'sicurezza' | 'emergenze_dae';
  nome: string;
  cognome: string;
  natoA: string;
  natoIl: string;
  residenteVia: string;
  residenteCitta: string;
  cellulare: string;
  cartaIdentita: string;
  daeMarca?: string | undefined;
  daeMatricola?: string | undefined;
  daeScadenza?: string | undefined;
}

interface RigaReferente {
  id: string;
  associazione_id: string;
  tipo: 'sicurezza' | 'emergenze_dae';
  nome: string;
  cognome: string;
  nato_a: string;
  nato_il: string;
  residente_via: string;
  residente_citta: string;
  cellulare: string;
  carta_identita: string;
  dae_marca: string | null;
  dae_matricola: string | null;
  dae_scadenza: string | null;
}

function daRigaReferente(r: RigaReferente): ReferenteAssociazione {
  return {
    id: r.id,
    associazioneId: r.associazione_id,
    tipo: r.tipo,
    nome: r.nome,
    cognome: r.cognome,
    natoA: r.nato_a,
    natoIl: r.nato_il,
    residenteVia: r.residente_via,
    residenteCitta: r.residente_citta,
    cellulare: r.cellulare,
    cartaIdentita: r.carta_identita,
    daeMarca: r.dae_marca,
    daeMatricola: r.dae_matricola,
    daeScadenza: r.dae_scadenza,
  };
}

export async function creaReferenteAssociazione(db: Db, dati: DatiCreaReferenteAssociazione): Promise<ReferenteAssociazione> {
  const r = await db.query<RigaReferente>(
    `INSERT INTO associazioni_referenti (
       associazione_id, tipo, nome, cognome, nato_a, nato_il, residente_via, residente_citta,
       cellulare, carta_identita, dae_marca, dae_matricola, dae_scadenza
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, associazione_id, tipo, nome, cognome, nato_a, nato_il, residente_via, residente_citta,
       cellulare, carta_identita, dae_marca, dae_matricola, dae_scadenza`,
    [
      dati.associazioneId, dati.tipo, dati.nome, dati.cognome, dati.natoA, dati.natoIl,
      dati.residenteVia, dati.residenteCitta, dati.cellulare, dati.cartaIdentita,
      dati.daeMarca ?? null, dati.daeMatricola ?? null, dati.daeScadenza ?? null,
    ],
  );
  return daRigaReferente(r.rows[0]!);
}

export interface AssicurazioneAssociazione {
  id: string;
  associazioneId: string;
  tipo: 'rct' | 'rco';
  compagnia: string;
  agenzia: string | null;
  numeroPolizza: string;
  massimale: string;
  coperturaDal: string;
  coperturaAl: string;
}

export interface DatiCreaAssicurazioneAssociazione {
  associazioneId: string;
  tipo: 'rct' | 'rco';
  compagnia: string;
  agenzia?: string | undefined;
  numeroPolizza: string;
  massimale: string;
  coperturaDal: string;
  coperturaAl: string;
}

interface RigaAssicurazione {
  id: string;
  associazione_id: string;
  tipo: 'rct' | 'rco';
  compagnia: string;
  agenzia: string | null;
  numero_polizza: string;
  massimale: string;
  copertura_dal: string;
  copertura_al: string;
}

function daRigaAssicurazione(r: RigaAssicurazione): AssicurazioneAssociazione {
  return {
    id: r.id,
    associazioneId: r.associazione_id,
    tipo: r.tipo,
    compagnia: r.compagnia,
    agenzia: r.agenzia,
    numeroPolizza: r.numero_polizza,
    massimale: r.massimale,
    coperturaDal: r.copertura_dal,
    coperturaAl: r.copertura_al,
  };
}

export async function creaAssicurazioneAssociazione(db: Db, dati: DatiCreaAssicurazioneAssociazione): Promise<AssicurazioneAssociazione> {
  const r = await db.query<RigaAssicurazione>(
    // massimale::text: stesso vincolo decimal-come-stringa già in uso nel progetto
    // per ogni valore NUMERIC — mai un binding numerico diretto (vedi parametrico.ts).
    `INSERT INTO associazioni_assicurazioni (
       associazione_id, tipo, compagnia, agenzia, numero_polizza, massimale, copertura_dal, copertura_al
     )
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8)
     RETURNING id, associazione_id, tipo, compagnia, agenzia, numero_polizza, massimale::text, copertura_dal, copertura_al`,
    [
      dati.associazioneId, dati.tipo, dati.compagnia, dati.agenzia ?? null,
      dati.numeroPolizza, dati.massimale, dati.coperturaDal, dati.coperturaAl,
    ],
  );
  return daRigaAssicurazione(r.rows[0]!);
}
```

- [ ] **Step 2: Test `associazioni.test.ts` — estendi/crea**

Se il file non esiste già, crealo seguendo il pattern di `abilitazioni.test.ts` (import `creaDatabaseDedicato` da `./testutil/dbDedicato.ts`, fixture stagione/persona con `randomUUID()`). Aggiungi test per:
- `creaAssociazione` con tutti i nuovi campi: verifica round-trip di ogni campo.
- `creaAssociazione` con `delegatoNome` presente ma `delegatoCognome` assente: la query fallisce con il vincolo `associazioni_delegato_coerente` (23514, CHECK violation) — verifica che l'errore emerga (anche solo come eccezione Postgres grezza a questo livello, il mapping HTTP arriva nel Task 3).
- `creaReferenteAssociazione` con `tipo:'sicurezza'` e `tipo:'emergenze_dae'` (quest'ultimo con DAE valorizzato): round-trip.
- `creaAssicurazioneAssociazione` con `tipo:'rct'` e `tipo:'rco'`: round-trip, verifica che `massimale` torni come stringa (`typeof risultato.massimale === 'string'`).
- Due `creaReferenteAssociazione`/`creaAssicurazioneAssociazione` con lo stesso `tipo` sulla stessa associazione: il secondo fallisce (23505, `UNIQUE` violation).

- [ ] **Step 3: `backend-node/src/organismiSportivi.ts` (nuovo file)**

```typescript
import type { Db } from './db.ts';

export interface OrganismoSportivo {
  codice: string;
  denominazione: string;
}

export async function listaOrganismiSportivi(db: Db): Promise<OrganismoSportivo[]> {
  const r = await db.query<OrganismoSportivo>(
    `SELECT codice, denominazione FROM organismi_sportivi ORDER BY codice`,
  );
  return r.rows;
}
```

- [ ] **Step 4: `organismiSportivi.test.ts`**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { listaOrganismiSportivi } from './organismiSportivi.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'listaOrganismiSportivi restituisce l\'elenco seedato, ordinato per codice',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const lista = await listaOrganismiSportivi(pool);
    assert.ok(lista.length >= 70, `attesi almeno 70 organismi seedati, trovati ${lista.length}`);
    assert.ok(lista.some((o) => o.codice === 'UISP'));
    assert.ok(lista.some((o) => o.codice === 'FIPAV'));
    // Ordinato per codice: il primo elemento precede alfabeticamente il secondo.
    assert.ok(lista[0]!.codice < lista[1]!.codice);
  },
);
```

- [ ] **Step 5: Estendi `schemaCreaAssociazione` in `pubblicoSchema.ts`**

Sostituisci le righe 4-11 del file attuale:

```typescript
const REGEX_MASSIMALE = /^\d{1,10}(\.\d{1,2})?$/; // coerente con NUMERIC(12,2) di associazioni_assicurazioni.massimale

const TIPOLOGIE_SOGGETTO = [
  'associazione_sportiva',
  'cooperativa_ente_promozione_sportiva',
  'ente_promozione_culturale_giovanile_anziani',
  'ente_assistenza_handicap_volontariato',
  'soggetto_singolo_no_profit',
  'organizzazione_sindacale',
  'movimento_partito_politico',
  'gruppo_privati_circolo',
] as const;

const schemaReferente = z.object({
  nome: z.string().min(1),
  cognome: z.string().min(1),
  natoA: z.string().min(1),
  natoIl: zDataIso,
  residenteVia: z.string().min(1),
  residenteCitta: z.string().min(1),
  cellulare: z.string().min(1),
  cartaIdentita: z.string().min(1),
});

const schemaReferenteEmergenzeDae = schemaReferente.extend({
  daeMarca: z.string().min(1),
  daeMatricola: z.string().min(1),
  daeScadenza: zDataIso,
});

const schemaAssicurazione = z
  .object({
    compagnia: z.string().min(1),
    agenzia: z.string().min(1).optional(),
    numeroPolizza: z.string().min(1),
    massimale: z.string().regex(REGEX_MASSIMALE),
    coperturaDal: zDataIso,
    coperturaAl: zDataIso,
  })
  .refine((d) => d.coperturaAl > d.coperturaDal, {
    message: 'coperturaAl deve essere successiva a coperturaDal',
    path: ['coperturaAl'],
  });

export const schemaCreaAssociazione = z
  .object({
    denominazione: z.string().min(1),
    codiceFiscalePartitaIva: z.string().min(11).max(16),
    rnaNumeroIscrizione: z.string().min(1).optional(),
    dataCostituzione: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    stagioneId: z.string().uuid(),
    rappresentanteLegaleNome: z.string().min(1),
    rappresentanteLegaleCognome: z.string().min(1),
    delegatoNome: z.string().min(1).optional(),
    delegatoCognome: z.string().min(1).optional(),
    indirizzoVia: z.string().min(1),
    indirizzoCivico: z.string().min(1),
    indirizzoCitta: z.string().min(1),
    pec: z.string().email().optional(),
    email: z.string().email(),
    tipologiaSoggetto: z.enum(TIPOLOGIE_SOGGETTO),
    iscrittaRasd: z.boolean(),
    organismoSportivoCodice: z.string().min(1).optional(),
    codiceAffiliazione: z.string().min(1).optional(),
    haPersonaleAssunto: z.boolean(),
    referenteSicurezza: schemaReferente,
    referenteEmergenzeDae: schemaReferenteEmergenzeDae,
    assicurazioneRct: schemaAssicurazione,
    assicurazioneRco: schemaAssicurazione.optional(),
  })
  .refine((d) => (d.delegatoNome !== undefined) === (d.delegatoCognome !== undefined), {
    message: 'delegatoNome e delegatoCognome devono essere entrambi presenti o entrambi assenti',
    path: ['delegatoCognome'],
  })
  .refine((d) => !d.iscrittaRasd || (d.organismoSportivoCodice !== undefined && d.codiceAffiliazione !== undefined), {
    message: 'organismoSportivoCodice e codiceAffiliazione sono obbligatori se iscrittaRasd è true',
    path: ['organismoSportivoCodice'],
  })
  .refine((d) => d.haPersonaleAssunto === (d.assicurazioneRco !== undefined), {
    message: 'assicurazioneRco è obbligatoria se e solo se haPersonaleAssunto è true',
    path: ['assicurazioneRco'],
  });
export type CreaAssociazioneRequest = z.infer<typeof schemaCreaAssociazione>;
```

Non toccare il resto del file (`schemaCaricaDocumento`, `schemaCreaDelega`, ecc. restano invariati).

- [ ] **Step 6: Esegui i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione node --test src/associazioni.test.ts src/organismiSportivi.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `cd backend-node && pnpm exec tsc`

```bash
git add backend-node/src/associazioni.ts backend-node/src/pubblicoSchema.ts backend-node/src/organismiSportivi.ts backend-node/src/associazioni.test.ts backend-node/src/organismiSportivi.test.ts
git commit -m "feat(backend-node): estende repository/validazione associazioni con anagrafica RASD/assicurazioni/referenti"
```

---

### Task 3: Backend — route `POST /pubblico/associazioni` estesa + `GET /organismi-sportivi`

**Files:**
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.pubblico.test.ts`

**Interfaces:**
- Consumes: `creaReferenteAssociazione`/`creaAssicurazioneAssociazione` (Task 2, `associazioni.ts`), `listaOrganismiSportivi` (Task 2, `organismiSportivi.ts`), `schemaCreaAssociazione` esteso (Task 2).
- Produces: `POST /pubblico/associazioni` estesa (stessa risposta 201 `Associazione`, ora con tutti i nuovi campi); `GET /organismi-sportivi` (nuovo, pubblico non autenticato).

- [ ] **Step 1: Estendi l'import da `associazioni.ts` e aggiungi l'import da `organismiSportivi.ts`**

In `backend-node/src/server.ts`, riga 68, sostituisci:
```typescript
import { creaAssociazione, trovaAssociazionePerId, creaDocumentoAssociazione, listaDocumentiPerAssociazione, trovaDocumentoPerId } from './associazioni.ts';
```
con:
```typescript
import { creaAssociazione, trovaAssociazionePerId, creaDocumentoAssociazione, listaDocumentiPerAssociazione, trovaDocumentoPerId, creaReferenteAssociazione, creaAssicurazioneAssociazione } from './associazioni.ts';
import { listaOrganismiSportivi } from './organismiSportivi.ts';
```

- [ ] **Step 2: Estendi la route `POST /pubblico/associazioni` (righe 1069-1109 del file attuale)**

Sostituiscila con:

```typescript
  app.post(
    '/pubblico/associazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaAssociazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      // Validazione anti-frode: chi sottoscrive deve essere davvero la persona che il
      // modulo dichiara stia agendo (delegato se compilato, altrimenti il RL) — art. 53
      // Doc Principale, tracciabilità della vera persona fisica operante. Confronto
      // case-insensitive/trim: i claim OIDC e il testo libero del form possono differire
      // per maiuscole/spazi senza che sia un mismatch reale.
      const normalizza = (s: string) => s.trim().toLowerCase();
      const nomeAtteso = parsed.data.delegatoNome ?? parsed.data.rappresentanteLegaleNome;
      const cognomeAtteso = parsed.data.delegatoCognome ?? parsed.data.rappresentanteLegaleCognome;
      if (normalizza(req.persona!.nome) !== normalizza(nomeAtteso) || normalizza(req.persona!.cognome) !== normalizza(cognomeAtteso)) {
        res.status(400).json({
          errore: 'la persona autenticata non corrisponde al Rappresentante Legale o al Delegato dichiarato nel modulo',
        });
        return;
      }
      try {
        const associazione = await eseguiInTransazione(pool, async (client) => {
          const a = await creaAssociazione(client, parsed.data);
          await creaAbilitazionePrincipale(client, {
            personaFisicaId: req.persona!.sub,
            associazioneId: a.id,
            stagioneId: parsed.data.stagioneId,
          });
          await creaReferenteAssociazione(client, { associazioneId: a.id, tipo: 'sicurezza', ...parsed.data.referenteSicurezza });
          await creaReferenteAssociazione(client, { associazioneId: a.id, tipo: 'emergenze_dae', ...parsed.data.referenteEmergenzeDae });
          await creaAssicurazioneAssociazione(client, { associazioneId: a.id, tipo: 'rct', ...parsed.data.assicurazioneRct });
          if (parsed.data.assicurazioneRco) {
            await creaAssicurazioneAssociazione(client, { associazioneId: a.id, tipo: 'rco', ...parsed.data.assicurazioneRco });
          }
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

- [ ] **Step 3: Aggiungi `GET /organismi-sportivi`**

Subito dopo la route `GET /stagioni` (cerca `app.get('/stagioni', ...)` in `server.ts`), aggiungi:

```typescript
  app.get('/organismi-sportivi', async (_req, res) => {
    try {
      res.status(200).json(await listaOrganismiSportivi(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });
```

- [ ] **Step 4: Test — estendi `server.pubblico.test.ts`**

Il file esistente ha già `creaPersonaFisicaTest`/`creaStagioneTest`/`avviaServerTest` e un test `POST /pubblico/associazioni crea associazione + abilitazione in_attesa` (righe 39-90 circa) che oggi invia solo `{denominazione, codiceFiscalePartitaIva, stagioneId}`. **Aggiorna quel body** con tutti i nuovi campi obbligatori (altrimenti il test esistente comincia a fallire con 400 dopo questo task) — usa `creaPersonaFisicaTest`'s ritorno per popolare `rappresentanteLegaleNome`/`rappresentanteLegaleCognome` con lo stesso nome/cognome della persona di test ('Mario'/'Rossi', già nel body dell'helper), dato che il body del test non specifica un delegato: la validazione cross-campo del Task 3 richiede che combacino.

Aggiungi nuovi scenari:
- Body con `delegatoNome`/`delegatoCognome` che combaciano col nome/cognome della persona autenticata, `rappresentanteLegaleNome`/`Cognome` diversi: 201 (il match è sul delegato, non sul RL, quando il delegato è presente).
- Body con `delegatoNome`/`delegatoCognome` presenti ma che NON combaciano con la persona autenticata: 400.
- Body senza delegato, con `rappresentanteLegaleNome`/`Cognome` diversi dalla persona autenticata: 400.
- Body con `iscrittaRasd: true` ma senza `organismoSportivoCodice`: 400 (zod, verifica il messaggio o solo lo status).
- Body con `haPersonaleAssunto: true` ma senza `assicurazioneRco`: 400.
- Body completo con `haPersonaleAssunto: true` e `assicurazioneRco` presente: 201, verifica via query diretta che esista una riga `associazioni_assicurazioni` con `tipo='rco'` per quell'associazione.
- `GET /organismi-sportivi`: 200, array non vuoto, nessuna autenticazione richiesta (`fetch` senza header `Authorization`).

- [ ] **Step 5: Esegui i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione node --test src/server.pubblico.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd backend-node && pnpm exec tsc`

```bash
git add backend-node/src/server.ts backend-node/src/server.pubblico.test.ts
git commit -m "feat(backend-node): POST /pubblico/associazioni raccoglie anagrafica estesa, aggiunge GET /organismi-sportivi"
```

---

### Task 4: Frontend — livello API

**Files:**
- Modify: `frontend-pubblico/src/api/associazioni.ts`
- Create: `frontend-pubblico/src/api/organismiSportivi.ts`
- Test: `frontend-pubblico/src/api/associazioni.test.ts` (estensione)
- Test: `frontend-pubblico/src/api/organismiSportivi.test.ts`

**Interfaces:**
- Produces (usate da Task 5): `DatiCreaAssociazione`/`Associazione` estesi in `api/associazioni.ts`; `listaOrganismiSportivi(): Promise<OrganismoSportivo[]>` in `api/organismiSportivi.ts`.

- [ ] **Step 1: Estendi `frontend-pubblico/src/api/associazioni.ts`**

Sostituisci le righe 3-17 del file attuale (interfacce `Associazione`/`DatiCreaAssociazione`):

```typescript
export interface Referente {
  nome: string;
  cognome: string;
  natoA: string;
  natoIl: string;
  residenteVia: string;
  residenteCitta: string;
  cellulare: string;
  cartaIdentita: string;
}

export interface ReferenteEmergenzeDae extends Referente {
  daeMarca: string;
  daeMatricola: string;
  daeScadenza: string;
}

export interface Assicurazione {
  compagnia: string;
  agenzia?: string | undefined;
  numeroPolizza: string;
  massimale: string;
  coperturaDal: string;
  coperturaAl: string;
}

export type TipologiaSoggetto =
  | 'associazione_sportiva'
  | 'cooperativa_ente_promozione_sportiva'
  | 'ente_promozione_culturale_giovanile_anziani'
  | 'ente_assistenza_handicap_volontariato'
  | 'soggetto_singolo_no_profit'
  | 'organizzazione_sindacale'
  | 'movimento_partito_politico'
  | 'gruppo_privati_circolo';

export interface Associazione {
  id: string;
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione: string | null;
  dataCostituzione: string | null;
  rappresentanteLegaleNome: string | null;
  rappresentanteLegaleCognome: string | null;
  delegatoNome: string | null;
  delegatoCognome: string | null;
  indirizzoVia: string | null;
  indirizzoCivico: string | null;
  indirizzoCitta: string | null;
  pec: string | null;
  email: string | null;
  tipologiaSoggetto: TipologiaSoggetto | null;
  iscrittaRasd: boolean;
  organismoSportivoCodice: string | null;
  codiceAffiliazione: string | null;
  haPersonaleAssunto: boolean;
}

export interface DatiCreaAssociazione {
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione?: string | undefined;
  dataCostituzione?: string | undefined;
  stagioneId: string;
  rappresentanteLegaleNome: string;
  rappresentanteLegaleCognome: string;
  delegatoNome?: string | undefined;
  delegatoCognome?: string | undefined;
  indirizzoVia: string;
  indirizzoCivico: string;
  indirizzoCitta: string;
  pec?: string | undefined;
  email: string;
  tipologiaSoggetto: TipologiaSoggetto;
  iscrittaRasd: boolean;
  organismoSportivoCodice?: string | undefined;
  codiceAffiliazione?: string | undefined;
  haPersonaleAssunto: boolean;
  referenteSicurezza: Referente;
  referenteEmergenzeDae: ReferenteEmergenzeDae;
  assicurazioneRct: Assicurazione;
  assicurazioneRco?: Assicurazione | undefined;
}
```

Non toccare `creaAssociazione`/`caricaDocumento`/`DocumentoAssociazione` (righe successive), la firma di `creaAssociazione` resta identica (`(dati: DatiCreaAssociazione) => Promise<Associazione>`), solo il tipo `DatiCreaAssociazione` è più ricco.

- [ ] **Step 2: `frontend-pubblico/src/api/organismiSportivi.ts` (nuovo)**

```typescript
import { richiedi } from './client.ts';

export interface OrganismoSportivo {
  codice: string;
  denominazione: string;
}

export function listaOrganismiSportivi(): Promise<OrganismoSportivo[]> {
  return richiedi('/organismi-sportivi');
}
```

- [ ] **Step 3: Test `organismiSportivi.test.ts`**

Stesso pattern di `stagioni.test.ts` (Task 1 del blocco precedente — backend reale, `GET /organismi-sportivi` non richiede autenticazione):

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { listaOrganismiSportivi } from './organismiSportivi.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('organismiSportivi.ts', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
  });

  it('restituisce l\'elenco seedato senza richiedere autenticazione', async () => {
    const organismi = await listaOrganismiSportivi();
    expect(organismi.length).toBeGreaterThan(70);
    expect(organismi.some((o) => o.codice === 'UISP')).toBe(true);
  });
});
```

- [ ] **Step 4: Estendi `associazioni.test.ts`**

Il test esistente `creaAssociazione crea una nuova associazione con abilitazione in_attesa` (Task 1 del blocco precedente) invia un body minimo — aggiorna il body con tutti i nuovi campi obbligatori (stessi valori usati nel test backend Task 3, coerenza cross-campo: nome/cognome del RL devono combaciare con quelli della `creaPersonaTest` usata — verifica il nome/cognome esatti restituiti da `creaPersonaTest`, sono 'Frontend'/'Test' per costruzione, vedi `testUtil/creaPersonaTest.ts`).

- [ ] **Step 5: Esegui i test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS (inclusi tutti i test esistenti — verifica in particolare che `App.accreditamento.realBackend.test.tsx` del blocco precedente non si sia rotto: usa `creaAssociazione` con un body minimo che ora fallirà 400 se non aggiornato, vedi Task 5 di questo piano per il fix di quel file).

- [ ] **Step 6: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/api/associazioni.ts frontend-pubblico/src/api/organismiSportivi.ts frontend-pubblico/src/api/associazioni.test.ts frontend-pubblico/src/api/organismiSportivi.test.ts
git commit -m "feat(frontend-pubblico): estende api/associazioni.ts, aggiunge api/organismiSportivi.ts"
```

---

### Task 5: Frontend — form `AccreditamentoDelegaView` esteso

**Files:**
- Modify: `frontend-pubblico/src/components/AccreditamentoDelegaView.tsx`
- Modify: `frontend-pubblico/src/App.accreditamento.realBackend.test.tsx`
- Test: `frontend-pubblico/src/components/AccreditamentoDelegaView.test.tsx` (estensione)

**Interfaces:**
- Consumes: `DatiCreaAssociazione`/`TipologiaSoggetto` estesi (Task 4, `api/associazioni.ts`), `listaOrganismiSportivi`/`OrganismoSportivo` (Task 4, `api/organismiSportivi.ts`).

- [ ] **Step 1: Aggiungi stato per i nuovi campi**

Nel componente `AccreditamentoDelegaView`, dopo lo stato esistente del form di creazione associazione (`denominazione`...`tipoDocumento`, righe 21-25 del file attuale), aggiungi:

```typescript
const [rappresentanteLegaleNome, setRappresentanteLegaleNome] = useState('');
const [rappresentanteLegaleCognome, setRappresentanteLegaleCognome] = useState('');
const [delegatoNome, setDelegatoNome] = useState('');
const [delegatoCognome, setDelegatoCognome] = useState('');
const [indirizzoVia, setIndirizzoVia] = useState('');
const [indirizzoCivico, setIndirizzoCivico] = useState('');
const [indirizzoCitta, setIndirizzoCitta] = useState('');
const [pec, setPec] = useState('');
const [email, setEmail] = useState('');
const [tipologiaSoggetto, setTipologiaSoggetto] = useState<TipologiaSoggetto>('associazione_sportiva');
const [iscrittaRasd, setIscrittaRasd] = useState(false);
const [organismoSportivoCodice, setOrganismoSportivoCodice] = useState('');
const [codiceAffiliazione, setCodiceAffiliazione] = useState('');
const [haPersonaleAssunto, setHaPersonaleAssunto] = useState(false);
const [organismi, setOrganismi] = useState<OrganismoSportivo[]>([]);

const [refSicurezzaNome, setRefSicurezzaNome] = useState('');
const [refSicurezzaCognome, setRefSicurezzaCognome] = useState('');
const [refSicurezzaNatoA, setRefSicurezzaNatoA] = useState('');
const [refSicurezzaNatoIl, setRefSicurezzaNatoIl] = useState('');
const [refSicurezzaVia, setRefSicurezzaVia] = useState('');
const [refSicurezzaCitta, setRefSicurezzaCitta] = useState('');
const [refSicurezzaCellulare, setRefSicurezzaCellulare] = useState('');
const [refSicurezzaCartaIdentita, setRefSicurezzaCartaIdentita] = useState('');

const [refEmergenzeNome, setRefEmergenzeNome] = useState('');
const [refEmergenzeCognome, setRefEmergenzeCognome] = useState('');
const [refEmergenzeNatoA, setRefEmergenzeNatoA] = useState('');
const [refEmergenzeNatoIl, setRefEmergenzeNatoIl] = useState('');
const [refEmergenzeVia, setRefEmergenzeVia] = useState('');
const [refEmergenzeCitta, setRefEmergenzeCitta] = useState('');
const [refEmergenzeCellulare, setRefEmergenzeCellulare] = useState('');
const [refEmergenzeCartaIdentita, setRefEmergenzeCartaIdentita] = useState('');
const [daeMarca, setDaeMarca] = useState('');
const [daeMatricola, setDaeMatricola] = useState('');
const [daeScadenza, setDaeScadenza] = useState('');

const [rctCompagnia, setRctCompagnia] = useState('');
const [rctAgenzia, setRctAgenzia] = useState('');
const [rctPolizza, setRctPolizza] = useState('');
const [rctMassimale, setRctMassimale] = useState('');
const [rctDal, setRctDal] = useState('');
const [rctAl, setRctAl] = useState('');

const [rcoCompagnia, setRcoCompagnia] = useState('');
const [rcoAgenzia, setRcoAgenzia] = useState('');
const [rcoPolizza, setRcoPolizza] = useState('');
const [rcoMassimale, setRcoMassimale] = useState('');
const [rcoDal, setRcoDal] = useState('');
const [rcoAl, setRcoAl] = useState('');
```

Importa `type { TipologiaSoggetto }` da `../api/associazioni.ts` e `listaOrganismiSportivi`, `type { OrganismoSportivo }` da `../api/organismiSportivi.ts` in cima al file. Carica gli organismi al mount con un `useEffect`:

```typescript
useEffect(() => {
  listaOrganismiSportivi().then(setOrganismi).catch(() => {
    // Non blocca il resto del form: se il caricamento fallisce, il select resta vuoto
    // e l'utente non potrà selezionare RASD — errore visibile solo se prova a farlo.
  });
}, []);
```

(aggiungi `useEffect` all'import React esistente, riga 1: `import React, { useState, useEffect } from 'react';`)

- [ ] **Step 2: Estendi `resetForm`**

Aggiungi il reset di tutti i nuovi stati (stesso stile della funzione esistente, righe 65-72).

- [ ] **Step 3: Estendi `handleSubmit`**

Nel blocco `const dati: DatiCreaAssociazione = {...}` (righe 101-107 attuali), estendi con tutti i nuovi campi:

```typescript
const dati: DatiCreaAssociazione = {
  denominazione,
  codiceFiscalePartitaIva,
  stagioneId,
  ...(rnaNumeroIscrizione ? { rnaNumeroIscrizione } : {}),
  ...(dataCostituzione ? { dataCostituzione } : {}),
  rappresentanteLegaleNome,
  rappresentanteLegaleCognome,
  ...(delegatoNome ? { delegatoNome } : {}),
  ...(delegatoCognome ? { delegatoCognome } : {}),
  indirizzoVia,
  indirizzoCivico,
  indirizzoCitta,
  ...(pec ? { pec } : {}),
  email,
  tipologiaSoggetto,
  iscrittaRasd,
  ...(iscrittaRasd ? { organismoSportivoCodice, codiceAffiliazione } : {}),
  haPersonaleAssunto,
  referenteSicurezza: {
    nome: refSicurezzaNome, cognome: refSicurezzaCognome, natoA: refSicurezzaNatoA, natoIl: refSicurezzaNatoIl,
    residenteVia: refSicurezzaVia, residenteCitta: refSicurezzaCitta, cellulare: refSicurezzaCellulare, cartaIdentita: refSicurezzaCartaIdentita,
  },
  referenteEmergenzeDae: {
    nome: refEmergenzeNome, cognome: refEmergenzeCognome, natoA: refEmergenzeNatoA, natoIl: refEmergenzeNatoIl,
    residenteVia: refEmergenzeVia, residenteCitta: refEmergenzeCitta, cellulare: refEmergenzeCellulare, cartaIdentita: refEmergenzeCartaIdentita,
    daeMarca, daeMatricola, daeScadenza,
  },
  assicurazioneRct: { compagnia: rctCompagnia, ...(rctAgenzia ? { agenzia: rctAgenzia } : {}), numeroPolizza: rctPolizza, massimale: rctMassimale, coperturaDal: rctDal, coperturaAl: rctAl },
  ...(haPersonaleAssunto ? {
    assicurazioneRco: { compagnia: rcoCompagnia, ...(rcoAgenzia ? { agenzia: rcoAgenzia } : {}), numeroPolizza: rcoPolizza, massimale: rcoMassimale, coperturaDal: rcoDal, coperturaAl: rcoAl },
  } : {}),
};
```

- [ ] **Step 4: Estendi la JSX del modale di creazione associazione**

Nel form esistente (righe 209-259), dopo il campo `acc-data-costituzione` e prima di `acc-tipo-doc`, inserisci le nuove sezioni. Segui esattamente lo stile già in uso (`<div className="form-group">`, `<label className="form-label" htmlFor="...">`, `<input className="form-control">`), raggruppando in griglie `display:grid, gridTemplateColumns:'1fr 1fr'` dove i campi sono corti (nome/cognome, città/via, date), a piena larghezza per campi singoli. Aggiungi in ordine:

1. **Rappresentante Legale**: `acc-rl-nome`/`acc-rl-cognome` (griglia 2 colonne, entrambi `required`).
2. **Delegato** (opzionale): `acc-delegato-nome`/`acc-delegato-cognome` (griglia 2 colonne, nessuno dei due `required`).
3. **Indirizzo**: `acc-indirizzo-via`, `acc-indirizzo-civico`, `acc-indirizzo-citta` (griglia 3 colonne, tutti `required`).
4. **Contatti**: `acc-pec` (type="email", non required), `acc-email` (type="email", required) — griglia 2 colonne.
5. **Tipologia soggetto**: `acc-tipologia-soggetto`, `<select>` con le 8 opzioni (usa etichette leggibili, es. "Associazione sportiva affiliata CONI", "Cooperativa/ente di promozione sportiva CONI", "Ente promozione culturale/giovanile/anziani", "Ente assistenza handicap/volontariato", "Soggetto singolo/società no-profit (funzione scuola)", "Organizzazione sindacale (solo riunioni personale scolastico)", "Movimento/partito politico", "Gruppo di cittadini/privati/circolo"), `value={tipologiaSoggetto}` collegato allo stato.
6. **RASD**: checkbox `acc-rasd` (`checked={iscrittaRasd}`, `onChange={(e) => setIscrittaRasd(e.target.checked)}`), e SOLO se `iscrittaRasd` è vero: `acc-organismo-sportivo` (`<select>` con `organismi.map(o => <option key={o.codice} value={o.codice}>{o.denominazione}</option>)`, `required`) + `acc-codice-affiliazione` (text, `required`).
7. **Assicurazione RCT** (sempre visibile, tutti `required` tranne agenzia): `acc-rct-compagnia`, `acc-rct-agenzia` (non required), `acc-rct-polizza`, `acc-rct-massimale` (type="text", placeholder "Es. 1000000.00"), `acc-rct-dal`/`acc-rct-al` (type="date", griglia 2 colonne).
8. **Personale assunto**: checkbox `acc-personale-assunto`. SOLO se vero: sezione **Assicurazione RCO**, stessi campi di RCT con id `acc-rco-*`, tutti `required` tranne agenzia.
9. **Responsabile Sicurezza**: `acc-sic-nome`/`acc-sic-cognome` (griglia 2 colonne), `acc-sic-nato-a`/`acc-sic-nato-il` (griglia 2 colonne, `nato-il` type="date"), `acc-sic-via`/`acc-sic-citta` (griglia 2 colonne), `acc-sic-cellulare`/`acc-sic-cid` (griglia 2 colonne) — tutti `required`.
10. **Responsabile Emergenze + DAE**: stessi 8 campi del punto 9 con id `acc-eme-*`, più `acc-dae-marca`/`acc-dae-matricola`/`acc-dae-scadenza` (griglia 3 colonne, `scadenza` type="date") — tutti `required`.

Per ciascun gruppo, usa un `<h4>` o `<div style={{fontWeight:700, marginTop:'1rem'}}>` come intestazione di sezione (stesso stile visivo già usato altrove nel progetto per separare gruppi di campi in un form lungo — verifica in `VersioneParametricaForm.tsx`, blocco "Scaglioni CSD", per un esempio di intestazione di sotto-sezione dentro un form esistente).

L'implementatore ha piena libertà sui dettagli di stile/spaziatura di queste 10 sezioni, purché: ogni campo `required` lato zod lo sia anche lato HTML (`required` sull'`<input>`), gli `id`/`htmlFor` corrispondano esattamente ai nomi sopra (i test del Step 5 li useranno), e i toggle condizionali (RASD, personale assunto) mostrino/nascondano le sezioni dipendenti esattamente come descritto.

- [ ] **Step 5: Estendi `AccreditamentoDelegaView.test.tsx`**

Il test esistente `crea associazione: chiama creaAssociazione con stagioneId, poi onRicarica` compila solo denominazione/CF — va esteso per compilare (o comunque fornire, se ci sono valori di default sensati per i test) tutti i nuovi campi `required`, altrimenti il submit HTML nativo blocca il form prima ancora di chiamare `creaAssociazione` (jsdom rispetta `required`). Aggiungi anche:
- Un test che verifica che il select organismo sportivo NON sia visibile quando `iscrittaRasd` è false, e compaia quando viene selezionato.
- Un test che verifica che i campi RCO NON siano visibili quando "ha personale assunto" è false, e compaiano quando selezionato.
- Un test che verifica che, al submit con tutti i campi compilati, `creaAssociazione` sia chiamata con un payload che include `referenteSicurezza`, `referenteEmergenzeDae` (con `daeMarca`/`daeMatricola`/`daeScadenza`), `assicurazioneRct`.

- [ ] **Step 6: Aggiorna `App.accreditamento.realBackend.test.tsx` (blocco precedente)**

Questo smoke test compila solo denominazione/CF via `userEvent.type` — con tutti i nuovi campi `required`, il submit HTML nativo bloccherà il form senza chiamare l'API. Estendi il test per compilare (via `userEvent.type`/`userEvent.selectOptions`/`userEvent.click` per i checkbox) tutti i campi obbligatori con valori di test plausibili, coerenti con la persona di test (`rappresentanteLegaleNome`/`Cognome` devono combaciare con `p.persona.nome`/`p.persona.cognome` da `creaPersonaTest`, altrimenti la validazione cross-campo del Task 3 risponde 400).

- [ ] **Step 7: Esegui i test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS, incluso l'intero pacchetto (verifica che nessun altro test si sia rotto).

- [ ] **Step 8: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/components/AccreditamentoDelegaView.tsx frontend-pubblico/src/components/AccreditamentoDelegaView.test.tsx frontend-pubblico/src/App.accreditamento.realBackend.test.tsx
git commit -m "feat(frontend-pubblico): form accreditamento raccoglie anagrafica estesa (RASD/assicurazioni/referenti+DAE)"
```

---

### Task 6: Aggiornamento documentazione

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/claude/backend-node.md`

**Interfaces:** nessuna (solo documentazione).

- [ ] **Step 1: Aggiungi il nuovo documento all'elenco "Documenti di riferimento" in `CLAUDE.md`**

Nella sezione `## Documenti di riferimento (fonte di verità normativa)`, aggiungi una voce per `Associazioni_Documenti.docx` (non è uno dei tre documenti principali già elencati — chiarisci che è un documento di dettaglio complementare fornito successivamente, non parte di Documento Principale/Allegato A/Allegato B).

- [ ] **Step 2: Aggiorna il paragrafo di stato in `CLAUDE.md`**

Aggiungi una frase sul completamento di questo blocco (anagrafica associazioni estesa, coerente collo stile changelog già in uso nel paragrafo).

- [ ] **Step 3: Aggiungi una voce "Fatto" in `docs/claude/backend-node.md`**

Segui lo stile delle voci "Fatto —" esistenti: cosa è stato aggiunto (le 4 migration, i nuovi campi/tabelle, la validazione cross-campo RL/delegato/persona OIDC, il nuovo endpoint `GET /organismi-sportivi`), il residuo noto (nessun enforcement su chi può presentare domanda stagionale, regola operativa DAE completa non implementata).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/claude/backend-node.md
git commit -m "docs: aggiorna CLAUDE.md/backend-node.md per il blocco estensione anagrafica associazioni"
```
