# Coda verso il motore Go — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il backend Node orchestra via HTTP interno il motore Go (`engine-go/internal/httpapi`) per innescare istruttoria/blocchi-gara/prima-assegnazione da route backoffice, sostituendo `curl` manuale, e espone lo storico delle elaborazioni.

**Architecture:** Un client HTTP puro (`src/engine/client.ts`, nessuna dipendenza Express) chiama i tre endpoint del motore Go e mappa risposte/errori a tipi TS ed eccezioni di dominio. `server.ts` inietta questo client (o un fittizio nei test) via `DipendenzeApp`, e tre route POST (solo admin) lo richiamano dentro `pg_advisory_xact_lock` per stagione con verifica dell'ordine delle fasi e audit log; una quarta route GET (admin+operatore) legge lo storico da `elaborazioni`.

**Tech Stack:** Node.js 24 (fetch nativo, `AbortSignal.timeout`), TypeScript 7 (typecheck-only), Express, `pg`, `node:test`, `node:http` per il fixture di test del motore.

## Global Constraints

- Niente ORM: query SQL parametrizzate dirette (`pg`), stesso stile del resto del backend.
- Niente build step: import con estensione `.ts` esplicita, `tsc --noEmit` solo per typecheck.
- Test con `node:test` nativo, mai mock di `fetch` — un server HTTP reale (`node:http`, porta 0) simula il motore Go nei test unitari del client; i test di route usano Postgres reale (`TEST_DATABASE_URL`, skip pulito se assente) e un `clientMotore` fittizio iniettato via `DipendenzeApp`.
- Ogni scrittura (transizione riuscita) passa da `registraOperazione` (art. B.39) nella stessa transazione della scrittura che rappresenta.
- Mappare `22P02` (stagioneId malformato nel path) a HTTP 400 su tutte le route, incluse le GET — pattern consolidato (`comeErroreRiferimentoNonValido`).
- Solo `admin` sulle tre POST (calcoli irreversibili su una stagione); `admin`+`operatore` sulla GET storico.
- `ENGINE_URL`/`ENGINE_TIMEOUT_MS` (default `300000` ms) letti da env — sono bootstrap, non configurazione di business (stesso livello di `DATABASE_URL`/`PORT`).
- Il motore Go non modificato da questo blocco — `elaborazioni.tipo` NON include `'istruttoria'` (CHECK esistente), quindi lo storico non mostrerà mai un'esecuzione di istruttoria; comportamento noto e accettato, non un bug da correggere qui.

---

### Task 1: Client HTTP verso il motore Go

**Files:**
- Create: `backend-node/src/engine/client.ts`
- Test: `backend-node/src/engine/client.test.ts`

**Interfaces:**
- Produces:
  - `interface RisultatoIstruttoria { domandeCalcolate: number }`
  - `interface RisultatoBlocchiGara { elaborazioneId: string; numeroAssegnazioni: number; richiesteNonAssegnate: number }`
  - `interface RisultatoPrimaAssegnazione { elaborazioneId: string; numeroAssegnazioni: number; roundEseguiti: number }`
  - `class ErroreMotoreIrraggiungibile extends Error {}`
  - `class ErroreMotoreDominio extends Error {}`
  - `interface ClientMotore { eseguiIstruttoria(stagioneId: string): Promise<RisultatoIstruttoria>; eseguiBlocchiGara(stagioneId: string): Promise<RisultatoBlocchiGara>; eseguiPrimaAssegnazione(stagioneId: string): Promise<RisultatoPrimaAssegnazione>; }`
  - `function creaClientMotore(baseUrl: string, timeoutMs: number): ClientMotore`

Nessuna dipendenza da task precedenti (primo task del blocco).

- [ ] **Step 1: Scrivere il test che verifica una chiamata riuscita**

Crea `backend-node/src/engine/client.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { creaClientMotore, ErroreMotoreIrraggiungibile, ErroreMotoreDominio } from './client.ts';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function avviaServerFittizio(handler: Handler): Promise<{ baseUrl: string; chiudi: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('impossibile determinare la porta del server fittizio');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    chiudi: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test('eseguiIstruttoria: risposta 200 valida mappata in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/stagioni/stagione-1/istruttoria');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ domande_calcolate: 7 }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.eseguiIstruttoria('stagione-1');
    assert.deepEqual(risultato, { domandeCalcolate: 7 });
  } finally {
    await chiudi();
  }
});

test('eseguiBlocchiGara: risposta 200 valida mappata in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.url, '/stagioni/stagione-2/blocchi-gara');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ elaborazione_id: 'elab-1', numero_assegnazioni: 3, richieste_non_assegnate: 1 }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.eseguiBlocchiGara('stagione-2');
    assert.deepEqual(risultato, { elaborazioneId: 'elab-1', numeroAssegnazioni: 3, richiesteNonAssegnate: 1 });
  } finally {
    await chiudi();
  }
});

test('eseguiPrimaAssegnazione: risposta 200 valida mappata in camelCase', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((req, res) => {
    assert.equal(req.url, '/stagioni/stagione-3/prima-assegnazione');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ elaborazione_id: 'elab-2', numero_assegnazioni: 10, round_eseguiti: 4 }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    const risultato = await client.eseguiPrimaAssegnazione('stagione-3');
    assert.deepEqual(risultato, { elaborazioneId: 'elab-2', numeroAssegnazioni: 10, roundEseguiti: 4 });
  } finally {
    await chiudi();
  }
});

test('risposta non-2xx con {errore} produce ErroreMotoreDominio col messaggio del motore', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errore: 'stagione inesistente' }));
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    await assert.rejects(() => client.eseguiIstruttoria('stagione-x'), (err: unknown) => {
      assert.ok(err instanceof ErroreMotoreDominio);
      assert.equal((err as Error).message, 'stagione inesistente');
      return true;
    });
  } finally {
    await chiudi();
  }
});

test('risposta non-2xx senza body JSON valido usa lo status text come messaggio', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((_req, res) => {
    res.writeHead(502);
    res.end('gateway rotto');
  });
  try {
    const client = creaClientMotore(baseUrl, 5000);
    await assert.rejects(() => client.eseguiIstruttoria('stagione-x'), (err: unknown) => {
      assert.ok(err instanceof ErroreMotoreDominio);
      return true;
    });
  } finally {
    await chiudi();
  }
});

test('connessione rifiutata produce ErroreMotoreIrraggiungibile', async () => {
  // Porta chiusa: nessun server in ascolto su questa porta locale.
  const client = creaClientMotore('http://127.0.0.1:1', 2000);
  await assert.rejects(() => client.eseguiIstruttoria('stagione-y'), (err: unknown) => {
    assert.ok(err instanceof ErroreMotoreIrraggiungibile);
    return true;
  });
});

test('timeout allo scadere produce ErroreMotoreIrraggiungibile', async () => {
  const { baseUrl, chiudi } = await avviaServerFittizio((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ domande_calcolate: 1 }));
    }, 500);
  });
  try {
    const client = creaClientMotore(baseUrl, 50);
    await assert.rejects(() => client.eseguiIstruttoria('stagione-z'), (err: unknown) => {
      assert.ok(err instanceof ErroreMotoreIrraggiungibile);
      return true;
    });
  } finally {
    await chiudi();
  }
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Da `backend-node/`:

```
node --test src/engine/client.test.ts
```

Atteso: FAIL, `Cannot find module './client.ts'` (o errore di import equivalente) — il file non esiste ancora.

- [ ] **Step 3: Implementare `src/engine/client.ts`**

```ts
export interface RisultatoIstruttoria {
  domandeCalcolate: number;
}

export interface RisultatoBlocchiGara {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  richiesteNonAssegnate: number;
}

export interface RisultatoPrimaAssegnazione {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  roundEseguiti: number;
}

// Il motore non è raggiungibile: connessione rifiutata, DNS, o il nostro
// timeout (AbortSignal.timeout) è scaduto prima di ricevere una risposta.
// Non sappiamo se il motore ha effettivamente eseguito qualcosa lato suo.
export class ErroreMotoreIrraggiungibile extends Error {}

// Il motore ha risposto ma con uno status non-2xx: httpapi.go restituisce
// sempre {"errore": "..."} per qualunque condizione di errore (dominio o
// interna), nessuna differenziazione di status — vedi engine-go/internal/httpapi.
export class ErroreMotoreDominio extends Error {}

export interface ClientMotore {
  eseguiIstruttoria(stagioneId: string): Promise<RisultatoIstruttoria>;
  eseguiBlocchiGara(stagioneId: string): Promise<RisultatoBlocchiGara>;
  eseguiPrimaAssegnazione(stagioneId: string): Promise<RisultatoPrimaAssegnazione>;
}

async function chiamaMotore(baseUrl: string, timeoutMs: number, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // fetch rigetta per connessione rifiutata, DNS, o abort da timeout: non
    // distinguiamo la causa, sono tutti "il motore non è raggiungibile ora".
    throw new ErroreMotoreIrraggiungibile(`motore non raggiungibile: ${baseUrl}${path}`);
  }

  if (!res.ok) {
    let messaggio = res.statusText || `HTTP ${res.status}`;
    try {
      const corpo = (await res.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text.
    }
    throw new ErroreMotoreDominio(messaggio);
  }

  return res.json();
}

export function creaClientMotore(baseUrl: string, timeoutMs: number): ClientMotore {
  return {
    async eseguiIstruttoria(stagioneId) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, `/stagioni/${stagioneId}/istruttoria`)) as {
        domande_calcolate: number;
      };
      return { domandeCalcolate: body.domande_calcolate };
    },
    async eseguiBlocchiGara(stagioneId) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, `/stagioni/${stagioneId}/blocchi-gara`)) as {
        elaborazione_id: string;
        numero_assegnazioni: number;
        richieste_non_assegnate: number;
      };
      return {
        elaborazioneId: body.elaborazione_id,
        numeroAssegnazioni: body.numero_assegnazioni,
        richiesteNonAssegnate: body.richieste_non_assegnate,
      };
    },
    async eseguiPrimaAssegnazione(stagioneId) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, `/stagioni/${stagioneId}/prima-assegnazione`)) as {
        elaborazione_id: string;
        numero_assegnazioni: number;
        round_eseguiti: number;
      };
      return {
        elaborazioneId: body.elaborazione_id,
        numeroAssegnazioni: body.numero_assegnazioni,
        roundEseguiti: body.round_eseguiti,
      };
    },
  };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

```
node --test src/engine/client.test.ts
```

Atteso: PASS, 7 test.

- [ ] **Step 5: Typecheck**

```
pnpm exec tsc
```

(fallback se il workspace pnpm blocca: `./node_modules/.bin/tsc` da dentro `backend-node/`)

Atteso: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/engine/client.ts backend-node/src/engine/client.test.ts
git commit -m "feat(backend): client HTTP puro verso il motore Go (istruttoria/blocchi-gara/prima-assegnazione)"
```

---

### Task 2: Errore ordine-fasi + iniezione del client motore in `server.ts`

**Files:**
- Modify: `backend-node/src/erroriDominio.ts`
- Modify: `backend-node/src/server.ts` (interfaccia `DipendenzeApp`, funzione `creaApp`)
- Test: `backend-node/src/erroriDominio.test.ts` (nuovo test aggiunto al file esistente se presente, altrimenti verificato solo transitivamente dai test di route del Task 3 — vedi Step 2)

**Interfaces:**
- Consumes: `ClientMotore`, `creaClientMotore` da `./engine/client.ts` (Task 1).
- Produces:
  - `class ErroreOrdineFasiNonRispettato extends Error {}` in `erroriDominio.ts`.
  - `DipendenzeApp.clientMotore?: ClientMotore` — se assente, `creaApp` costruisce il default da `process.env.ENGINE_URL`/`process.env.ENGINE_TIMEOUT_MS`; se `ENGINE_URL` non è impostata, il default è `null` (gestito nel Task 3: le route POST rispondono 500 esplicito).
  - Variabile locale in `creaApp`, nome `clientMotore: ClientMotore | null`, usata dal Task 3.

- [ ] **Step 1: Aggiungere `ErroreOrdineFasiNonRispettato` a `erroriDominio.ts`**

Aggiungi in coda al file (dopo `ErroreStatoNonValidoPerTransizione`):

```ts
// L'ordine delle fasi procedurali (istruttoria prima di blocchi-gara/prima-assegnazione,
// art. B.7 → B.12/B.17) non è imposto dal motore Go (nessuno stato "fase corrente" lì) —
// verificato lato Node prima di innescare la chiamata, guardando se esistono già righe di
// fabbisogni_riconosciuti per la stagione.
export class ErroreOrdineFasiNonRispettato extends Error {}
```

- [ ] **Step 2: Verificare che il file compili (nessun test dedicato per una singola classe Error vuota)**

```
pnpm exec tsc
```

Atteso: nessun errore. (Non c'è comportamento da testare in isolamento su una classe che è solo un marker — la sua semantica è verificata end-to-end nel test di route del Task 3.)

- [ ] **Step 3: Leggere il blocco `DipendenzeApp`/`creaApp` esistente**

Apri `backend-node/src/server.ts`, individua (circa righe 175-193):

```ts
export interface DipendenzeApp {
  inviaEmail?: (email: Email) => Promise<void>;
  backofficeBaseUrl?: string;
}

function inviaEmailDaEnv(): ((email: Email) => Promise<void>) | null {
  const trasporto = creaTrasportoDaEnv();
  if (!trasporto) {
    return null;
  }
  return (email) => inviaEmail(trasporto, email);
}

export function creaApp(pool: Pool, dipendenze: DipendenzeApp = {}): Express {
  const inviaEmailFn = dipendenze.inviaEmail ?? inviaEmailDaEnv();
  const backofficeBaseUrl = dipendenze.backofficeBaseUrl ?? process.env.BACKOFFICE_BASE_URL ?? null;
```

- [ ] **Step 4: Aggiungere l'import e il campo `clientMotore`**

Aggiungi vicino agli altri import in cima a `server.ts`:

```ts
import { creaClientMotore, type ClientMotore } from './engine/client.ts';
```

Modifica `DipendenzeApp`:

```ts
export interface DipendenzeApp {
  inviaEmail?: (email: Email) => Promise<void>;
  backofficeBaseUrl?: string;
  clientMotore?: ClientMotore;
}
```

Aggiungi dopo la riga `const backofficeBaseUrl = ...` dentro `creaApp`:

```ts
  const clientMotore: ClientMotore | null =
    dipendenze.clientMotore ??
    (process.env.ENGINE_URL
      ? creaClientMotore(process.env.ENGINE_URL, Number(process.env.ENGINE_TIMEOUT_MS ?? 300000))
      : null);
```

- [ ] **Step 5: Typecheck**

```
pnpm exec tsc
```

Atteso: nessun errore (`clientMotore` non ancora usato altrove in questo task — nessun errore "unused" perché TS non lo segnala per `const` di livello funzione con `noUnusedLocals` disattivato; se il typecheck segnala variabile inutilizzata, è atteso finché il Task 3 non la consuma — verificare `tsconfig.json` per `noUnusedLocals`/`noUnusedParameters`: se attivi, spostare questo step di dichiarazione della costante `clientMotore` dentro il Task 3 invece che qui, per non lasciare un typecheck rosso a metà blocco).

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/erroriDominio.ts backend-node/src/server.ts
git commit -m "feat(backend): ErroreOrdineFasiNonRispettato + iniezione clientMotore in creaApp"
```

---

### Task 3: Le tre route POST di orchestrazione

**Files:**
- Modify: `backend-node/src/server.ts` (route, dentro `creaApp`, in coda alle route backoffice esistenti — es. subito dopo il blocco `/backoffice/parametrico/...`)
- Test: `backend-node/src/server.motoreGo.test.ts` (nuovo file — creato in questo task, esteso nel Task 4)

**Interfaces:**
- Consumes: `clientMotore: ClientMotore | null` (Task 2), `ErroreMotoreIrraggiungibile`/`ErroreMotoreDominio` (Task 1), `ErroreOrdineFasiNonRispettato` (Task 2), `eseguiInTransazione`, `registraOperazione`, `comeErroreRiferimentoNonValido`, `richiedeAutenticazione`, `richiedeRuolo` — tutti già presenti in `server.ts`.
- Produces: route `POST /backoffice/stagioni/:id/istruttoria`, `POST /backoffice/stagioni/:id/blocchi-gara`, `POST /backoffice/stagioni/:id/prima-assegnazione`. Nessuna nuova interfaccia consumata da task successivi (il Task 4 aggiunge una route indipendente nello stesso file).

- [ ] **Step 1: Scrivere il test end-to-end per le tre route (Postgres reale + `clientMotore` fittizio)**

Crea `backend-node/src/server.motoreGo.test.ts`. Adatta l'header di setup Postgres allo stile già in uso (vedi `server.parametrico.test.ts` per il pattern esatto di connessione/pulizia — stesso `dsn`/skip):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp, type DipendenzeApp } from './server.ts';
import type { ClientMotore } from './engine/client.ts';
import { ErroreMotoreIrraggiungibile, ErroreMotoreDominio } from './engine/client.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

if (!dsn) {
  test('server.motoreGo: skippato senza TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  const pool = new Pool({ connectionString: dsn });

  async function creaStagioneDiTest(): Promise<string> {
    const suffisso = randomUUID().slice(0, 8);
    const r = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine)
       VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione motore ${suffisso}`],
    );
    return r.rows[0]!.id;
  }

  async function creaUtenteBackofficeDiTest(ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
    const suffisso = randomUUID().slice(0, 8);
    const email = `${ruolo}-motore-${suffisso}@test.local`;
    const hash = await hashPassword('password-test-123456');
    const r = await pool.query<{ id: string }>(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, $2, 'Test', 'Motore', $3, 'attivo') RETURNING id`,
      [email, hash, ruolo],
    );
    const id = r.rows[0]!.id;
    return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
  }

  const creaAdminDiTest = () => creaUtenteBackofficeDiTest('admin');
  const creaOperatoreDiTest = () => creaUtenteBackofficeDiTest('operatore');

  // Fixture minima per simulare "istruttoria già eseguita" su una stagione: una domanda
  // 'ammessa' con la sua riga fabbisogni_riconosciuti collegata. Rispetta tutte le colonne
  // NOT NULL reali di domande/fabbisogni_riconosciuti (db/migrations/000001_init.up.sql:267+
  // e :362+) — non è la creaDomanda() di produzione (quella richiede slot/preferenze/ecc.,
  // fuori scope per questo fixture), solo un INSERT diretto minimo e valido.
  async function creaIstruttoriaEseguitaDiTest(stagioneId: string): Promise<void> {
    const suffisso = randomUUID().slice(0, 8);

    const persona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
      [`MTR${suffisso.toUpperCase()}`, randomUUID()],
    );

    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
      [`Associazione motore ${suffisso}`, `PIVA-${suffisso}`],
    );

    const domanda = await pool.query<{ id: string }>(
      `INSERT INTO domande
         (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
          fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
       VALUES ($1, $2, $3, $4, 60, 60, 'ammessa') RETURNING id`,
      [`DOM-TEST-${suffisso}`, associazione.rows[0]!.id, stagioneId, persona.rows[0]!.id],
    );

    const versioneParam = await pool.query<{ id: string }>(
      `SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`,
    );

    await pool.query(
      `INSERT INTO fabbisogni_riconosciuti
         (domanda_id, parametrico_versione_id, peso_base, incremento_squadre, fr_calcolato_minuti, fd_minuti, fr_finale_minuti)
       VALUES ($1, $2, 1, 0, 60, 60, 60)`,
      [domanda.rows[0]!.id, versioneParam.rows[0]!.id],
    );
  }

  function clientMotoreFittizio(overrides: Partial<ClientMotore>): ClientMotore {
    return {
      eseguiIstruttoria: overrides.eseguiIstruttoria ?? (async () => ({ domandeCalcolate: 0 })),
      eseguiBlocchiGara:
        overrides.eseguiBlocchiGara ??
        (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, richiesteNonAssegnate: 0 })),
      eseguiPrimaAssegnazione:
        overrides.eseguiPrimaAssegnazione ??
        (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
    };
  }

  function avviaApp(dipendenze: DipendenzeApp) {
    return creaApp(pool, dipendenze);
  }

  test('POST .../istruttoria: 200 e audit log su successo', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({ eseguiIstruttoria: async () => ({ domandeCalcolate: 3 }) }) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { domandeCalcolate: number };
      assert.equal(body.domandeCalcolate, 3);

      const log = await pool.query(
        `SELECT azione FROM log_operazioni WHERE entita_tipo = 'stagioni_sportive' AND entita_id = $1 AND azione = 'esegui_istruttoria'`,
        [stagioneId],
      );
      assert.equal(log.rows.length, 1);
    } finally {
      server.close();
    }
  });

  test('POST .../istruttoria: 403 per operatore', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaOperatoreDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 403);
    } finally {
      server.close();
    }
  });

  test('POST .../blocchi-gara: 409 se istruttoria non ancora eseguita', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/blocchi-gara`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 409);
    } finally {
      server.close();
    }
  });

  test('POST .../prima-assegnazione: 200 quando istruttoria già eseguita (fabbisogni_riconosciuti presenti)', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    await creaIstruttoriaEseguitaDiTest(stagioneId);

    const app = avviaApp({
      clientMotore: clientMotoreFittizio({
        eseguiPrimaAssegnazione: async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 5, roundEseguiti: 2 }),
      }),
    });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/prima-assegnazione`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { elaborazioneId: string; numeroAssegnazioni: number; roundEseguiti: number };
      assert.equal(body.numeroAssegnazioni, 5);
      assert.equal(body.roundEseguiti, 2);
      assert.equal(typeof body.elaborazioneId, 'string');
    } finally {
      server.close();
    }
  });

  test('POST .../blocchi-gara: 502 se il motore è irraggiungibile', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    await creaIstruttoriaEseguitaDiTest(stagioneId);

    const app = avviaApp({
      clientMotore: clientMotoreFittizio({
        eseguiBlocchiGara: async () => {
          throw new ErroreMotoreIrraggiungibile('simulato');
        },
      }),
    });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/blocchi-gara`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 502);
    } finally {
      server.close();
    }
  });

  test('POST .../istruttoria: 500 con messaggio del motore su ErroreMotoreDominio', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({
      clientMotore: clientMotoreFittizio({
        eseguiIstruttoria: async () => {
          throw new ErroreMotoreDominio('stagione priva di domande ammesse');
        },
      }),
    });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 500);
      const body = (await res.json()) as { errore: string };
      assert.equal(body.errore, 'stagione priva di domande ammesse');
    } finally {
      server.close();
    }
  });

  test('POST .../istruttoria: 400 su stagioneId malformato', async () => {
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/non-un-uuid/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 400);
    } finally {
      server.close();
    }
  });
}
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Da `backend-node/`, con Postgres di test disponibile (vedi CLAUDE.md per `pg-palestre-dev` su porta mappata):

```
TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata>/palestre?sslmode=disable node --test src/server.motoreGo.test.ts
```

Atteso: FAIL — le route non esistono ancora (tutte le richieste tornano 404).

- [ ] **Step 3: Implementare le tre route in `server.ts`**

Aggiungi, dentro `creaApp`, dopo il blocco esistente `/backoffice/parametrico/versioni/:id` (circa riga 1631, subito dopo la sua chiusura `});`):

```ts
  // --- Coda verso il motore Go (art. B.7/B.12/B.17 — orchestrazione, nessuna logica
  // di calcolo qui, solo trasporto + guardrail di concorrenza/ordine fasi) ---

  async function verificaIstruttoriaEseguita(client: PoolClient, stagioneId: string): Promise<boolean> {
    const r = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM fabbisogni_riconosciuti fr
         JOIN domande d ON d.id = fr.domanda_id
         WHERE d.stagione_id = $1
       ) AS exists`,
      [stagioneId],
    );
    return r.rows[0]!.exists;
  }

  function gestisciEsecuzioneMotore(err: unknown, res: Response): void {
    if (err instanceof ErroreOrdineFasiNonRispettato) {
      res.status(409).json({ errore: err.message });
      return;
    }
    if (err instanceof ErroreMotoreIrraggiungibile) {
      res.status(502).json({ errore: 'motore non raggiungibile' });
      return;
    }
    if (err instanceof ErroreMotoreDominio) {
      res.status(500).json({ errore: err.message });
      return;
    }
    const erroreRiferimento = comeErroreRiferimentoNonValido(err);
    if (erroreRiferimento) {
      res.status(400).json({ errore: erroreRiferimento.message });
      return;
    }
    res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
  }

  app.post(
    '/backoffice/stagioni/:id/istruttoria',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!clientMotore) {
        res.status(500).json({ errore: 'motore non configurato' });
        return;
      }
      try {
        const risultato = await eseguiInTransazione(pool, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [stagioneId]);
          const r = await clientMotore.eseguiIstruttoria(stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'esegui_istruttoria',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: r as unknown as Record<string, unknown>,
          });
          return r;
        });
        res.status(200).json(risultato);
      } catch (err) {
        gestisciEsecuzioneMotore(err, res);
      }
    },
  );

  app.post(
    '/backoffice/stagioni/:id/blocchi-gara',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!clientMotore) {
        res.status(500).json({ errore: 'motore non configurato' });
        return;
      }
      try {
        const risultato = await eseguiInTransazione(pool, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [stagioneId]);
          if (!(await verificaIstruttoriaEseguita(client, stagioneId))) {
            throw new ErroreOrdineFasiNonRispettato('istruttoria non ancora eseguita per questa stagione');
          }
          const r = await clientMotore.eseguiBlocchiGara(stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'esegui_blocchi_gara',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: r as unknown as Record<string, unknown>,
          });
          return r;
        });
        res.status(200).json(risultato);
      } catch (err) {
        gestisciEsecuzioneMotore(err, res);
      }
    },
  );

  app.post(
    '/backoffice/stagioni/:id/prima-assegnazione',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!clientMotore) {
        res.status(500).json({ errore: 'motore non configurato' });
        return;
      }
      try {
        const risultato = await eseguiInTransazione(pool, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [stagioneId]);
          if (!(await verificaIstruttoriaEseguita(client, stagioneId))) {
            throw new ErroreOrdineFasiNonRispettato('istruttoria non ancora eseguita per questa stagione');
          }
          const r = await clientMotore.eseguiPrimaAssegnazione(stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'esegui_prima_assegnazione',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: r as unknown as Record<string, unknown>,
          });
          return r;
        });
        res.status(200).json(risultato);
      } catch (err) {
        gestisciEsecuzioneMotore(err, res);
      }
    },
  );
```

Aggiungi gli import mancanti in cima a `server.ts` (accanto agli import esistenti da `./erroriDominio.ts` e `./engine/client.ts`):

```ts
import { /* ...esistenti..., */ ErroreOrdineFasiNonRispettato } from './erroriDominio.ts';
import {
  creaClientMotore,
  type ClientMotore,
  ErroreMotoreIrraggiungibile,
  ErroreMotoreDominio,
} from './engine/client.ts';
```

Verifica che `PoolClient` e `Response` (tipo Express) siano già importati in cima al file — se `Response` non è già importato da `'express'`, aggiungilo: `import type { Response } from 'express';` (o usa il tipo già presente per gli altri handler, se `server.ts` importa `Express` in modo diverso — controlla l'import esistente prima di aggiungerne uno duplicato).

- [ ] **Step 4: Eseguire il test e verificare che passi**

```
TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata>/palestre?sslmode=disable node --test src/server.motoreGo.test.ts
```

Atteso: PASS, 7 test.

- [ ] **Step 5: Eseguire l'intera suite per verificare l'assenza di regressioni**

```
TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata>/palestre?sslmode=disable node --test "src/**/*.test.ts"
```

Atteso: tutti i test preesistenti restano verdi (nessuna regressione), più i 7 nuovi.

- [ ] **Step 6: Typecheck**

```
pnpm exec tsc
```

Atteso: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.motoreGo.test.ts
git commit -m "feat(backend): route POST istruttoria/blocchi-gara/prima-assegnazione con lock per stagione e ordine fasi"
```

---

### Task 4: Storico elaborazioni (GET)

**Files:**
- Modify: `backend-node/src/server.ts` (una route, subito dopo le tre POST del Task 3)
- Modify: `backend-node/src/server.motoreGo.test.ts` (aggiunge test per la GET)

**Interfaces:**
- Consumes: nessuna nuova dipendenza da Task 1-3 oltre a quelle già importate.
- Produces: route `GET /backoffice/stagioni/:id/elaborazioni`. Ultimo task del blocco.

- [ ] **Step 1: Aggiungere i test per la GET a `server.motoreGo.test.ts`**

Aggiungi dentro il blocco `if (!dsn) { ... } else { ... }` esistente, dopo l'ultimo test del Task 3:

```ts
  test('GET .../elaborazioni: lista vuota per una stagione senza elaborazioni', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/elaborazioni`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as unknown[];
      assert.deepEqual(body, []);
    } finally {
      server.close();
    }
  });

  test('GET .../elaborazioni: righe ordinate per data decrescente, accessibile a operatore', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token: tokenAdmin } = await creaAdminDiTest();
    const { token: tokenOperatore } = await creaOperatoreDiTest();

    const versioneParam = await pool.query<{ id: string }>(
      `SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`,
    );
    const parametricoVersioneId = versioneParam.rows[0]!.id;

    await pool.query(
      `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato, numero_round_eseguiti)
       VALUES ($1, 'prima_assegnazione', $2, 'completata', 3)`,
      [stagioneId, parametricoVersioneId],
    );
    await pool.query(
      `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato)
       VALUES ($1, 'blocchi_gara', $2, 'completata')`,
      [stagioneId, parametricoVersioneId],
    );

    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/elaborazioni`, {
        headers: { authorization: `Bearer ${tokenOperatore}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as Array<{ tipo: string }>;
      assert.equal(body.length, 2);
      // creata_il DESC: l'ultima INSERT (blocchi_gara) viene prima.
      assert.equal(body[0]!.tipo, 'blocchi_gara');
      assert.equal(body[1]!.tipo, 'prima_assegnazione');

      const resAdmin = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/elaborazioni`, {
        headers: { authorization: `Bearer ${tokenAdmin}` },
      });
      assert.equal(resAdmin.status, 200);
    } finally {
      server.close();
    }
  });

  test('GET .../elaborazioni: 400 su stagioneId malformato', async () => {
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/non-un-uuid/elaborazioni`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 400);
    } finally {
      server.close();
    }
  });
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

```
TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata>/palestre?sslmode=disable node --test src/server.motoreGo.test.ts
```

Atteso: FAIL sui 3 nuovi test (404, la route non esiste).

- [ ] **Step 3: Implementare la route GET in `server.ts`**

Aggiungi subito dopo la route `POST /backoffice/stagioni/:id/prima-assegnazione` (fine del blocco del Task 3):

```ts
  app.get(
    '/backoffice/stagioni/:id/elaborazioni',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const r = await pool.query(
          `SELECT id, stagione_id, tipo, parametrico_versione_id, iniziata_il, conclusa_il,
                  stato, numero_round_eseguiti, log_dettaglio
           FROM elaborazioni
           WHERE stagione_id = $1
           ORDER BY iniziata_il DESC`,
          [stagioneId],
        );
        res.status(200).json(
          r.rows.map((row) => ({
            id: row.id,
            stagioneId: row.stagione_id,
            tipo: row.tipo,
            parametricoVersioneId: row.parametrico_versione_id,
            iniziataIl: (row.iniziata_il as Date).toISOString(),
            conclusaIl: row.conclusa_il ? (row.conclusa_il as Date).toISOString() : null,
            stato: row.stato,
            numeroRoundEseguiti: row.numero_round_eseguiti,
            logDettaglio: row.log_dettaglio,
          })),
        );
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

Nota: l'`ORDER BY` usa `iniziata_il` (non `creata_il` — la tabella `elaborazioni` non ha una colonna `creata_il`, vedi schema in `db/migrations/000001_init.up.sql:391-401`; il commento nel test sopra "creata_il DESC" si riferisce all'ordine di inserimento, che qui coincide con `iniziata_il DESC` perché `iniziata_il` ha `DEFAULT now()` e le due INSERT nel test avvengono in sequenza).

- [ ] **Step 4: Eseguire il test e verificare che passi**

```
TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata>/palestre?sslmode=disable node --test src/server.motoreGo.test.ts
```

Atteso: PASS, 10 test totali nel file (7 dal Task 3 + 3 di questo task).

- [ ] **Step 5: Eseguire l'intera suite**

```
TEST_DATABASE_URL=postgres://postgres:test@localhost:<porta-mappata>/palestre?sslmode=disable node --test "src/**/*.test.ts"
```

Atteso: tutti verdi, nessuna regressione.

- [ ] **Step 6: Typecheck**

```
pnpm exec tsc
```

Atteso: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/server.ts backend-node/src/server.motoreGo.test.ts
git commit -m "feat(backend): GET storico elaborazioni per stagione"
```

---

## Note per chi esegue il piano

- `ENGINE_URL`/`ENGINE_TIMEOUT_MS` non servono per eseguire i test di questo piano: tutti i test iniettano `clientMotore` via `DipendenzeApp`, mai il default costruito da env. Un vero smoke test contro il binario Go reale (`go run ./cmd/service`) resta un passo manuale separato, fuori da questo piano — stesso pattern già documentato in CLAUDE.md per `cmd/service`.
- Se `tsconfig.json` ha `noUnusedLocals`/`noUnusedParameters` attivi, il Task 2 può lasciare `clientMotore` temporaneamente "non usato" tra il commit del Task 2 e l'inizio del Task 3: verificare col typecheck reale (Step 5 del Task 2) e, se necessario, spostare la dichiarazione della costante dentro il Task 3 come indicato nella nota di quello step.
- Il campo `numero_round_eseguiti` in `elaborazioni` è popolato solo per `prima_assegnazione` (non per `blocchi_gara`) — il motore Go lo scrive così, non è un bug di questo blocco: la GET lo espone `null` per le righe `blocchi_gara`, comportamento corretto da non "correggere".
