# EsitiIsfView: collegamento API reali Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collegare `EsitiIsfView` (frontend pubblico) agli esiti istruttoria reali (art. B.10), agli slot effettivamente assegnati e al flusso osservazioni/riesame (art. B.11, backend già completo), sostituendo interamente i dati mock.

**Architecture:** Un endpoint pubblico esistente esteso (denominazione associazione) + due nuovi endpoint pubblici di sola lettura (assegnazioni, osservazioni), entrambi con ownership check esplicito (`trovaAbilitazioneAttiva`) — poi il frontend: 4 nuovi/estesi file `api/*` + riscrittura completa di `EsitiIsfView.tsx` su tre sezioni (la mia domanda, osservazioni, tabellone pubblico).

## Global Constraints

- **Ownership check obbligatorio su ogni endpoint pubblico scoped a un'associazione**: `trovaAbilitazioneAttiva(pool, req.persona!.sub, associazioneId, stagioneId)` → 403 se `null`. Non opzionale — è il finding critico corretto nella review finale del blocco precedente (`anteprima-fabbisogno`), non va ripetuto lo stesso errore.
- **`GET /pubblico/stagioni/:stagioneId/domande/esiti` resta un bollettino pubblico non scoped per associazione** (art. B.10, pubblicazione esiti — trasparenza esplicita, non un dato privato): nessun ownership check su questo endpoint, resta come oggi (solo `richiedeAutenticazionePubblico`).
- **Decimal-as-string**: `valoreMinuti`/`frCalcolatoMinuti`/`frFinaleMinuti`/coefficienti restano stringhe end-to-end; l'ISF (`VA/FR`) è l'unico calcolo lato frontend, esplicitamente informativo/display-only — mai inviato al backend, mai influisce su alcuna scrittura.
- **Nessuna scrittura sui nuovi endpoint di lettura**: né audit log (`registraOperazione`, riservato alle scritture) né lock.
- Italiano per nomi funzione/variabile/commenti, coerente col resto del repo.

---

### Task 1: Backend — estendi `elencoEsitiPubblicati` + nuovo `GET /pubblico/domande/:id/osservazioni`

**Files:**
- Modify: `backend-node/src/domande.ts`
- Modify: `backend-node/src/osservazioni.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/domande.test.ts` (estensione)
- Test: `backend-node/src/osservazioni.test.ts` (estensione)
- Test: `backend-node/src/server.pubblico.test.ts` (estensione)

**Interfaces:**
- Produces (usate da Task 3): `EsitoPubblicato.associazioneDenominazione: string`; `GET /pubblico/domande/:id/osservazioni` → `Osservazione[]`.

- [ ] **Step 1: Estendi `EsitoPubblicato`/`elencoEsitiPubblicati` in `backend-node/src/domande.ts`**

Modifica l'interfaccia (dopo `motivazioneEsclusione`):

```typescript
export interface EsitoPubblicato {
  domandaId: string;
  associazioneId: string;
  associazioneDenominazione: string;
  stato: StatoDomanda;
  motivazioneEsclusione: string | null;
  fabbisognoRiconosciuto: EsitoIstruttoria | null;
  coefficienti: EsitoCoefficienti | null;
}
```

Modifica la query in `elencoEsitiPubblicati` (aggiungi il JOIN e la colonna, mantieni tutto il resto invariato):

```typescript
export async function elencoEsitiPubblicati(db: Db, stagioneId: string): Promise<EsitoPubblicato[]> {
  const r = await db.query<{
    id: string;
    associazione_id: string;
    associazione_denominazione: string;
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
    `SELECT d.id, d.associazione_id, a.denominazione AS associazione_denominazione, d.stato, d.motivazione_esclusione,
            fr.fr_calcolato_minuti::text, fr.fd_minuti::text, fr.fr_finale_minuti::text,
            c.crs::text, c.caa::text, c.csd::text, c.cp::text
     FROM domande d
     JOIN associazioni a ON a.id = d.associazione_id
     LEFT JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = d.id
     LEFT JOIN coefficienti_associazione c ON c.domanda_id = d.id
     WHERE d.stagione_id = $1 AND d.stato <> 'presentata'
     ORDER BY d.presentata_il`,
    [stagioneId],
  );
  return r.rows.map((riga) => ({
    domandaId: riga.id,
    associazioneId: riga.associazione_id,
    associazioneDenominazione: riga.associazione_denominazione,
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

- [ ] **Step 2: Test — estendi `domande.test.ts`**

Trova il test esistente di `elencoEsitiPubblicati` (crea una domanda ammessa/esclusa di fixture) e aggiungi un'asserzione che `associazioneDenominazione` combaci con la denominazione dell'associazione di fixture creata nel test.

- [ ] **Step 3: `listaOsservazioniPerDomanda` in `backend-node/src/osservazioni.ts`**

Aggiungi dopo `trovaOsservazionePerId`:

```typescript
export async function listaOsservazioniPerDomanda(db: Db, domandaId: string): Promise<Osservazione[]> {
  const r = await db.query<RigaOsservazione>(
    `SELECT ${COLONNE_SELECT_OSSERVAZIONE} FROM osservazioni_istruttoria WHERE domanda_id = $1 ORDER BY presentata_il`,
    [domandaId],
  );
  return r.rows.map(daRiga);
}
```

- [ ] **Step 4: Test — estendi `osservazioni.test.ts`**

Nuovo test: crea 2 osservazioni per la stessa domanda di fixture (stesso pattern già in uso in quel file per `presentaOsservazione`), verifica che `listaOsservazioniPerDomanda` le restituisca entrambe, ordinate per `presentataIl` crescente. Un secondo test verifica che una domanda senza osservazioni restituisca `[]`.

- [ ] **Step 5: Rotta `GET /pubblico/domande/:id/osservazioni` in `server.ts`**

Subito dopo la rotta `POST /pubblico/domande/:id/osservazioni` esistente (cerca `'--- Pubblico: presentazione osservazione'`), aggiungi:

```typescript
  app.get(
    '/pubblico/domande/:id/osservazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const domandaId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const domanda = await trovaDomandaPerId(pool, domandaId);
        if (!domanda) {
          res.status(404).json({ errore: 'domanda non trovata' });
          return;
        }
        const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, domanda.associazioneId, domanda.stagioneId);
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        res.status(200).json(await listaOsservazioniPerDomanda(pool, domandaId));
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );
```

Aggiungi `listaOsservazioniPerDomanda` all'import esistente da `./osservazioni.ts` (riga con `presentaOsservazione, trovaOsservazionePerId, ...`).

- [ ] **Step 6: Test — estendi `server.pubblico.test.ts`**

Segui lo stesso pattern già in uso per il test della `POST /pubblico/domande/:id/osservazioni` (crea associazione+abilitazione approvata+domanda ammessa/esclusa+osservazione di fixture via `presentaOsservazione` diretto o via API):
- 200 con array contenente l'osservazione di fixture, per il legale rappresentante/delegato proprietario.
- 403 per una persona diversa senza abilitazione attiva su quell'associazione/stagione.
- 404 per un `id` di domanda inesistente.

- [ ] **Step 7: Esegui i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione node --test src/domande.test.ts src/osservazioni.test.ts src/server.pubblico.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

Run: `cd backend-node && pnpm exec tsc`

```bash
git add backend-node/src/domande.ts backend-node/src/domande.test.ts backend-node/src/osservazioni.ts backend-node/src/osservazioni.test.ts backend-node/src/server.ts backend-node/src/server.pubblico.test.ts
git commit -m "feat(backend-node): estende elencoEsitiPubblicati con denominazione, aggiunge GET /pubblico/domande/:id/osservazioni"
```

---

### Task 2: Backend — nuovo `GET /pubblico/associazioni/:associazioneId/assegnazioni`

**Files:**
- Create: `backend-node/src/assegnazioniLettura.ts`
- Test: `backend-node/src/assegnazioniLettura.test.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/server.pubblico.test.ts` (estensione)

**Interfaces:**
- Produces (usate da Task 3): `GET /pubblico/associazioni/:associazioneId/assegnazioni?stagioneId=` → `AssegnazioneLettura[]`.

- [ ] **Step 1: `backend-node/src/assegnazioniLettura.ts` (nuovo)**

Nome file distinto da un futuro modulo di scrittura assegnazioni (che non esiste ancora, ma evita collisioni di naming se aggiunto in futuro — solo lettura qui, nessuna scrittura/lock).

```typescript
import type { Db } from './db.ts';

export interface AssegnazioneLettura {
  id: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  stato: 'provvisoria' | 'validata' | 'decaduta' | 'sostituita';
  valoreMinuti: string;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

export async function listaAssegnazioniPerAssociazione(
  db: Db,
  associazioneId: string,
  stagioneId: string,
): Promise<AssegnazioneLettura[]> {
  const r = await db.query<{
    id: string;
    tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
    stato: 'provvisoria' | 'validata' | 'decaduta' | 'sostituita';
    valore_minuti: string;
    impianto_denominazione: string;
    spazio_denominazione: string;
    giorno_settimana: number;
    orario_inizio: string;
    orario_fine: string;
    durata_minuti: number;
    pregiata: boolean;
  }>(
    `SELECT a.id, a.tipo, a.stato, a.valore_minuti::text,
            i.denominazione AS impianto_denominazione, sp.denominazione AS spazio_denominazione,
            s.giorno_settimana, s.orario_inizio::text, s.orario_fine::text, s.durata_minuti, s.pregiata
     FROM assegnazioni a
     JOIN slot_settimana_tipo s ON s.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = s.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     WHERE a.associazione_id = $1 AND s.stagione_id = $2 AND a.stato IN ('provvisoria', 'validata')
     ORDER BY s.giorno_settimana, s.orario_inizio`,
    [associazioneId, stagioneId],
  );
  return r.rows.map((riga) => ({
    id: riga.id,
    tipo: riga.tipo,
    stato: riga.stato,
    valoreMinuti: riga.valore_minuti,
    impiantoDenominazione: riga.impianto_denominazione,
    spazioDenominazione: riga.spazio_denominazione,
    giornoSettimana: riga.giorno_settimana,
    orarioInizio: riga.orario_inizio,
    orarioFine: riga.orario_fine,
    durataMinuti: riga.durata_minuti,
    pregiata: riga.pregiata,
  }));
}
```

- [ ] **Step 2: Test `assegnazioniLettura.test.ts`**

Stesso pattern già in uso in `backend-node/src/*.test.ts` per fixture dirette via pg (`creaDatabaseDedicato`): crea impianto/spazio/slot/stagione/associazione/domanda di fixture, inserisci 2 righe `assegnazioni` (una `stato='provvisoria'`, una `stato='decaduta'`), verifica che `listaAssegnazioniPerAssociazione` restituisca solo quella `provvisoria` (il filtro `stato IN ('provvisoria','validata')` esclude le decadute/sostituite), con tutti i campi mappati correttamente (incluso `valoreMinuti` come stringa esatta, non un numero).

- [ ] **Step 3: Rotta `GET /pubblico/associazioni/:associazioneId/assegnazioni` in `server.ts`**

Vicino alla rotta `GET /pubblico/associazioni/:associazioneId/domande` esistente, aggiungi:

```typescript
  app.get(
    '/pubblico/associazioni/:associazioneId/assegnazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const associazioneId = typeof req.params.associazioneId === 'string' ? req.params.associazioneId : '';
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : '';
      if (!stagioneId) {
        res.status(400).json({ errore: 'stagioneId obbligatorio' });
        return;
      }
      try {
        const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, associazioneId, stagioneId);
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        res.status(200).json(await listaAssegnazioniPerAssociazione(pool, associazioneId, stagioneId));
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

Aggiungi `import { listaAssegnazioniPerAssociazione } from './assegnazioniLettura.ts';` in cima al file.

- [ ] **Step 4: Test — estendi `server.pubblico.test.ts`**

Stesso pattern già in uso per gli altri endpoint pubblico-scoped con ownership check (`GET /pubblico/associazioni/:associazioneId/domande`, `POST /pubblico/domande/anteprima-fabbisogno`):
- 200 con l'assegnazione di fixture, per il proprietario.
- 403 per una persona senza abilitazione attiva su quell'associazione/stagione.
- 400 se `stagioneId` è omesso.

- [ ] **Step 5: Esegui i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione node --test src/assegnazioniLettura.test.ts src/server.pubblico.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd backend-node && pnpm exec tsc`

```bash
git add backend-node/src/assegnazioniLettura.ts backend-node/src/assegnazioniLettura.test.ts backend-node/src/server.ts backend-node/src/server.pubblico.test.ts
git commit -m "feat(backend-node): aggiunge GET /pubblico/associazioni/:associazioneId/assegnazioni"
```

---

### Task 3: Frontend — livello API

**Files:**
- Modify: `frontend-pubblico/src/api/domande.ts`
- Create: `frontend-pubblico/src/api/assegnazioni.ts`
- Create: `frontend-pubblico/src/api/osservazioni.ts`
- Test: `frontend-pubblico/src/api/assegnazioni.test.ts`
- Test: `frontend-pubblico/src/api/osservazioni.test.ts`
- Test: `frontend-pubblico/src/api/domande.test.ts` (estensione)

**Interfaces:**
- Produces (usate da Task 4): `Domanda.riesameStato`/`motivazioneEsclusione`; `elencoEsitiPubblicati(stagioneId)`; `listaAssegnazioni(associazioneId, stagioneId)`; `listaOsservazioni(domandaId)`; `presentaOsservazione(domandaId, testo)`.

- [ ] **Step 1: Estendi `Domanda` in `frontend-pubblico/src/api/domande.ts`**

```typescript
export interface Domanda {
  id: string;
  numeroProtocollo: string;
  associazioneId: string;
  stagioneId: string;
  stato: 'presentata' | 'ammessa' | 'esclusa';
  riesameStato: 'nessuno' | 'richiesto' | 'deciso';
  motivazioneEsclusione: string | null;
  presentataIl: string;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
}
```

Aggiungi anche `EsitoPubblicato`/`elencoEsitiPubblicati` in fondo al file:

```typescript
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

export interface EsitoPubblicato {
  domandaId: string;
  associazioneId: string;
  associazioneDenominazione: string;
  stato: 'presentata' | 'ammessa' | 'esclusa';
  motivazioneEsclusione: string | null;
  fabbisognoRiconosciuto: EsitoIstruttoria | null;
  coefficienti: EsitoCoefficienti | null;
}

export function elencoEsitiPubblicati(stagioneId: string): Promise<EsitoPubblicato[]> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/domande/esiti`);
}
```

- [ ] **Step 2: `frontend-pubblico/src/api/assegnazioni.ts` (nuovo)**

```typescript
import { richiedi } from './client.ts';

export interface AssegnazioneLettura {
  id: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  stato: 'provvisoria' | 'validata' | 'decaduta' | 'sostituita';
  valoreMinuti: string;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

export function listaAssegnazioni(associazioneId: string, stagioneId: string): Promise<AssegnazioneLettura[]> {
  return richiedi(
    `/pubblico/associazioni/${encodeURIComponent(associazioneId)}/assegnazioni?stagioneId=${encodeURIComponent(stagioneId)}`,
  );
}
```

- [ ] **Step 3: `frontend-pubblico/src/api/osservazioni.ts` (nuovo)**

```typescript
import { richiedi } from './client.ts';

export interface Osservazione {
  id: string;
  domandaId: string;
  testo: string;
  presentataIl: string;
  stato: 'in_esame' | 'accolta' | 'respinta';
  decisioneMotivazione: string | null;
  decisaIl: string | null;
}

export function listaOsservazioni(domandaId: string): Promise<Osservazione[]> {
  return richiedi(`/pubblico/domande/${encodeURIComponent(domandaId)}/osservazioni`);
}

export function presentaOsservazione(domandaId: string, testo: string): Promise<Osservazione> {
  return richiedi(`/pubblico/domande/${encodeURIComponent(domandaId)}/osservazioni`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ testo }),
  });
}
```

Nota: il backend restituisce anche `presentataDaPersonaFisicaId`/`decisaDa` su ogni osservazione — omessi qui perché non usati dal frontend (vedi nota sul giudizio del reviewer nel piano precedente: `richiedi<T>` non valida la forma a runtime, campi extra non usati possono essere omessi dal tipo TS).

- [ ] **Step 4: Test dei 3 file (nuovi/estesi)**

Stesso pattern reale-backend già stabilito in questa directory (`avviaBackendReale`/`creaPersonaTest`, mai mock di `fetch`):
- `assegnazioni.test.ts`: richiede un token, crea fixture minima (stagione+associazione+abilitazione approvata+domanda+slot+riga `assegnazioni` via pg diretto), verifica che `listaAssegnazioni` la trovi con tutti i campi mappati; verifica 403 senza abilitazione.
- `osservazioni.test.ts`: `presentaOsservazione` con fixture minima (domanda `esclusa` di fixture, stesso pattern), verifica 201/200 e campi; `listaOsservazioni` dopo la presentazione la trova.
- `domande.test.ts`: estendi il test esistente di `listaDomandePerAssociazione`/`creaDomanda` per verificare che `riesameStato`/`motivazioneEsclusione` siano presenti nella risposta (anche se `null`/`'nessuno'` per una domanda appena presentata); nuovo test per `elencoEsitiPubblicati` (fixture domanda ammessa con FR/coefficienti di fixture via pg diretto, verifica che compaia con `associazioneDenominazione` corretta).

- [ ] **Step 5: Esegui i test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/api/domande.ts frontend-pubblico/src/api/domande.test.ts frontend-pubblico/src/api/assegnazioni.ts frontend-pubblico/src/api/assegnazioni.test.ts frontend-pubblico/src/api/osservazioni.ts frontend-pubblico/src/api/osservazioni.test.ts
git commit -m "feat(frontend-pubblico): estende api/domande.ts, aggiunge api/assegnazioni.ts e api/osservazioni.ts"
```

---

### Task 4: Frontend — `EsitiIsfView` riscritta sui dati reali

**Files:**
- Modify: `frontend-pubblico/src/components/EsitiIsfView.tsx` (riscrittura sostanziale)
- Modify: `frontend-pubblico/src/App.tsx`
- Test: `frontend-pubblico/src/components/EsitiIsfView.test.tsx` (nuovo)

**Interfaces:**
- Consumes: tutto il livello API del Task 3, `EntitaRappresentata` (blocchi precedenti).
- Produces: `EsitiIsfView` con props `{ entities: EntitaRappresentata[]; stagioneId: string | null; activeEntity: EntitaRappresentata | null }`.

- [ ] **Step 1: Riscrivi `EsitiIsfView.tsx`**

Struttura a 3 sezioni (guardie prima, poi sezioni in ordine), seguendo lo stile CSS già stabilito (`pa-container`/`pa-card`/`pa-table`, KPI grid come nel mock attuale — leggilo per riuso diretto delle classi/stili).

**Guardie iniziali** (in ordine, prima del render principale):
- `!stagioneId` → messaggio "Seleziona una stagione dall'intestazione."
- `!activeEntity || !activeEntity.associazioneId` → messaggio "Seleziona un'associazione con delega approvata."
- Al mount (`useEffect` su `[associazioneId, stagioneId]`, con guardia `annullato` per cancellazione — stesso pattern di `WizardDomandaView`): `listaDomandePerAssociazione(associazioneId, stagioneId)` (già esistente, ora estesa), filtra per `stagioneId`. Se nessuna domanda trovata → messaggio "Nessuna domanda presentata per questa stagione."

**Sezione "La mia domanda"** (mostrata solo se una domanda esiste per l'associazione/stagione attiva):
- Se `domanda.stato === 'presentata'`: messaggio "Esito istruttoria non ancora pubblicato per questa domanda." — nessun'altra fetch (l'istruttoria non è stata eseguita, `elencoEsitiPubblicati` non la includerebbe comunque).
- Altrimenti: carica `elencoEsitiPubblicati(stagioneId)` (una sola chiamata, riusata anche dalla sezione tabellone sotto — non duplicare la fetch, tienila in uno state condiviso al livello del componente) e filtra l'elemento con `domandaId === domanda.id` per i KPI di questa sezione: FR finale, coefficienti (CRS/CAA/CSD/CP), badge stato (`ammessa`/`esclusa`), badge riesame se `domanda.riesameStato !== 'nessuno'`. Se l'elemento non è ancora presente nella lista esiti (istruttoria eseguita ma coefficienti non ancora calcolati — `fabbisognoRiconosciuto === null`), mostra "In attesa di calcolo coefficienti" invece dei KPI numerici.
- Carica `listaAssegnazioni(associazioneId, stagioneId)` (`api/assegnazioni.ts`) in un effect separato, mostra la tabella slot assegnati (stesse colonne del mock: impianto/spazio, giorno, fascia oraria, durata, badge pregiata se `pregiata`, badge tipo assegnazione — `singola`/`blocco_gara`/`blocco_allenamento` con etichette leggibili, es. "Assegnato Blocco Gara" per `blocco_gara`). Se la lista è vuota, "Nessuno slot assegnato."
- **ISF calcolato client-side**: `VA = somma valoreMinuti delle assegnazioni caricate sopra` (parsare a `Number` solo per la somma di visualizzazione — mai reinviato al backend, mai usato per validare/bloccare nulla), `ISF = VA / Number(esito.fabbisognoRiconosciuto.frFinaleMinuti)` se `frFinaleMinuti` esiste ed è `> 0`, altrimenti "—". Mostra sia il valore decimale sia la percentuale, come nel mock.

**Sezione osservazioni** (mostrata solo se `domanda.stato === 'esclusa'` o `domanda.motivazioneEsclusione` non è `null`, e `domanda.riesameStato !== 'deciso'`):
- Se `domanda.motivazioneEsclusione`, mostralo in un box informativo prima del form.
- Form: textarea + bottone "Presenta osservazione" → `presentaOsservazione(domanda.id, testo)` (`api/osservazioni.ts`). Gestione errore (`ErroreRichiestaApi`) con messaggio visibile (il backend può rifiutare con 400/409 se lo stato non è osservabile o il riesame è già deciso — mostra il messaggio del backend, non inventarne uno diverso). Dopo un invio riuscito, ricarica la lista sotto e svuota il campo testo.
- Lista osservazioni già presentate (`listaOsservazioni(domanda.id)`, caricata al mount insieme alla domanda): ognuna con testo/data/badge stato (`in_esame`/`accolta`/`respinta`), e se `decisioneMotivazione` presente mostralo.

**Sezione "Tabellone pubblico"** (sempre visibile se `stagioneId` è impostato, indipendentemente dall'esistenza di una propria domanda):
- Tabella da `elencoEsitiPubblicati(stagioneId)` (stessa fetch/state della sezione "La mia domanda" sopra — un solo `useEffect`/stato condiviso, non due fetch separate della stessa risorsa): colonne denominazione associazione, stato (badge), FR finale, ISF (calcolabile solo se hai anche VA per quell'associazione — **non disponibile per le altre associazioni**, l'endpoint assegnazioni è scoped alla propria; per il tabellone pubblico mostra quindi solo FR e stato, NON un ISF per riga altrui — correggi la spec originale su questo punto: l'ISF per riga si mostra solo per la propria associazione, evidenziata/marcata nella tabella, es. riga in grassetto o badge "La tua associazione").
- Se la lista è vuota, "Nessun esito ancora pubblicato per questa stagione."

- [ ] **Step 2: Aggiorna `App.tsx`**

Sostituisci `{activeTab === 'esiti-isf' && <EsitiIsfView />}` con `{activeTab === 'esiti-isf' && <EsitiIsfView entities={entities} stagioneId={stagioneId} activeEntity={activeEntity} />}`.

- [ ] **Step 3: `EsitiIsfView.test.tsx`**

Mock di tutte le funzioni `api/*` coinvolte (`vi.spyOn`), copertura minima:
- Nessuna domanda esistente → messaggio, nessuna sezione domanda/osservazioni renderizzata, tabellone pubblico comunque presente (se `stagioneId` impostato).
- Domanda `presentata` → messaggio "esito non ancora pubblicato", sezione osservazioni assente.
- Domanda `ammessa` con esito+assegnazioni di fixture → KPI corretti, tabella slot corretta, ISF calcolato correttamente da VA/FR nei dati di test, sezione osservazioni assente (stato non `esclusa`, nessuna motivazione).
- Domanda `esclusa` con `motivazioneEsclusione` → sezione osservazioni presente, motivazione mostrata; submit del form chiama `presentaOsservazione` con `testo` corretto, poi ricarica la lista (mock `listaOsservazioni` chiamata una seconda volta).
- Domanda con `riesameStato === 'deciso'` → sezione osservazioni assente anche se `esclusa` (riesame già chiuso, non più contestabile).
- Tabellone pubblico: verifica che mostri più righe di associazioni diverse da mock `elencoEsitiPubblicati` con più elementi, e che l'ISF sia calcolato SOLO per la riga della propria associazione.

- [ ] **Step 4: Esegui i test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS, incluso l'intero pacchetto.

- [ ] **Step 5: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/components/EsitiIsfView.tsx frontend-pubblico/src/App.tsx frontend-pubblico/src/components/EsitiIsfView.test.tsx
git commit -m "feat(frontend-pubblico): EsitiIsfView collegata alle API reali (esiti/assegnazioni/osservazioni)"
```

---

### Task 5: Smoke test end-to-end + aggiornamento documentazione

**Files:**
- Test: `frontend-pubblico/src/App.esiti.realBackend.test.tsx`
- Modify: `CLAUDE.md`
- Modify: `docs/claude/backend-node.md`

**Interfaces:** nessuna nuova.

- [ ] **Step 1: Smoke test end-to-end**

Stesso pattern già stabilito (`App.domanda.realBackend.test.tsx`): crea persona+associazione+abilitazione approvata+stagione+impianto/spazio/slot di fixture via pg diretto, crea una domanda tramite `creaDomanda` (o direttamente via pg se più semplice per il fixture — verifica quale approccio rende il test più leggibile), promuovi la domanda a `stato='ammessa'` e inserisci righe `fabbisogni_riconosciuti`/`coefficienti_associazione`/`assegnazioni` di fixture via pg diretto (stesso schema delle tabelle già letto nei task precedenti). Seleziona esplicitamente la stagione dal selettore Header (**gotcha già documentato** in `docs/claude/backend-node.md` — DB di test condiviso, mai fidarsi dell'auto-selezione). Verifica che la view mostri i KPI/slot reali. Presenta un'osservazione reale attraverso l'UI (richiede una domanda `esclusa` di fixture con `motivazioneEsclusione`, quindi un secondo scenario o una seconda fixture nello stesso test) e verifica che compaia nella lista dopo l'invio.

Cleanup in `afterAll`: elimina ogni riga creata (assegnazioni → coefficienti_associazione → fabbisogni_riconosciuti → osservazioni_istruttoria → domande → abilitazioni → associazioni → slot/spazio/impianto → persone → stagione), stesso ordine FK-safe già stabilito, **senza ripetere il leak di stagioni/discipline già corretto nel blocco precedente** — questo test non ha bisogno di creare una riga `discipline_sportive` (nessuna disciplina coinvolta in questo flusso), ma la stagione di fixture va comunque eliminata.

- [ ] **Step 2: Esegui il test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS.

- [ ] **Step 3: Aggiorna documentazione**

`CLAUDE.md`: aggiorna il paragrafo di stato (EsitiIsfView collegata, restano solo 2 view mock: ConcertazioneView/CalendarioDefinitivoView).
`docs/claude/backend-node.md`: nuova voce "Fatto —" per questo blocco (2 nuovi endpoint pubblici con ownership check, estensione `elencoEsitiPubblicati`, pattern "un solo fetch condiviso tra due sezioni della stessa view" per evitare chiamate duplicate).

- [ ] **Step 4: Commit**

```bash
git add frontend-pubblico/src/App.esiti.realBackend.test.tsx CLAUDE.md docs/claude/backend-node.md
git commit -m "test(frontend-pubblico): smoke test end-to-end EsitiIsfView; aggiorna documentazione"
```
