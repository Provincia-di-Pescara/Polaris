# ConcertazioneView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collegare `ConcertazioneView` (frontend pubblico) al sistema reale di concertazione (art. B.23-B.28): bollettino proposta provvisoria pubblico, proposte multi-tipo/multi-parte con accettazione per-associazione, annullamento — tutto già esistente lato backend tranne un arricchimento di un endpoint di lettura.

**Architecture:** 1 sola modifica backend (estende una query di lettura esistente con denominazioni/dettagli leggibili) + un nuovo livello API frontend + riscrittura completa del componente su 3 sezioni (bollettino, le mie proposte, nuova proposta) che condividono un unico fetch del bollettino per arricchire tutto il resto.

## Global Constraints

- **Ogni endpoint pubblico scoped a un'associazione deve avere un controllo di ownership esplicito** (`trovaAbilitazioneAttiva` → 403 se assente). Regola non negoziabile in questo progetto (un blocco precedente ha spedito un endpoint pubblico senza, ed è stato il finding critico della sua review finale) — **non applicabile a questo blocco**, perché nessun nuovo endpoint viene creato: l'unica modifica backend è a un endpoint già esistente e deliberatamente non scoped (bollettino pubblico art. B.23), e tutte le rotte di scrittura/lettura scoped che il frontend userà esistono già con il controllo corretto (verificato leggendo il codice).
- **Decimal-as-string**: `valoreMinutiAssegnato`/`fabbisognoRiconosciutoMinuti`/`isf` restano stringhe end-to-end. La simulazione ISF nel form nuova proposta è l'unico calcolo client-side ammesso (VA ± delta, mai inviato al backend, mai autoritativo).
- **Formato orario `HH:MM`**, mai `HH:MM:SS`: usare sempre `to_char(colonna, 'HH24:MI')`, mai `::text` su una colonna `TIME` — bug reale già trovato e corretto in un blocco precedente su un endpoint quasi identico (`assegnazioniLettura.ts`), non ripeterlo qui.
- **Nessuna logica di dominio duplicata client-side**: compatibilità disciplina, limiti di concentrazione, FIFO — tutti verificati solo dal backend (`creaProposta`/`accettaProposta`), il client mostra l'errore ricevuto (400/409) verbatim.
- **Il flusso pubblico non include mai un rifiuto diretto**: solo creare, accettare (la propria parte), annullare (solo il proponente). La validazione/rigetto finale è esclusivamente backoffice (art. B.27-28), fuori scope.
- Italiano per nomi funzione/variabile/commenti, coerente col resto del repo.

---

### Task 1: Backend — estendi `trovaPropostaProvvisoria` con denominazioni e dettagli slot

**Files:**
- Modify: `backend-node/src/propostaProvvisoria.ts`
- Test: `backend-node/src/propostaProvvisoria.test.ts` (estensione)

**Interfaces:**
- Produces (usate da Task 2): `VocePropostaProvvisoria` esteso con `associazioneDenominazione: string`, `impiantoDenominazione: string`, `spazioDenominazione: string`, `giornoSettimana: number`, `orarioInizio: string` (`HH:MM`), `orarioFine: string` (`HH:MM`), `durataMinuti: number`, `pregiata: boolean`.

- [ ] **Step 1: Estendi `VocePropostaProvvisoria` e la query in `propostaProvvisoria.ts`**

Modifica l'interfaccia (dopo `sorteggioRiferimento`):

```typescript
export interface VocePropostaProvvisoria {
  slotId: string;
  associazioneId: string;
  associazioneDenominazione: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}
```

Modifica `RigaVoceProposta` (aggiungi i campi grezzi corrispondenti) e la query in `trovaPropostaProvvisoria`:

```typescript
interface RigaVoceProposta {
  slot_id: string;
  associazione_id: string;
  associazione_denominazione: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valore_minuti: string;
  fr_finale_minuti: string | null;
  isf: string | null;
  sorteggio_id: string | null;
  articolo_riferimento: string | null;
  impianto_denominazione: string;
  spazio_denominazione: string;
  giorno_settimana: number;
  orario_inizio: string;
  orario_fine: string;
  durata_minuti: number;
  pregiata: boolean;
}
```

```typescript
  const r = await db.query<RigaVoceProposta>(
    `SELECT a.slot_id, a.associazione_id, ass.denominazione AS associazione_denominazione,
            a.tipo, a.valore_minuti::text AS valore_minuti,
            ${COLONNE_ISF_SORTEGGIO},
            i.denominazione AS impianto_denominazione, sp.denominazione AS spazio_denominazione,
            st.giorno_settimana, to_char(st.orario_inizio, 'HH24:MI') AS orario_inizio,
            to_char(st.orario_fine, 'HH24:MI') AS orario_fine, st.durata_minuti, st.pregiata
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = st.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     JOIN associazioni ass ON ass.id = a.associazione_id
     ${JOIN_ISF_SORTEGGIO}
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
     ORDER BY st.giorno_settimana, st.orario_inizio`,
    [stagioneId],
  );
  return r.rows.map((v) => ({
    slotId: v.slot_id,
    associazioneId: v.associazione_id,
    associazioneDenominazione: v.associazione_denominazione,
    tipo: v.tipo,
    valoreMinutiAssegnato: v.valore_minuti,
    fabbisognoRiconosciutoMinuti: v.fr_finale_minuti,
    isf: v.isf,
    sorteggioRiferimento: v.sorteggio_id ? { sorteggioId: v.sorteggio_id, articoloRiferimento: v.articolo_riferimento! } : null,
    impiantoDenominazione: v.impianto_denominazione,
    spazioDenominazione: v.spazio_denominazione,
    giornoSettimana: v.giorno_settimana,
    orarioInizio: v.orario_inizio,
    orarioFine: v.orario_fine,
    durataMinuti: v.durata_minuti,
    pregiata: v.pregiata,
  }));
```

Nota: `JOIN_ISF_SORTEGGIO`/`COLONNE_ISF_SORTEGGIO` sono condivisi con `settimanaTipoDefinitiva.ts` (vedi commento esistente nel file) — non modificarli, solo la query locale in `trovaPropostaProvvisoria` cambia.

- [ ] **Step 2: Test — estendi `propostaProvvisoria.test.ts`**

Trova i test esistenti di `trovaPropostaProvvisoria` (fixture con assegnazione/slot/associazione) e aggiungi asserzioni su `associazioneDenominazione` (combacia con la denominazione dell'associazione di fixture), `impiantoDenominazione`/`spazioDenominazione` (combaciano coi valori di fixture), e **esplicitamente** che `orarioInizio`/`orarioFine` siano nel formato `HH:MM` (es. `'17:00'`), non `HH:MM:SS` — stesso controllo esplicito già aggiunto per lo stesso bug in `assegnazioniLettura.test.ts` in un blocco precedente, non fidarsi implicitamente del formato.

- [ ] **Step 3: Esegui i test**

Run: `cd backend-node && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione node --test src/propostaProvvisoria.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck + commit**

Run: `cd backend-node && pnpm exec tsc`

```bash
git add backend-node/src/propostaProvvisoria.ts backend-node/src/propostaProvvisoria.test.ts
git commit -m "feat(backend-node): estende trovaPropostaProvvisoria con denominazioni e dettagli slot leggibili"
```

---

### Task 2: Frontend — livello API `api/concertazione.ts`

**Files:**
- Create: `frontend-pubblico/src/api/concertazione.ts`
- Test: `frontend-pubblico/src/api/concertazione.test.ts`

**Interfaces:**
- Produces (usate da Task 3): `VocePropostaProvvisoria`/`propostaProvvisoria(stagioneId)`, `TipoProposta`, `ParteProposta`, `SlotProposta`, `StatoProposta`, `Proposta`, `DatiCreaProposta`/`creaProposta(dati)`, `listaProposteConcertazione(stagioneId)`, `trovaPropostaConcertazione(id)`, `accettaProposta(id, associazioneId)`, `annullaProposta(id)`.

- [ ] **Step 1: `frontend-pubblico/src/api/concertazione.ts` (nuovo)**

```typescript
import { richiedi } from './client.ts';

export interface VocePropostaProvvisoria {
  slotId: string;
  associazioneId: string;
  associazioneDenominazione: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

export function propostaProvvisoria(stagioneId: string): Promise<VocePropostaProvvisoria[]> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/proposta`);
}

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

export interface DatiCreaProposta {
  stagioneId: string;
  proponenteAssociazioneId: string;
  tipo: TipoProposta;
  slot: { slotId: string; associazioneCedenteId?: string | undefined; associazioneRiceventeId: string }[];
}

export function creaProposta(dati: DatiCreaProposta): Promise<Proposta> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(dati.stagioneId)}/concertazione/proposte`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

export function listaProposteConcertazione(stagioneId: string): Promise<Proposta[]> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/concertazione/proposte`);
}

export function trovaPropostaConcertazione(id: string): Promise<Proposta> {
  return richiedi(`/pubblico/concertazione/proposte/${encodeURIComponent(id)}`);
}

export function accettaProposta(id: string, associazioneId: string): Promise<Proposta> {
  return richiedi(`/pubblico/concertazione/proposte/${encodeURIComponent(id)}/accetta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ associazioneId }),
  });
}

export function annullaProposta(id: string): Promise<Proposta> {
  return richiedi(`/pubblico/concertazione/proposte/${encodeURIComponent(id)}/annulla`, { method: 'POST' });
}
```

Verifica prima di finalizzare: la rotta `POST /pubblico/stagioni/:id/concertazione/proposte` (`schemaCreaProposta.safeParse({ ...req.body, stagioneId })`, in `backend-node/src/server.ts`) inietta `stagioneId` dal path param, quindi il body inviato da `creaProposta` sopra include `stagioneId` nel JSON ma il backend lo sovrascrive comunque col path param — nessun conflitto, ma non serve ometterlo dal body: verifica che l'implementer non lo tolga per "pulizia", il campo extra nel body è innocuo e coerente con `DatiCreaProposta` lato backend che lo richiede.

- [ ] **Step 2: Test `concertazione.test.ts`**

Stesso pattern reale-backend già stabilito (`avviaBackendReale`/`creaPersonaTest`, mai mock di `fetch`):
- `propostaProvvisoria`: richiede un token, fixture minima (stagione in stato `'concertazione'` — nota: il campo `stato` di `stagioni_sportive` va impostato esplicitamente via pg diretto, il default è `'censimento'`; serve anche un'elaborazione `prima_assegnazione` completata O impostare direttamente `stato='concertazione'` via UPDATE diretto, verifica quale sia più semplice per il fixture leggendo `pubblicaProposta`'s precondizioni — in un test è accettabile scrivere direttamente lo stato della stagione senza passare dal flusso reale di pubblicazione, purché la query letta poi si comporti come atteso), associazione+domanda ammessa+assegnazione di fixture, verifica che la voce torni con `associazioneDenominazione`/dettagli slot corretti e `orarioInizio` in formato `HH:MM` (test esplicito, stesso motivo del Task 1).
- `creaProposta`+`listaProposteConcertazione`+`trovaPropostaConcertazione`: fixture con 2 associazioni con domanda ammessa e assegnazioni di fixture (una per associazione, su slot diversi), crea una proposta di tipo `scambio_bilaterale` tra le due, verifica che compaia nella lista e nel dettaglio con `stato: 'in_attesa_accettazione'` (2 parti coinvolte).
- `accettaProposta`: dalla proposta di cui sopra, accetta con l'associazione non proponente, verifica `stato` transita a `'accettata_da_tutti'`.
- `annullaProposta`: nuova proposta di fixture, annullata dal proponente, verifica `stato: 'annullata'`.

- [ ] **Step 3: Esegui i test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS.

- [ ] **Step 4: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/api/concertazione.ts frontend-pubblico/src/api/concertazione.test.ts
git commit -m "feat(frontend-pubblico): aggiunge livello API concertazione (bollettino, proposte, accetta, annulla)"
```

---

### Task 3: Frontend — `ConcertazioneView` riscritta sui dati reali

**Files:**
- Modify: `frontend-pubblico/src/components/ConcertazioneView.tsx` (riscrittura sostanziale)
- Modify: `frontend-pubblico/src/App.tsx`
- Modify: `frontend-pubblico/src/types.ts`
- Delete: `frontend-pubblico/src/mockData.ts`
- Test: `frontend-pubblico/src/components/ConcertazioneView.test.tsx` (nuovo)

**Interfaces:**
- Consumes: tutto il livello API del Task 2, `EntitaRappresentata` (blocchi precedenti).
- Produces: `ConcertazioneView` con props `{ entities: EntitaRappresentata[]; stagioneId: string | null; activeEntity: EntitaRappresentata | null }`.

- [ ] **Step 1: Rimuovi `ConcertazioneProposal` da `types.ts` e cancella `mockData.ts`**

Verifica prima (grep) che nessun altro file importi `ConcertazioneProposal`/`mockConcertazioneProposals` oltre a `ConcertazioneView.tsx` (che questo task riscrive) e `mockData.ts` stesso — se confermato, rimuovi l'interfaccia da `types.ts` ed elimina interamente `frontend-pubblico/src/mockData.ts` (l'unico contenuto del file era dedicato a questo mock).

- [ ] **Step 2: Riscrivi `ConcertazioneView.tsx`**

Segui lo stile CSS/pattern già stabilito (`pa-card`/`pa-table`/badge/form-group, guardie con messaggi inline, effect con cancellazione `annullato`, gestione errore `ErroreRichiestaApi` con messaggio verbatim dal backend) — leggi `EsitiIsfView.tsx` (il componente più recente e più simile per struttura: guardie, un fetch condiviso da più sezioni, badge di stato, form con submit) prima di scrivere, per riusare esattamente gli stessi pattern invece di inventarne di nuovi.

**Guardie iniziali:**
- `!stagioneId` → messaggio "Seleziona una stagione dall'intestazione."
- `!activeEntity || !activeEntity.associazioneId` → messaggio "Seleziona un'associazione con delega approvata."
- Al mount/cambio `stagioneId`: `propostaProvvisoria(stagioneId)` (un solo fetch, stato condiviso da tutte le sezioni sotto — **non richiamarlo separatamente in più punti**). Se la chiamata fallisce con un messaggio che indica "non ancora pubblicata" (il backend risponde 409 con `ErroreStatoNonValidoPerTransizione`, messaggio verbatim mostrato), la view intera mostra quel messaggio invece delle sezioni (la concertazione non è ancora aperta per questa stagione).

Da `propostaProvvisoria`, costruisci due mappe di lookup usate da tutte le sezioni sotto: `Map<slotId, VocePropostaProvvisoria>` (dettaglio slot) e `Map<associazioneId, string>` (denominazione) — derivate con `useMemo`, non ricalcolate ad ogni render.

**Sezione "Bollettino proposta provvisoria"** (sempre visibile una volta caricato il bollettino):
- Tabella di tutte le voci: impianto/spazio, giorno/orario (`etichettaSlot`-style, stesso pattern di `WizardDomandaView`), associazione (denominazione), FR, ISF (mostrato se non `null`, altrimenti "—"). Riga propria (associazioneId === activeEntity.associazioneId) evidenziata (grassetto + badge "La tua associazione", stesso pattern del tabellone in `EsitiIsfView.tsx`).

**Sezione "Le mie proposte"**:
- `listaProposteConcertazione(stagioneId)` (il backend filtra già sulle proprie associazioni con abilitazione approvata — nessun filtro client-side aggiuntivo necessario). Per ogni proposta: badge tipo, badge stato (mappa leggibile: `in_attesa_accettazione`→"In attesa di accettazione", `accettata_da_tutti`→"Accettata, in attesa di validazione", `validata`→"Validata", `rigettata`→"Rigettata" + `motivazioneRigetto` se presente, `annullata`→"Annullata"), elenco parti con denominazione (dalla mappa di lookup) e chi ha già accettato (`accettatoIl !== null`), elenco slot coinvolti con etichetta leggibile (dalla mappa di lookup) e ruolo (cedente/ricevente, dalla denominazione nella mappa).
- Bottone **Accetta**: visibile solo se `stato === 'in_attesa_accettazione'` E la propria associazione è tra `parti` E la propria parte ha `accettatoIl === null`. Chiama `accettaProposta(proposta.id, activeEntity.associazioneId)`, poi ricarica la lista proposte (non il bollettino, che non cambia finché non c'è validazione backoffice).
- Bottone **Annulla**: visibile solo se `stato === 'in_attesa_accettazione'` E `proposta.proponenteAssociazioneId === activeEntity.associazioneId`. Chiama `annullaProposta(proposta.id)`, poi ricarica la lista.
- Nessun bottone "rifiuta" — non esiste nel flusso reale (solo backoffice rigetta).

**Sezione "Proponi nuova concertazione"** (form, non un modal se preferisci uno stile più semplice del mock — usa il tuo giudizio, ma resta coerente con lo stile "sezione inline" già usato da `WizardDomandaView`/`EsitiIsfView` invece del modal del vecchio mock, a meno che uno spazio dedicato in overlay sia chiaramente più leggibile per un form con righe dinamiche):
- Select tipo (6 opzioni, etichette leggibili: `scambio_bilaterale`→"Scambio bilaterale", `scambio_multilaterale`→"Scambio multilaterale", `cessione`→"Cessione", `utilizzo_slot_libero`→"Utilizzo di uno slot libero", `accorpamento`→"Accorpamento", `ampliamento`→"Ampliamento").
- Righe slot dinamiche (bottone "Aggiungi riga slot" / rimuovi per riga), ogni riga:
  - Select "Slot da cedere" — popolata dalle voci del bollettino con `associazioneId === activeEntity.associazioneId` (i propri slot assegnati). **Nascosta/non richiesta se tipo === 'utilizzo_slot_libero'** (specchio esatto del refine zod backend: `associazioneCedenteId` deve essere assente per quel tipo, presente per tutti gli altri — la validazione qui è UI/UX, il backend resta l'autorità).
  - Select "Associazione ricevente" — popolata dalle associazioni distinte presenti nel bollettino (esclusa la propria, salvo il caso `utilizzo_slot_libero`/`accorpamento`/`ampliamento` dove potrebbe essere la propria stessa associazione che richiede un ampliamento — non aggiungere un vincolo client-side che il backend non impone, mostra tutte le associazioni del bollettino).
  - Select "Slot ricevuto" — popolata dalle voci del bollettino con `associazioneId === associazione ricevente selezionata in questa riga` (si aggiorna dinamicamente quando cambia la selezione della riga).
- Blocca l'invio (messaggio inline, non bottone disabilitato silenzioso) se: nessuna riga slot presente, o una riga ha tipo≠`utilizzo_slot_libero` senza slot da cedere selezionato.
- Simulazione ISF (box informativo, sotto le righe slot, aggiornato ad ogni modifica): per la propria associazione, VA attuale (somma `valoreMinutiAssegnato` delle proprie voci nel bollettino) **meno** i minuti degli slot ceduti nelle righe correnti **più** i minuti degli slot ricevuti nelle righe correnti dove la ricevente è la propria associazione, diviso il proprio FR (da una qualunque voce propria nel bollettino, sono tutte uguali per associazione). Etichetta esplicita: "Stima informativa — il valore reale sarà confermato in fase di validazione". Se FR non disponibile (nessuna voce propria), non mostrare la simulazione.
- Submit: `creaProposta({ stagioneId, proponenteAssociazioneId: activeEntity.associazioneId, tipo, slot })`. Gestione errore backend verbatim (400 su validazione, 409 su controlli di dominio — compatibilità disciplina/limiti di concentrazione/stagione non più in concertazione). Successo: svuota il form, ricarica la lista proposte, mostra un messaggio di conferma con il numero/id della proposta creata.

- [ ] **Step 3: Aggiorna `App.tsx`**

Sostituisci `{activeTab === 'concertazione' && <ConcertazioneView />}` con `{activeTab === 'concertazione' && <ConcertazioneView entities={entities} stagioneId={stagioneId} activeEntity={activeEntity} />}`.

- [ ] **Step 4: `ConcertazioneView.test.tsx`**

Mock di tutte le funzioni `api/concertazione.ts` (`vi.spyOn`), copertura minima:
- Stagione non ancora in concertazione (mock `propostaProvvisoria` che rigetta con un errore "non ancora pubblicata") → messaggio, nessuna sezione.
- Bollettino con più voci di più associazioni → tabella corretta, riga propria evidenziata.
- Lista proposte: una proposta `in_attesa_accettazione` dove la propria associazione non ha ancora accettato → bottone Accetta visibile, click chiama `accettaProposta` coi parametri corretti, poi ricarica la lista (mock chiamata una seconda volta).
- Proposta `in_attesa_accettazione` dove la propria associazione è la proponente → bottone Annulla visibile invece di Accetta (la propria parte ha già `accettatoIl` valorizzato dal proponente).
- Proposta `accettata_da_tutti`/`validata`/`rigettata`/`annullata` → nessun bottone azione.
- Form nuova proposta, tipo `scambio_bilaterale`: select "slot da cedere" visibile e popolata; submit con dati validi chiama `creaProposta` col payload atteso (campo per campo, incluso `associazioneCedenteId` valorizzato).
- Form nuova proposta, tipo `utilizzo_slot_libero`: select "slot da cedere" nascosta/assente; submit chiama `creaProposta` con `associazioneCedenteId` assente in ogni riga slot.
- Submit bloccato (messaggio inline) se nessuna riga slot presente.

- [ ] **Step 5: Esegui i test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS, incluso l'intero pacchetto.

- [ ] **Step 6: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/components/ConcertazioneView.tsx frontend-pubblico/src/App.tsx frontend-pubblico/src/types.ts frontend-pubblico/src/components/ConcertazioneView.test.tsx
git rm frontend-pubblico/src/mockData.ts
git commit -m "feat(frontend-pubblico): ConcertazioneView collegata alle API reali (bollettino, proposte multi-tipo, accetta/annulla)"
```

---

### Task 4: Smoke test end-to-end + aggiornamento documentazione

**Files:**
- Test: `frontend-pubblico/src/App.concertazione.realBackend.test.tsx`
- Modify: `CLAUDE.md`
- Modify: `docs/claude/backend-node.md`

**Interfaces:** nessuna nuova.

- [ ] **Step 1: Smoke test end-to-end**

Stesso pattern già stabilito (`App.esiti.realBackend.test.tsx`): crea 2 persone di test con `creaPersonaTest`, 2 associazioni con `creaAssociazione` (abilitazione promossa ad `'approvata'` via pg diretto per entrambe), una stagione di fixture con `stato` impostato direttamente a `'concertazione'` via UPDATE diretto (non serve passare dal flusso reale prima-assegnazione→pubblicazione, è un dettaglio di implementazione della fixture, non del comportamento testato), un impianto/spazio/2 slot di fixture, una domanda `ammessa` per ciascuna associazione (`domandaAmmessaId` lo richiede — vedi `backend-node/src/concertazione.ts`), un'assegnazione `provvisoria` di fixture per ciascuna associazione sul proprio slot.

Sequenza del test:
1. Render `<App/>` con i token della prima persona (`impostaTokens`), seleziona la stagione dal selettore Header (stesso gotcha già documentato — mai fidarsi dell'auto-selezione), naviga al tab concertazione.
2. Verifica che il bollettino mostri entrambe le voci (due associazioni, due slot).
3. Compila e invia il form "Proponi nuova concertazione" (tipo `scambio_bilaterale`, cede il proprio slot, riceve lo slot dell'altra associazione), verifica messaggio di conferma.
4. Smonta, cambia token alla seconda persona (`impostaTokens` con le credenziali della seconda), rimonta `<App/>`, seleziona la stessa stagione, naviga al tab concertazione.
5. Verifica che la proposta compaia nella sezione "Le mie proposte" con `stato: 'in_attesa_accettazione'` e il bottone Accetta visibile, click su Accetta.
6. Verifica (via lettura diretta pg, `SELECT stato FROM concertazione_proposte WHERE id = $1`) che lo stato sia transitato a `'accettata_da_tutti'`.

Cleanup in `afterAll`: elimina ogni riga creata in ordine FK-safe (`concertazione_proposta_slot`/`concertazione_proposta_parti` prima di `concertazione_proposte`, poi `assegnazioni`, `domande` e correlate, `abilitazioni`, `associazioni`, slot/spazio/impianto, persone, stagione) — leggi `App.esiti.realBackend.test.tsx`'s `afterAll` per l'ordine esatto già stabilito sulle tabelle in comune, estendilo per le tabelle nuove di questo test.

- [ ] **Step 2: Esegui il test**

Run: `cd frontend-pubblico && TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable JWT_SECRET=segreto-di-test-non-usare-in-produzione pnpm test`
Expected: PASS.

- [ ] **Step 3: Aggiorna documentazione**

`CLAUDE.md`: aggiorna il paragrafo di stato (ConcertazioneView collegata, resta solo 1 view mock: `CalendarioDefinitivoView`).
`docs/claude/backend-node.md`: nuova voce "Fatto —" per questo blocco (estensione `trovaPropostaProvvisoria`, livello API concertazione, pattern "un solo fetch del bollettino arricchisce tutte le sezioni" già visto nel blocco precedente, nota sul flusso reale accetta/annulla-non-rifiuta diverso dal vecchio mock).

- [ ] **Step 4: Commit**

```bash
git add frontend-pubblico/src/App.concertazione.realBackend.test.tsx CLAUDE.md docs/claude/backend-node.md
git commit -m "test(frontend-pubblico): smoke test end-to-end ConcertazioneView; aggiorna documentazione"
```
