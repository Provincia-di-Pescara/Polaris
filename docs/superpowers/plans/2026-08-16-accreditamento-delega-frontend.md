# AccreditamentoDelegaView: collegamento API reali Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collegare `AccreditamentoDelegaView` (primo tab del frontend pubblico dopo il login) al backend reale — lista delle proprie associazioni con stato vero, richiesta di accreditamento nuova associazione (+ upload documento opzionale), sub-delega a un altro CF su un'associazione già approvata — chiudendo il debito lasciato dal blocco precedente (`RepresentedEntity` in `types.ts`, incompatibile con `EntitaRappresentata` reale).

**Architecture:** Solo frontend — tutti gli endpoint backend necessari (`POST /pubblico/associazioni`, `POST /pubblico/associazioni/:id/documenti`, `POST /pubblico/deleghe`, `GET /stagioni`) esistono già e sono già testati lato backend (`backend-node/src/server.pubblico.test.ts`, `server.pubblico.documenti.test.ts`). Nessuna migration, nessuna modifica a `backend-node/`. Estende i pattern `api/*.ts` (`richiedi`/`ErroreRichiestaApi`) e `AuthContext` già stabiliti nel blocco precedente.

## Global Constraints

- Nessuna nuova dipendenza runtime.
- Naming: `listaX`/`creaX` coerente con le convenzioni già in uso in `frontend-pubblico/src/api/*.ts` e nel resto del repo.
- Italiano per nomi funzione/variabile/commenti/messaggi UI.
- La sub-delega usa lo `stagioneId` dell'abilitazione del delegante su quella specifica associazione (`ent.stagioneId`), **mai** una stagione scelta da un selettore globale — il backend verifica `trovaAbilitazioneAttiva(personaFisicaId, associazioneId, stagioneId)`: uno stagioneId diverso da quello dell'abilitazione attiva del delegante produce 403 anche se il delegante è effettivamente rappresentante di quell'associazione in quella stagione (vedi `backend-node/src/server.pubblico.test.ts:147-162`).
- Il selettore stagione in `Header`/`App.tsx` serve **solo** al flusso di creazione nuova associazione (che non ha un'abilitazione preesistente da cui derivare la stagione).
- Il campo "tipo ente" del mock (ASD/SSD/Istituto Scolastico) va rimosso: non esiste nello schema reale (vedi design doc). Il form reale usa: denominazione, CF/P.IVA, RNA (opzionale), data costituzione (opzionale).
- `associazioni_documenti.tipo` è vincolato solo lato zod (`schemaCaricaDocumento`, `pubblicoSchema.ts:13-15`, enum `'statuto' | 'atto_costitutivo' | 'altro'`) — replicare esattamente questo enum nel form, non inventarne altri.

---

### Task 1: Livello API — `stagioni.ts`, `associazioni.ts`, estensione `deleghe.ts`

**Files:**
- Create: `frontend-pubblico/src/api/stagioni.ts`
- Create: `frontend-pubblico/src/api/associazioni.ts`
- Modify: `frontend-pubblico/src/api/deleghe.ts`
- Test: `frontend-pubblico/src/api/stagioni.test.ts`
- Test: `frontend-pubblico/src/api/associazioni.test.ts`
- Test: `frontend-pubblico/src/api/deleghe.test.ts` (nuovo file — `deleghe.ts` non ne ha ancora uno)

**Interfaces:**
- Consumes: `richiedi` da `./client.ts` (già esistente).
- Produces (usate da Task 2-4): `listaStagioni(): Promise<Stagione[]>`; `creaAssociazione(dati: DatiCreaAssociazione): Promise<Associazione>`; `caricaDocumento(associazioneId: string, file: File, tipo: 'statuto' | 'atto_costitutivo' | 'altro'): Promise<DocumentoAssociazione>`; `creaSubDelega(dati: DatiCreaSubDelega): Promise<Abilitazione>`.

- [ ] **Step 1: `src/api/stagioni.ts`**

```typescript
import { richiedi } from './client.ts';

export interface Stagione {
  id: string;
  nome: string;
  dataInizio: string;
  dataFine: string;
  stato: string;
}

export function listaStagioni(): Promise<Stagione[]> {
  return richiedi('/stagioni');
}
```

- [ ] **Step 2: `src/api/associazioni.ts`**

```typescript
import { richiedi } from './client.ts';

export interface Associazione {
  id: string;
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione: string | null;
  dataCostituzione: string | null;
}

export interface DatiCreaAssociazione {
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione?: string | undefined;
  dataCostituzione?: string | undefined;
  stagioneId: string;
}

export function creaAssociazione(dati: DatiCreaAssociazione): Promise<Associazione> {
  return richiedi('/pubblico/associazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

export interface DocumentoAssociazione {
  id: string;
  associazioneId: string;
  tipo: string;
  filePath: string;
  caricatoIl: string;
}

// multipart/form-data: niente header content-type esplicito, il browser imposta
// il boundary. Il campo file si chiama 'file' (multer(...).single('file') lato
// backend, vedi backend-node/src/documenti/storage.ts).
export function caricaDocumento(
  associazioneId: string,
  file: File,
  tipo: 'statuto' | 'atto_costitutivo' | 'altro',
): Promise<DocumentoAssociazione> {
  const form = new FormData();
  form.append('tipo', tipo);
  form.append('file', file);
  return richiedi(`/pubblico/associazioni/${encodeURIComponent(associazioneId)}/documenti`, {
    method: 'POST',
    body: form,
  });
}
```

- [ ] **Step 3: estendi `src/api/deleghe.ts`**

Aggiungi in fondo al file esistente (non toccare `EntitaRappresentata`/`listaEntitaRappresentate` già presenti):

```typescript
export interface Abilitazione {
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
}

export interface DatiCreaSubDelega {
  codiceFiscale: string;
  nome: string;
  cognome: string;
  associazioneId: string;
  stagioneId: string;
  ruolo: 'rappresentante' | 'operatore';
}

export function creaSubDelega(dati: DatiCreaSubDelega): Promise<Abilitazione> {
  return richiedi('/pubblico/deleghe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}
```

- [ ] **Step 4: `src/api/stagioni.test.ts`**

Pattern: backend reale (`avviaBackendReale`/`impostaTokens`/`rimuoviTokens` da `./client.ts`, `creaPersonaTest` da `../testUtil/creaPersonaTest.ts` — entrambi già esistenti dal blocco precedente). `GET /stagioni` non richiede autenticazione, ma la chiamata comunque passa da `richiedi`/`apiFetch`: nessun token necessario per questo test.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { listaStagioni } from './stagioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('stagioni.ts', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
  });

  it('restituisce un array (anche vuoto) senza richiedere autenticazione', async () => {
    const stagioni = await listaStagioni();
    expect(Array.isArray(stagioni)).toBe(true);
  });
});
```

- [ ] **Step 5: `src/api/associazioni.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './client.ts';
import { creaAssociazione, caricaDocumento } from './associazioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('associazioni.ts', () => {
  let backend: BackendReale;
  const personeCreate: PersonaTest[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(personeCreate.map((p) => p.elimina()));
  });

  it('creaAssociazione crea una nuova associazione con abilitazione in_attesa', async () => {
    const p = await creaPersonaTest(dsn!);
    personeCreate.push(p);
    impostaTokens(p.accessToken, p.refreshToken);

    // Nessun helper esistente per creare una stagione di test lato frontend:
    // usa fetch diretta su POST /backoffice/stagioni con un utente backoffice
    // di test — se questo risulta più complesso del necessario, in alternativa
    // inserisci la riga direttamente via pg (stesso pattern usato nei test
    // backend, es. server.pubblico.test.ts:creaStagioneTest) con una query pg
    // diretta usando TEST_DATABASE_URL. Scegli l'opzione più semplice e
    // documentala nel report.
    const suffisso = randomUUID().slice(0, 8);
    const associazione = await creaAssociazione({
      denominazione: `ASD Test API ${suffisso}`,
      codiceFiscalePartitaIva: `PIVA-${suffisso}`,
      stagioneId: /* stagione di test creata sopra */ '',
    });
    expect(associazione.denominazione).toBe(`ASD Test API ${suffisso}`);
  });

  it('caricaDocumento carica un PDF valido su un\'associazione propria', async () => {
    // Riusa un'associazione creata come nel test precedente, poi:
    const pdf = new File([new Blob([Buffer.from('%PDF-1.4\ncontenuto finto')])], 'statuto.pdf', { type: 'application/pdf' });
    // const documento = await caricaDocumento(associazione.id, pdf, 'statuto');
    // expect(documento.tipo).toBe('statuto');
  });
});
```

L'implementatore deve completare i dettagli lasciati come commento/placeholder sopra (creazione di una stagione di test reale, riuso dell'associazione tra i due test) seguendo il pattern già stabilito in `backend-node/src/server.pubblico.test.ts`/`server.pubblico.documenti.test.ts` (letti per intero prima di scrivere il test) — questo è l'unico punto del piano dove il codice esatto non è scritto per intero, perché dipende da come l'implementatore sceglie di ottenere una `stagioneId` di test lato frontend (nessun helper esistente per questo).

- [ ] **Step 6: `src/api/deleghe.test.ts`**

Copre `creaSubDelega`, riusando lo scenario di `backend-node/src/server.pubblico.test.ts:122-181` (rappresentante approvato delega un nuovo CF, sub-delega auto-approvata) ma chiamato tramite `creaSubDelega` invece di `fetch` diretta. Segui lo stesso pattern di creazione stagione/associazione del Step 5.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from '../testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './client.ts';
import { creaAssociazione } from './associazioni.ts';
import { creaSubDelega } from './deleghe.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('deleghe.ts — creaSubDelega', () => {
  let backend: BackendReale;
  const personeCreate: PersonaTest[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(personeCreate.map((p) => p.elimina()));
  });

  it('rappresentante approvato può delegare un nuovo CF (auto-approvata)', async () => {
    // Segui lo stesso pattern di creazione stagione+associazione dello Step 5.
    // Poi:
    // const delega = await creaSubDelega({
    //   codiceFiscale: `TSTDEL${randomUUID().slice(0, 10).toUpperCase()}`,
    //   nome: 'Nuovo', cognome: 'Delegato',
    //   associazioneId: associazione.id, stagioneId, ruolo: 'operatore',
    // });
    // expect(delega.stato).toBe('approvata');
    // expect(delega.creataDaAbilitazioneId).toBeTruthy();
  });
});
```

- [ ] **Step 7: Esegui i test**

Run: `cd frontend-pubblico && pnpm test` con `TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/palestre?sslmode=disable` e `JWT_SECRET=segreto-di-test-non-usare-in-produzione`.
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/api/stagioni.ts frontend-pubblico/src/api/associazioni.ts frontend-pubblico/src/api/deleghe.ts frontend-pubblico/src/api/stagioni.test.ts frontend-pubblico/src/api/associazioni.test.ts frontend-pubblico/src/api/deleghe.test.ts
git commit -m "feat(frontend-pubblico): aggiunge livello API stagioni/associazioni/sub-delega"
```

---

### Task 2: Header — selettore stagione, App.tsx — wiring `stagioneId`

**Files:**
- Modify: `frontend-pubblico/src/components/Header.tsx`
- Modify: `frontend-pubblico/src/App.tsx`
- Test: `frontend-pubblico/src/components/Header.test.tsx` (estensione)
- Test: `frontend-pubblico/src/App.test.tsx` (estensione)

**Interfaces:**
- Consumes: `listaStagioni`/`Stagione` da `../api/stagioni.ts` (Task 1).
- Produces (usato da Task 3): `App.tsx` espone `stagioneId: string | null` a `AccreditamentoDelegaView`.

- [ ] **Step 1: `Header.tsx` — aggiungi il selettore stagione**

Nuove props: `stagioni: Stagione[]; stagioneId: string | null; setStagioneId: (id: string) => void;` (importa `type { Stagione }` da `../api/stagioni.ts`). Aggiungi un secondo `<select>` accanto allo switcher associazioni (stesso box/stile, nuovo blocco a fianco), con label "Stagione:", opzioni `stagioni.map(s => <option value={s.id}>{s.nome}</option>)`. Se `stagioni.length === 0`, non renderizzare il selettore (nessun placeholder necessario — il caricamento è già coperto dallo stato `caricamento` di `AppAutenticata`).

- [ ] **Step 2: `App.tsx` — carica stagioni, seleziona default, passa giù**

In `AppAutenticata`, aggiungi:

```typescript
const [stagioni, setStagioni] = useState<Stagione[]>([]);
const [stagioneId, setStagioneId] = useState<string | null>(null);

useEffect(() => {
  let annullato = false;
  listaStagioni()
    .then((s) => {
      if (annullato) return;
      setStagioni(s);
      // Default: prima stagione non chiusa, ordine già data_inizio DESC dal
      // backend (vedi backend-node/src/stagioni.ts:22-26) — se tutte chiuse,
      // fallback alla prima in assoluto.
      const nonChiusa = s.find((st) => st.stato !== 'chiusa');
      setStagioneId((prev) => prev ?? nonChiusa?.id ?? s[0]?.id ?? null);
    })
    .catch(() => {
      // Nessuna stagione disponibile non deve bloccare il resto dell'app —
      // il selettore resta vuoto, il flusso di creazione associazione lo
      // segnalerà se l'utente prova a usarlo senza una stagione selezionata.
    });
  return () => {
    annullato = true;
  };
}, []);
```

Importa `listaStagioni`, `type Stagione` da `./api/stagioni.ts`. Passa `stagioni`, `stagioneId`, `setStagioneId` a `<Header>`. Non passare ancora `stagioneId` ad `AccreditamentoDelegaView` in questo task (arriva nel Task 3, insieme al resto del rewiring di quella view) — questo task si ferma al caricamento/selezione, verificato dai suoi stessi test.

- [ ] **Step 3: Test `Header.test.tsx` — aggiungi**

```typescript
const STAGIONE: Stagione = { id: 'st1', nome: 'Stagione 2026/2027', dataInizio: '2026-09-01', dataFine: '2027-06-30', stato: 'censimento' };

it('mostra il selettore stagione con le stagioni fornite', () => {
  render(
    <Header persona={PERSONA} entities={[]} activeEntity={null} setActiveEntity={vi.fn()}
      activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={vi.fn()}
      stagioni={[STAGIONE]} stagioneId="st1" setStagioneId={vi.fn()} />,
  );
  expect(screen.getByText(/Stagione 2026\/2027/)).toBeInTheDocument();
});

it('nessuna stagione: non mostra il selettore stagione', () => {
  render(
    <Header persona={PERSONA} entities={[]} activeEntity={null} setActiveEntity={vi.fn()}
      activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={vi.fn()}
      stagioni={[]} stagioneId={null} setStagioneId={vi.fn()} />,
  );
  // Adatta l'assertion al markup reale scelto nello Step 1 (es. assenza di un
  // secondo combobox, o di un testo/etichetta specifico "Stagione:").
});
```

(Importa `type { Stagione }` da `../api/stagioni.ts` in cima al file. Aggiorna anche le chiamate a `<Header>` già esistenti nel file con le nuove props obbligatorie `stagioni`/`stagioneId`/`setStagioneId` — altrimenti quei test non compilano più.)

- [ ] **Step 4: Test `App.test.tsx` — aggiungi**

```typescript
it('carica le stagioni e seleziona di default la prima non chiusa', async () => {
  vi.spyOn(authApi, 'leggiPersonaAutenticata').mockResolvedValue({ sub: 'p1', codiceFiscale: 'CF', nome: 'Mario', cognome: 'Rossi' });
  vi.spyOn(deleghe, 'listaEntitaRappresentate').mockResolvedValue([]);
  vi.spyOn(stagioniApi, 'listaStagioni').mockResolvedValue([
    { id: 'st-chiusa', nome: 'Vecchia', dataInizio: '2024-09-01', dataFine: '2025-06-30', stato: 'chiusa' },
    { id: 'st-attiva', nome: 'Corrente', dataInizio: '2026-09-01', dataFine: '2027-06-30', stato: 'censimento' },
  ]);
  render(<App />);
  expect(await screen.findByText(/Corrente/)).toBeInTheDocument();
});
```

(Importa `import * as stagioniApi from './api/stagioni.ts';` in cima al file, seguendo lo stesso pattern di `authApi`/`deleghe` già presenti.)

- [ ] **Step 5: Esegui i test, typecheck, commit**

Run: `cd frontend-pubblico && pnpm test` — expected PASS (inclusi i test Header/App esistenti, ora con le nuove props).
Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`.

```bash
git add frontend-pubblico/src/components/Header.tsx frontend-pubblico/src/App.tsx frontend-pubblico/src/components/Header.test.tsx frontend-pubblico/src/App.test.tsx
git commit -m "feat(frontend-pubblico): selettore stagione in Header, wiring in App.tsx"
```

---

### Task 3: `AccreditamentoDelegaView` — lista reale + creazione associazione + upload documento

**Files:**
- Modify: `frontend-pubblico/src/types.ts`
- Modify: `frontend-pubblico/src/components/AccreditamentoDelegaView.tsx` (riscrittura)
- Modify: `frontend-pubblico/src/App.tsx`
- Test: `frontend-pubblico/src/components/AccreditamentoDelegaView.test.tsx` (nuovo)

**Interfaces:**
- Consumes: `EntitaRappresentata` (`../api/deleghe.ts`), `creaAssociazione`/`caricaDocumento`/`Associazione` (`../api/associazioni.ts`, Task 1), `ErroreRichiestaApi` (`../api/client.ts`).
- Produces (usato da Task 4): `AccreditamentoDelegaView` con props `{ entities: EntitaRappresentata[]; stagioneId: string | null; onRicarica: () => void }` — Task 4 aggiunge la sub-delega sulla stessa view, non ne cambia le props base.

- [ ] **Step 1: Rimuovi `RepresentedEntity` da `types.ts`**

Prima di rimuovere, verifica che nessun altro file lo importi ancora:

Run: `grep -rn "RepresentedEntity" frontend-pubblico/src`

Se l'unico importatore rimasto è `AccreditamentoDelegaView.tsx` (che questo task riscrive), rimuovi l'interfaccia da `types.ts` (righe 1-9 nel file attuale). Se emergono altri importatori inattesi, fermati e segnalalo nel report invece di romperli.

- [ ] **Step 2: Riscrivi `AccreditamentoDelegaView.tsx` (parte 1 — lista + creazione)**

```typescript
import React, { useState } from 'react';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import { creaAssociazione, caricaDocumento, type DatiCreaAssociazione } from '../api/associazioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { FileCheck2, Plus, Upload, CheckCircle2, Shield, Building2 } from 'lucide-react';

interface AccreditamentoDelegaProps {
  entities: EntitaRappresentata[];
  stagioneId: string | null;
  onRicarica: () => void;
}

const TIPO_DOCUMENTO_OPZIONI: Array<{ value: 'statuto' | 'atto_costitutivo' | 'altro'; label: string }> = [
  { value: 'statuto', label: 'Statuto' },
  { value: 'atto_costitutivo', label: 'Atto Costitutivo' },
  { value: 'altro', label: 'Altro' },
];

export const AccreditamentoDelegaView: React.FC<AccreditamentoDelegaProps> = ({ entities, stagioneId, onRicarica }) => {
  const [showModal, setShowModal] = useState(false);
  const [denominazione, setDenominazione] = useState('');
  const [codiceFiscalePartitaIva, setCodiceFiscalePartitaIva] = useState('');
  const [rnaNumeroIscrizione, setRnaNumeroIscrizione] = useState('');
  const [dataCostituzione, setDataCostituzione] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<'statuto' | 'atto_costitutivo' | 'altro'>('statuto');
  const [file, setFile] = useState<File | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [avvisoUploadFallito, setAvvisoUploadFallito] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const resetForm = (): void => {
    setDenominazione('');
    setCodiceFiscalePartitaIva('');
    setRnaNumeroIscrizione('');
    setDataCostituzione('');
    setFile(null);
    setTipoDocumento('statuto');
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!stagioneId) {
      setErrore('Nessuna stagione selezionata: seleziona una stagione dall\'intestazione prima di procedere.');
      return;
    }
    setErrore(null);
    setAvvisoUploadFallito(null);
    setInCorso(true);
    try {
      const dati: DatiCreaAssociazione = {
        denominazione,
        codiceFiscalePartitaIva,
        stagioneId,
        ...(rnaNumeroIscrizione ? { rnaNumeroIscrizione } : {}),
        ...(dataCostituzione ? { dataCostituzione } : {}),
      };
      const associazione = await creaAssociazione(dati);
      if (file) {
        try {
          await caricaDocumento(associazione.id, file, tipoDocumento);
        } catch (errUpload) {
          // L'associazione è comunque creata: un fallimento dell'upload non deve
          // sembrare un fallimento totale dell'operazione.
          setAvvisoUploadFallito(
            errUpload instanceof ErroreRichiestaApi
              ? `Associazione creata, ma il caricamento del documento è fallito: ${errUpload.message}`
              : 'Associazione creata, ma il caricamento del documento è fallito. Puoi ritentare in seguito.',
          );
        }
      }
      onRicarica();
      setShowModal(false);
      resetForm();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante la richiesta di accreditamento.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
            Gestione Deleghe & Rappresentanza Legale
          </h2>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Accreditamento della tua persona fisica (SPID) a nome delle Associazioni Sportive della Provincia
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">
          <Plus size={16} />
          <span>Richiedi Nuova Delega Rappresentanza</span>
        </button>
      </div>

      {avvisoUploadFallito && (
        <div style={{ backgroundColor: '#FEF9E7', color: '#B7950B', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {avvisoUploadFallito}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {entities.length === 0 && (
          <div className="pa-card" style={{ color: 'var(--pa-text-muted)' }}>
            Nessuna associazione accreditata. Usa "Richiedi Nuova Delega Rappresentanza" per iniziare.
          </div>
        )}
        {entities.map(ent => (
          <div key={ent.id} className="pa-card" style={{ borderTop: '4px solid var(--pa-blue-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <Building2 size={24} color="var(--pa-blue-primary)" />
                <div>
                  <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>{ent.associazioneDenominazione ?? '—'}</h3>
                  <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)' }}>P.IVA / CF: {ent.associazioneCodiceFiscalePartitaIva ?? '—'}</div>
                </div>
              </div>
              {ent.stato === 'approvata' && <span className="badge badge-success"><CheckCircle2 size={12} /> Approvato</span>}
              {ent.stato === 'in_attesa' && <span className="badge badge-warning">In Esame Operatore</span>}
              {ent.stato === 'respinta' && <span className="badge badge-danger">Respinto</span>}
              {ent.stato === 'revocata' && <span className="badge badge-danger">Revocato</span>}
            </div>
            <div style={{ backgroundColor: '#F8FAFC', padding: '0.75rem', borderRadius: '6px', fontSize: '0.825rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--pa-text-muted)' }}>Ruolo:</span>
                <strong>{ent.titolo === 'legale_rappresentante' ? 'Legale Rappresentante' : 'Delegato'} ({ent.ruolo})</strong>
              </div>
            </div>
            {/* L'azione "Invita delegato" per le entità approvata arriva nel Task 4. */}
          </div>
        ))}
      </div>

      <div className="pa-card" style={{ backgroundColor: '#EBF5FB', borderLeft: '4px solid var(--pa-blue-primary)' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Shield size={24} color="var(--pa-blue-primary)" style={{ flexShrink: 0 }} />
          <div>
            <h4 style={{ color: 'var(--pa-blue-dark)', fontSize: '1rem' }}>Art. 3 Documento Principale — Tracciabilità Identità Digitale</h4>
            <p style={{ fontSize: '0.85rem', color: '#1B4F72', marginTop: '3px' }}>
              Ogni operazione eseguita nel portale viene associata sia all'identità SPID della persona fisica operante, sia all'associazione rappresentata. La delega viene verificata dagli operatori della Provincia prima dell'ammissione alle domande.
            </p>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--pa-blue-dark)' }}>Richiesta Nuova Delega Rappresentanza</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-denominazione">Denominazione Ufficiale Associazione:</label>
                <input id="acc-denominazione" type="text" required value={denominazione}
                  onChange={(e) => setDenominazione(e.target.value)} placeholder="Es. ASD Pescara Basket" className="form-control" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-cf">Codice Fiscale / P.IVA:</label>
                  <input id="acc-cf" type="text" required value={codiceFiscalePartitaIva}
                    onChange={(e) => setCodiceFiscalePartitaIva(e.target.value)} placeholder="Es. 92012340681" className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rna">Numero Iscrizione RNA (opzionale):</label>
                  <input id="acc-rna" type="text" value={rnaNumeroIscrizione}
                    onChange={(e) => setRnaNumeroIscrizione(e.target.value)} className="form-control" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-data-costituzione">Data Costituzione (opzionale):</label>
                <input id="acc-data-costituzione" type="date" value={dataCostituzione}
                  onChange={(e) => setDataCostituzione(e.target.value)} className="form-control" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-tipo-doc">Tipo Documento (opzionale):</label>
                <select id="acc-tipo-doc" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value as typeof tipoDocumento)} className="form-control">
                  {TIPO_DOCUMENTO_OPZIONI.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-file">Carica Documento (PDF, opzionale):</label>
                <input id="acc-file" type="file" accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="form-control" />
                {file && (
                  <div style={{ fontWeight: 700, color: 'var(--pa-success)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem' }}>
                    <CheckCircle2 size={16} /> {file.name}
                  </div>
                )}
              </div>
              {errore && (
                <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginTop: '0.75rem' }}>
                  {errore}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button type="button" onClick={() => { setShowModal(false); resetForm(); setErrore(null); }} className="btn btn-secondary">Annulla</button>
                <button type="submit" className="btn btn-primary" disabled={inCorso}>
                  {inCorso ? 'Invio in corso…' : 'Invia Delega all\'Operatore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
```

L'implementatore verifichi la disponibilità della classe CSS `badge-danger` (usata per `respinta`/`revocata`) nel foglio di stile globale del progetto — se non esiste, riusi uno stile inline coerente con `badge-warning` invece di introdurre una classe CSS nuova non definita altrove.

- [ ] **Step 3: Aggiorna `App.tsx`**

Sostituisci la riga placeholder:

```typescript
{activeTab === 'accreditamento' && <AccreditamentoDelegaView entities={[]} onAddNewEntity={() => {}} />}
```

con:

```typescript
{activeTab === 'accreditamento' && (
  <AccreditamentoDelegaView entities={entities} stagioneId={stagioneId} onRicarica={ricarica} />
)}
```

(`ricarica` è già esposta da `useAuth()`, vedi `AuthContext.tsx` — destrutturala insieme a `persona`/`entities`/`caricamento`/`logout` in cima ad `AppAutenticata` se non già presente). Rimuovi il commento placeholder che marcava il debito (righe 49-53 del file attuale).

- [ ] **Step 4: `AccreditamentoDelegaView.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as associazioniApi from '../api/associazioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { AccreditamentoDelegaView } from './AccreditamentoDelegaView.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';

const ENTITA_APPROVATA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 's1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

describe('AccreditamentoDelegaView', () => {
  it('mostra le associazioni reali (non mock), incluso lo stato', () => {
    render(<AccreditamentoDelegaView entities={[ENTITA_APPROVATA]} stagioneId="st1" onRicarica={vi.fn()} />);
    expect(screen.getByText('ASD Test')).toBeInTheDocument();
    expect(screen.getByText(/Approvato/)).toBeInTheDocument();
  });

  it('nessuna associazione: mostra lo stato vuoto', () => {
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={vi.fn()} />);
    expect(screen.getByText(/nessuna associazione accreditata/i)).toBeInTheDocument();
  });

  it('crea associazione: chiama creaAssociazione con stagioneId, poi onRicarica', async () => {
    const spy = vi.spyOn(associazioniApi, 'creaAssociazione').mockResolvedValue({
      id: 'nuova-ass', denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', rnaNumeroIscrizione: null, dataCostituzione: null,
    });
    const onRicarica = vi.fn();
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={onRicarica} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', stagioneId: 'st1' }));
    expect(await vi.waitFor(() => onRicarica)).toHaveBeenCalled();
  });

  it('senza stagioneId selezionato: mostra errore, non chiama creaAssociazione', async () => {
    const spy = vi.spyOn(associazioniApi, 'creaAssociazione');
    render(<AccreditamentoDelegaView entities={[]} stagioneId={null} onRicarica={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(screen.getByText(/seleziona una stagione/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('creazione associazione riuscita ma upload documento fallito: mostra avviso distinto, chiama comunque onRicarica', async () => {
    vi.spyOn(associazioniApi, 'creaAssociazione').mockResolvedValue({
      id: 'nuova-ass', denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', rnaNumeroIscrizione: null, dataCostituzione: null,
    });
    vi.spyOn(associazioniApi, 'caricaDocumento').mockRejectedValue(new ErroreRichiestaApi(415, 'il contenuto del file non è un PDF valido'));
    const onRicarica = vi.fn();
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={onRicarica} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    const file = new File(['contenuto'], 'doc.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/carica documento/i), file);
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(await screen.findByText(/associazione creata, ma il caricamento del documento è fallito/i)).toBeInTheDocument();
    expect(onRicarica).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Esegui i test, typecheck, commit**

Run: `cd frontend-pubblico && pnpm test` — expected PASS (inclusi gli altri test del pacchetto, `App.test.tsx` incluso: verifica che il rewiring in App.tsx non abbia rotto nulla).
Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`.

```bash
git add frontend-pubblico/src/types.ts frontend-pubblico/src/components/AccreditamentoDelegaView.tsx frontend-pubblico/src/App.tsx frontend-pubblico/src/components/AccreditamentoDelegaView.test.tsx
git commit -m "feat(frontend-pubblico): AccreditamentoDelegaView collegata alle API reali (lista + creazione associazione + upload documento)"
```

---

### Task 4: `AccreditamentoDelegaView` — sub-delega ("Invita delegato")

**Files:**
- Modify: `frontend-pubblico/src/components/AccreditamentoDelegaView.tsx`
- Test: `frontend-pubblico/src/components/AccreditamentoDelegaView.test.tsx` (estensione)

**Interfaces:**
- Consumes: `creaSubDelega`, `type DatiCreaSubDelega` (`../api/deleghe.ts`, Task 1).

- [ ] **Step 1: Aggiungi lo stato e il modale di sub-delega**

Nel componente `AccreditamentoDelegaView`, aggiungi:

```typescript
const [entitaPerDelega, setEntitaPerDelega] = useState<EntitaRappresentata | null>(null);
const [cfDelegato, setCfDelegato] = useState('');
const [nomeDelegato, setNomeDelegato] = useState('');
const [cognomeDelegato, setCognomeDelegato] = useState('');
const [ruoloDelegato, setRuoloDelegato] = useState<'rappresentante' | 'operatore'>('operatore');
const [erroreDelega, setErroreDelega] = useState<string | null>(null);
const [inCorsoDelega, setInCorsoDelega] = useState(false);

const handleSubmitDelega = async (e: React.FormEvent): Promise<void> => {
  e.preventDefault();
  if (!entitaPerDelega || entitaPerDelega.associazioneId === null) return;
  setErroreDelega(null);
  setInCorsoDelega(true);
  try {
    await creaSubDelega({
      codiceFiscale: cfDelegato,
      nome: nomeDelegato,
      cognome: cognomeDelegato,
      associazioneId: entitaPerDelega.associazioneId,
      // Stagione dell'abilitazione del delegante su QUESTA associazione, mai
      // una stagione scelta altrove — vedi Global Constraints nel piano.
      stagioneId: entitaPerDelega.stagioneId,
      ruolo: ruoloDelegato,
    });
    onRicarica();
    setEntitaPerDelega(null);
    setCfDelegato('');
    setNomeDelegato('');
    setCognomeDelegato('');
    setRuoloDelegato('operatore');
  } catch (err) {
    setErroreDelega(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante l\'invito.');
  } finally {
    setInCorsoDelega(false);
  }
};
```

Importa `creaSubDelega` da `../api/deleghe.ts` in cima al file (aggiungilo all'import esistente `import type { EntitaRappresentata } from '../api/deleghe.ts';`, diventa `import { creaSubDelega, type EntitaRappresentata } from '../api/deleghe.ts';`).

- [ ] **Step 2: Aggiungi il bottone "Invita delegato" sulle card approvata**

Nel blocco `{entities.map(ent => ...)}` del Task 3, dentro la card, dopo il box con Ruolo/stato, aggiungi (solo per `ent.stato === 'approvata'`):

```tsx
{ent.stato === 'approvata' && (
  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
    <button onClick={() => setEntitaPerDelega(ent)} className="btn btn-secondary btn-sm">
      <FileCheck2 size={14} /> Invita Delegato
    </button>
  </div>
)}
```

- [ ] **Step 3: Aggiungi il modale di sub-delega, in fondo al componente (accanto al modale esistente)**

```tsx
{entitaPerDelega && (
  <div className="modal-overlay">
    <div className="modal-content" style={{ padding: '1.5rem' }}>
      <h3 style={{ marginBottom: '1rem', color: 'var(--pa-blue-dark)' }}>
        Invita Delegato per {entitaPerDelega.associazioneDenominazione ?? 'questa associazione'}
      </h3>
      <form onSubmit={handleSubmitDelega}>
        <div className="form-group">
          <label className="form-label" htmlFor="del-cf">Codice Fiscale:</label>
          <input id="del-cf" type="text" required value={cfDelegato} onChange={(e) => setCfDelegato(e.target.value)} className="form-control" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="del-nome">Nome:</label>
            <input id="del-nome" type="text" required value={nomeDelegato} onChange={(e) => setNomeDelegato(e.target.value)} className="form-control" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="del-cognome">Cognome:</label>
            <input id="del-cognome" type="text" required value={cognomeDelegato} onChange={(e) => setCognomeDelegato(e.target.value)} className="form-control" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="del-ruolo">Ruolo:</label>
          <select id="del-ruolo" value={ruoloDelegato} onChange={(e) => setRuoloDelegato(e.target.value as typeof ruoloDelegato)} className="form-control">
            <option value="operatore">Operatore</option>
            {/* Solo un delegante con ruolo 'rappresentante' può assegnare ruolo
                'rappresentante' — vedi backend-node/src/server.ts:1272-1275.
                Nascondere l'opzione qui evita un submit destinato al 403. */}
            {entitaPerDelega.ruolo === 'rappresentante' && <option value="rappresentante">Rappresentante</option>}
          </select>
        </div>
        {erroreDelega && (
          <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginTop: '0.75rem' }}>
            {erroreDelega}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={() => setEntitaPerDelega(null)} className="btn btn-secondary">Annulla</button>
          <button type="submit" className="btn btn-primary" disabled={inCorsoDelega}>
            {inCorsoDelega ? 'Invio in corso…' : 'Invia Invito'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
```

- [ ] **Step 4: Estendi `AccreditamentoDelegaView.test.tsx`**

```typescript
import * as delegheApi from '../api/deleghe.ts';

it('invita delegato: chiama creaSubDelega con lo stagioneId dell\'abilitazione, non uno globale', async () => {
  const spy = vi.spyOn(delegheApi, 'creaSubDelega').mockResolvedValue({
    id: 'del1', personaFisicaId: 'p2', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 's1',
    titolo: 'delegato', ruolo: 'operatore', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: 'a1',
  });
  const onRicarica = vi.fn();
  render(<AccreditamentoDelegaView entities={[ENTITA_APPROVATA]} stagioneId="stagione-diversa-selezionata-in-header" onRicarica={onRicarica} />);

  await userEvent.click(screen.getByRole('button', { name: /invita delegato/i }));
  await userEvent.type(screen.getByLabelText(/codice fiscale/i), 'DLGDLG80A01H501U');
  await userEvent.type(screen.getByLabelText(/^nome/i), 'Nuovo');
  await userEvent.type(screen.getByLabelText(/^cognome/i), 'Delegato');
  await userEvent.click(screen.getByRole('button', { name: /invia invito/i }));

  expect(spy).toHaveBeenCalledWith(expect.objectContaining({
    associazioneId: 'ass1',
    stagioneId: 's1', // = ENTITA_APPROVATA.stagioneId, non "stagione-diversa-selezionata-in-header"
    ruolo: 'operatore',
  }));
  expect(await vi.waitFor(() => onRicarica)).toHaveBeenCalled();
});

it('delegante con ruolo operatore: il dropdown non offre l\'opzione rappresentante', async () => {
  const entitaOperatore = { ...ENTITA_APPROVATA, ruolo: 'operatore' as const };
  render(<AccreditamentoDelegaView entities={[entitaOperatore]} stagioneId="st1" onRicarica={vi.fn()} />);

  await userEvent.click(screen.getByRole('button', { name: /invita delegato/i }));

  expect(screen.queryByRole('option', { name: /rappresentante/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Esegui i test, typecheck, commit**

Run: `cd frontend-pubblico && pnpm test`
Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/components/AccreditamentoDelegaView.tsx frontend-pubblico/src/components/AccreditamentoDelegaView.test.tsx
git commit -m "feat(frontend-pubblico): AccreditamentoDelegaView, aggiunge invito sub-delega"
```

---

### Task 5: Smoke test end-to-end contro backend reale

**Files:**
- Test: `frontend-pubblico/src/App.accreditamento.realBackend.test.tsx`

**Interfaces:**
- Consumes: `avviaBackendReale`, `creaPersonaTest` (`../testUtil/`), `impostaTokens` (`./api/client.ts`), `App` (`./App.tsx`).

- [ ] **Step 1: Scrivi il test end-to-end**

Copre il ciclo reale: persona autenticata (token pre-iniettato, stesso pattern di `App.realBackend.test.tsx` del blocco precedente) → tab accreditamento → compila e invia il form di nuova associazione → verifica che la card compaia nella lista dopo il refresh dei dati (`AuthContext.ricarica()` innescata dal componente).

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { avviaBackendReale, type BackendReale } from './testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from './testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './api/client.ts';
import { App } from './App.tsx';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('App — accreditamento (backend reale)', () => {
  let backend: BackendReale;
  const personeCreate: PersonaTest[] = [];

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    rimuoviTokens();
    await backend.chiudi();
    await Promise.all(personeCreate.map((p) => p.elimina()));
  });

  it('crea una nuova associazione dal form e la vede comparire nella lista dopo il salvataggio', async () => {
    const p = await creaPersonaTest(dsn!);
    personeCreate.push(p);
    impostaTokens(p.accessToken, p.refreshToken);

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /richiedi nuova delega/i }));

    const suffisso = randomUUID().slice(0, 8);
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), `ASD Smoke ${suffisso}`);
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), `PIVA-${suffisso}`);

    // Il form richiede una stagione selezionata: attende che il caricamento
    // automatico di App.tsx ne abbia già impostata una di default (vedi Task 2).
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(await screen.findByText(new RegExp(`ASD Smoke ${suffisso}`), {}, { timeout: 10000 })).toBeInTheDocument();
  }, 20000);
});
```

Nota per l'implementatore: se al momento dell'esecuzione non esiste ancora nessuna stagione nel DB di test (ambiente pulito), il test fallirà perché il selettore stagione resterà vuoto — in tal caso inserisci una stagione di test direttamente via query `pg` prima del render (stesso pattern usato in `backend-node/src/server.pubblico.test.ts:creaStagioneTest`, adattato con una connessione `pg.Pool` diretta in questo file di test, chiusa in `afterAll`).

- [ ] **Step 2: Esegui il test**

Run: `cd frontend-pubblico && pnpm test -- App.accreditamento.realBackend.test.tsx`
Expected: PASS.

- [ ] **Step 3: Esegui l'intera suite del pacchetto una volta in più per la verifica finale**

Run: `cd frontend-pubblico && pnpm test`
Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend-pubblico/src/App.accreditamento.realBackend.test.tsx
git commit -m "test(frontend-pubblico): smoke test end-to-end flusso accreditamento nuova associazione"
```
