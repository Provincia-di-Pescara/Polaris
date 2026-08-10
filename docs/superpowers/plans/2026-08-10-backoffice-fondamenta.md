# Backoffice — fondamenta (auth reale + API client + routing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire l'auth finta e l'assenza di routing nel frontend backoffice (`frontend-backoffice/`) con login reale contro il backend Node, gestione token (access+refresh), routing con `react-router`, e guardia per ruolo — senza toccare le viste funzionali esistenti (restano su `mockData.ts`, blocchi futuri le collegheranno una alla volta).

**Architettura:** Un client HTTP unico (`src/api/client.ts`) con refresh automatico su 401, un contesto React di autenticazione (`src/auth/AuthContext.tsx`) che lo usa, un router (`react-router`) con una rotta protetta per vista esistente, e una nuova `LoginView`. `Sidebar`/`Header` passano da props locali (`role`/`setRole` finti) a leggere l'utente reale dal contesto.

**Tech Stack:** React 19, TypeScript 7.0.2 (bump da questo piano), Vite 6, `react-router` 7, Vitest + Testing Library, `pg` (solo nei test, per seedare utenti reali).

## Global Constraints

- Token in `localStorage` (`polaris_access_token`, `polaris_refresh_token`) — mai cookie, mai solo-memoria.
- `react-router` con `createBrowserRouter`/`RouterProvider`. Rotte esistenti invariate negli id (`control-room`, `impianti-spazi`, `deleghe-accreditamenti`, `parametri-sistema`, `audit-sorteggio`, `statistiche`), solo il meccanismo di navigazione cambia da stato a URL.
- Nessuna vista funzionale (`ControlRoomView`, `ImpiantiSpaziView`, ecc.) viene modificata in questo piano — restano su `mockData.ts`.
- Stile visivo: riusare i CSS custom properties già in `src/index.css` (`--pa-blue-primary`, `--pa-blue-dark`, `--pa-danger`, `--pa-danger-bg`, ecc.) e le classi `.btn`, `.btn-primary`, `.form-control` già definite — nessun nuovo sistema di stile, non serve replica esatta di componenti che non esistono (es. `LoginView` è nuovo).
- Test: mai mock di `fetch`. Per il client HTTP e l'auth, un'istanza reale del backend (`node src/index.ts`, spawnata come processo figlio) contro Postgres reale (`TEST_DATABASE_URL`, skip pulito se assente — stesso pattern del backend).
- `GET /auth/me` ritorna esattamente `{sub, email, ruolo}` (il payload JWT decodificato) — **non** nome/cognome. L'identità mostrata in UI è quindi `email` + `ruolo`, non un nome proprio (deviazione consapevole dallo scaffold visivo originale, che mostrava un nome finto "Mario Rossi": il backend reale non fornisce questo dato).

---

## File Structure

- **Modify** `frontend-backoffice/package.json` — bump `typescript`, aggiunge `react-router`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `pg`, `@types/pg`.
- **Modify** `frontend-backoffice/vite.config.ts` — proxy dev + config vitest.
- **Create** `frontend-backoffice/src/testUtil/backendReale.ts` — helper per avviare il backend reale nei test.
- **Create** `frontend-backoffice/src/testUtil/creaUtenteTest.ts` — helper per seedare un utente backoffice reale su Postgres.
- **Create** `frontend-backoffice/src/api/client.ts` + **Create** `frontend-backoffice/src/api/client.test.ts`.
- **Create** `frontend-backoffice/src/auth/AuthContext.tsx` + **Create** `frontend-backoffice/src/auth/AuthContext.test.tsx`.
- **Create** `frontend-backoffice/src/auth/ProtectedRoute.tsx`.
- **Create** `frontend-backoffice/src/components/BackofficeLayout.tsx` (Sidebar+Header+Outlet, estratto da `App.tsx`).
- **Create** `frontend-backoffice/src/components/LoginView.tsx` + **Create** `frontend-backoffice/src/components/LoginView.test.tsx`.
- **Modify** `frontend-backoffice/src/components/Sidebar.tsx` — rimuove prop `role`, legge da `useAuth()`, aggiunge bottone logout.
- **Modify** `frontend-backoffice/src/components/Header.tsx` — rimuove prop `role`/`setRole`, legge da `useAuth()`.
- **Modify** `frontend-backoffice/src/App.tsx` — riscritto come router config.

---

### Task 1: Bump TypeScript a 7.0.2 esatto

**Files:**
- Modify: `frontend-backoffice/package.json`

**Interfaces:**
- Nessuna — task di configurazione puro, nessuna interfaccia prodotta/consumata da altri task.

- [ ] **Step 1: Aggiorna la dipendenza**

In `frontend-backoffice/package.json`, cambia la riga `"typescript": "^5.7.2"` in `devDependencies` con:

```json
    "typescript": "7.0.2",
```

(versione esatta, senza `^`, stesso stile già usato in `backend-node/package.json` per la stessa dipendenza).

- [ ] **Step 2: Installa**

Da `frontend-backoffice/`:

```bash
pnpm install
```

- [ ] **Step 3: Verifica il typecheck reale PRIMA di procedere**

```bash
pnpm exec tsc --noEmit
```

Expected: nessun errore. Se il bump introduce errori di tipo sullo scaffold esistente (possibile con un salto di 2 major version), risolvili qui — non lasciarli per i task successivi, che assumono un typecheck pulito come baseline.

- [ ] **Step 4: Commit**

```bash
git add frontend-backoffice/package.json frontend-backoffice/pnpm-lock.yaml pnpm-lock.yaml
git commit -m "chore(frontend-backoffice): bump typescript a 7.0.2 esatto"
```

(Nota: come nel backend, `pnpm install` lanciato dentro un pacchetto del workspace aggiorna sia il lockfile di workspace alla radice sia — se presente — un eventuale lockfile standalone del pacchetto. `frontend-backoffice` non ha oggi un lockfile standalone separato come `backend-node/pnpm-lock.yaml`: verifica con `git status` cosa è stato effettivamente modificato e includi solo quei file.)

---

### Task 2: Setup Vitest + Testing Library + proxy Vite

**Files:**
- Modify: `frontend-backoffice/package.json`
- Modify: `frontend-backoffice/vite.config.ts`
- Create: `frontend-backoffice/src/testUtil/setup.ts`

**Interfaces:**
- Produces: comando `pnpm test` (Vitest) funzionante; proxy Vite per `/auth` e `/backoffice` verso `http://localhost:3000`; `pg` disponibile come dipendenza per i task successivi (seed fixture nei test).

- [ ] **Step 1: Installa le dipendenze di test**

Da `frontend-backoffice/`:

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom pg @types/pg
pnpm add react-router
```

- [ ] **Step 2: Aggiungi gli script in `package.json`**

Nella sezione `scripts`, aggiungi:

```json
    "test": "vitest run",
```

(accanto a `dev`/`build`/`preview`/`typecheck` già presenti).

- [ ] **Step 3: Riscrivi `vite.config.ts`**

Sostituisci il contenuto di `frontend-backoffice/vite.config.ts` con:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/backoffice': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testUtil/setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 4: Crea il setup file dei test**

Crea `frontend-backoffice/src/testUtil/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Verifica che Vitest parta (nessun test ancora scritto)**

```bash
pnpm test
```

Expected: Vitest si avvia e riporta "No test files found" (o equivalente) — nessun errore di configurazione. Questo è l'unico modo per verificare la config in questo task, dato che non c'è ancora nessun test da eseguire.

- [ ] **Step 6: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add frontend-backoffice/package.json frontend-backoffice/pnpm-lock.yaml pnpm-lock.yaml frontend-backoffice/vite.config.ts frontend-backoffice/src/testUtil/setup.ts
git commit -m "chore(frontend-backoffice): setup vitest, testing-library, proxy vite verso il backend"
```

---

### Task 3: Client HTTP (`src/api/client.ts`)

**Files:**
- Create: `frontend-backoffice/src/testUtil/backendReale.ts`
- Create: `frontend-backoffice/src/testUtil/creaUtenteTest.ts`
- Create: `frontend-backoffice/src/api/client.ts`
- Create: `frontend-backoffice/src/api/client.test.ts`

**Interfaces:**
- Consumes: nessuna da task precedenti (solo config di Task 1-2).
- Produces:
  - `export interface BackendReale { baseUrl: string; chiudi(): Promise<void> }` e `export async function avviaBackendReale(): Promise<BackendReale>` — usati da Task 3 e Task 4.
  - `export interface UtenteTest { email: string; password: string }` e `export async function creaUtenteTest(dsn: string, ruolo: 'admin' | 'operatore'): Promise<UtenteTest>` — usati da Task 3 e Task 4.
  - `export class ErroreSessioneScaduta extends Error {}` — errore lanciato quando anche il refresh fallisce; consumato da `AuthContext` (Task 4) per fare logout locale.
  - `export function impostaTokens(accessToken: string, refreshToken: string): void`
  - `export function rimuoviTokens(): void`
  - `export async function apiFetch(path: string, init?: RequestInit): Promise<Response>`

- [ ] **Step 1: Crea l'helper per avviare il backend reale nei test**

Crea `frontend-backoffice/src/testUtil/backendReale.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend-backoffice/src/testUtil/ -> ../../../backend-node (radice del monorepo, poi dentro backend-node)
const BACKEND_DIR = path.resolve(__dirname, '../../../backend-node');

export interface BackendReale {
  baseUrl: string;
  chiudi: () => Promise<void>;
}

export async function avviaBackendReale(): Promise<BackendReale> {
  const dsn = process.env.TEST_DATABASE_URL;
  if (!dsn) {
    throw new Error('TEST_DATABASE_URL non impostata');
  }
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const baseUrl = `http://127.0.0.1:${porta}`;

  const child: ChildProcess = spawn('node', ['src/index.ts'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: dsn,
      PORT: String(porta),
      JWT_SECRET: process.env.JWT_SECRET ?? 'segreto-di-test-non-usare-in-produzione',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('backend reale non avviato entro 15s'));
    }, 15000);

    child.once('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    const provaConnessione = async (): Promise<void> => {
      try {
        const r = await fetch(`${baseUrl}/healthz`);
        if (r.ok) {
          clearTimeout(timeoutId);
          resolve();
          return;
        }
      } catch {
        // backend non ancora in ascolto, riprova
      }
      setTimeout(() => {
        provaConnessione();
      }, 200);
    };
    provaConnessione();
  });

  return {
    baseUrl,
    chiudi: () =>
      new Promise<void>((resolve) => {
        const forzaChiusura = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(forzaChiusura);
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
}
```

- [ ] **Step 2: Crea l'helper per seedare un utente backoffice reale**

Crea `frontend-backoffice/src/testUtil/creaUtenteTest.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from '../../../backend-node/src/auth/password.ts';

export interface UtenteTest {
  email: string;
  password: string;
}

const PASSWORD_TEST = 'password-test-123456';

export async function creaUtenteTest(dsn: string, ruolo: 'admin' | 'operatore'): Promise<UtenteTest> {
  const pool = new Pool({ connectionString: dsn });
  try {
    const email = `frontend-test-${randomUUID()}@test.local`;
    const hash = await hashPassword(PASSWORD_TEST);
    await pool.query(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, $2, 'Frontend', 'Test', $3, 'attivo')`,
      [email, hash, ruolo],
    );
    return { email, password: PASSWORD_TEST };
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 3: Scrivi il test del client (verrà FAIL finché `client.ts` non esiste)**

Crea `frontend-backoffice/src/api/client.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest } from '../testUtil/creaUtenteTest.ts';
import { apiFetch, impostaTokens, rimuoviTokens, ErroreSessioneScaduta } from './client.ts';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('apiFetch', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override in test, api/client.ts legge da import.meta.env in produzione
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
  });

  beforeEach(() => {
    rimuoviTokens();
    localStorage.clear();
  });

  it('allega Authorization: Bearer quando un access token è presente', async () => {
    const utente = await creaUtenteTest(dsn!, 'admin');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utente.email, password: utente.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    impostaTokens(accessToken, refreshToken);

    const r = await apiFetch('/auth/me');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.email).toBe(utente.email);
  });

  it('senza token, la richiesta parte comunque senza header Authorization (risposta 401 dal backend)', async () => {
    const r = await apiFetch('/auth/me');
    expect(r.status).toBe(401);
  });

  it('su 401 con refresh token valido, rinnova e ripete la richiesta con successo', async () => {
    const utente = await creaUtenteTest(dsn!, 'admin');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utente.email, password: utente.password }),
    });
    const { refreshToken } = await loginRes.json();
    // Access token deliberatamente invalido/scaduto: forza il ramo di refresh.
    impostaTokens('token-invalido', refreshToken);

    const r = await apiFetch('/auth/me');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.email).toBe(utente.email);
  });

  it('su 401 con refresh token invalido, lancia ErroreSessioneScaduta e ripulisce i token', async () => {
    impostaTokens('token-invalido', 'refresh-invalido');

    await expect(apiFetch('/auth/me')).rejects.toThrow(ErroreSessioneScaduta);
    expect(localStorage.getItem('polaris_access_token')).toBeNull();
    expect(localStorage.getItem('polaris_refresh_token')).toBeNull();
  });
});
```

- [ ] **Step 4: Esegui il test e verifica che fallisca**

Da `frontend-backoffice/`, con Postgres di test disponibile (vedi CLAUDE.md per `pg-palestre-dev` su porta mappata):

```bash
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" pnpm test src/api/client.test.ts
```

Expected: FAIL — `client.ts` non esiste ancora.

- [ ] **Step 5: Implementa `src/api/client.ts`**

```ts
const CHIAVE_ACCESS = 'polaris_access_token';
const CHIAVE_REFRESH = 'polaris_refresh_token';

// In produzione il proxy Vite (dev) o il reverse proxy (prod) fanno sì che le
// chiamate relative raggiungano il backend sulla stessa origin — nessuna base URL
// assoluta necessaria. Nei test (backend reale su porta random, nessun proxy Vite
// in gioco) il test inietta l'URL assoluto tramite questa variabile globale.
function baseUrl(): string {
  const override = (globalThis as { __API_BASE_URL__?: string }).__API_BASE_URL__;
  return override ?? '';
}

// Lanciato quando anche il refresh fallisce: la sessione è persa, il chiamante
// (AuthContext) deve trattarla come un logout locale e reindirizzare al login.
export class ErroreSessioneScaduta extends Error {}

export function impostaTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(CHIAVE_ACCESS, accessToken);
  localStorage.setItem(CHIAVE_REFRESH, refreshToken);
}

export function rimuoviTokens(): void {
  localStorage.removeItem(CHIAVE_ACCESS);
  localStorage.removeItem(CHIAVE_REFRESH);
}

function leggiAccessToken(): string | null {
  return localStorage.getItem(CHIAVE_ACCESS);
}

function leggiRefreshToken(): string | null {
  return localStorage.getItem(CHIAVE_REFRESH);
}

async function fetchConToken(path: string, init: RequestInit, accessToken: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return fetch(`${baseUrl()}${path}`, { ...init, headers });
}

async function provaRefresh(refreshToken: string): Promise<string> {
  const r = await fetch(`${baseUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!r.ok) {
    rimuoviTokens();
    throw new ErroreSessioneScaduta('refresh fallito');
  }

  const { accessToken, refreshToken: nuovoRefreshToken } = await r.json();
  impostaTokens(accessToken, nuovoRefreshToken);
  return accessToken;
}

// Wrapper unico su fetch per tutte le chiamate autenticate al backend. Allega il
// Bearer token se presente; su 401 tenta UN SOLO refresh (solo se esiste un refresh
// token in storage) e ripete la richiesta originale una volta. Se non esiste alcun
// refresh token, il 401 originale viene propagato invariato (nessuna sessione da
// rinnovare — non è un errore di sessione scaduta, è semplicemente "non autenticato").
// Se un refresh viene tentato e fallisce, propaga ErroreSessioneScaduta (il
// chiamante — AuthContext — decide cosa fare, es. redirect a /login).
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const primaRisposta = await fetchConToken(path, init, leggiAccessToken());
  if (primaRisposta.status !== 401) {
    return primaRisposta;
  }

  const refreshToken = leggiRefreshToken();
  if (!refreshToken) {
    return primaRisposta;
  }

  const nuovoAccessToken = await provaRefresh(refreshToken);
  return fetchConToken(path, init, nuovoAccessToken);
}
```

- [ ] **Step 6: Esegui il test e verifica che passi**

```bash
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" pnpm test src/api/client.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 7: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: nessun errore.

- [ ] **Step 8: Commit**

```bash
git add frontend-backoffice/src/testUtil/backendReale.ts frontend-backoffice/src/testUtil/creaUtenteTest.ts frontend-backoffice/src/api/client.ts frontend-backoffice/src/api/client.test.ts
git commit -m "feat(frontend-backoffice): client HTTP con refresh automatico su 401 (mai mock, backend reale nei test)"
```

---

### Task 4: Contesto di autenticazione (`src/auth/AuthContext.tsx`)

**Files:**
- Create: `frontend-backoffice/src/auth/AuthContext.tsx`
- Create: `frontend-backoffice/src/auth/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `impostaTokens`, `rimuoviTokens`, `ErroreSessioneScaduta` da `../api/client.ts` (Task 3); `avviaBackendReale`/`BackendReale` da `../testUtil/backendReale.ts` (Task 3); `creaUtenteTest` da `../testUtil/creaUtenteTest.ts` (Task 3).
- Produces:
  - `export interface Utente { sub: string; email: string; ruolo: 'admin' | 'operatore' }`
  - `export function AuthProvider(props: { children: React.ReactNode }): React.ReactElement`
  - `export function useAuth(): { utente: Utente | null; caricamento: boolean; login(email: string, password: string): Promise<void>; logout(): Promise<void> }`
  - Consumato da Task 5 (`ProtectedRoute`), Task 6 (`LoginView`), Task 7 (`Sidebar`/`Header`).

- [ ] **Step 1: Scrivi il test**

Crea `frontend-backoffice/src/auth/AuthContext.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { avviaBackendReale, type BackendReale } from '../testUtil/backendReale.ts';
import { creaUtenteTest } from '../testUtil/creaUtenteTest.ts';
import { rimuoviTokens } from '../api/client.ts';
import { AuthProvider, useAuth } from './AuthContext.tsx';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

function ComponenteDiTest() {
  const { utente, caricamento, login, logout } = useAuth();
  if (caricamento) return <div>caricamento...</div>;
  if (!utente) {
    return (
      <button
        onClick={() => {
          login('placeholder@test.local', 'placeholder').catch(() => {});
        }}
      >
        login-fallisce
      </button>
    );
  }
  return (
    <div>
      <span data-testid="email">{utente.email}</span>
      <span data-testid="ruolo">{utente.ruolo}</span>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

descrivi('AuthContext', () => {
  let backend: BackendReale;

  beforeAll(async () => {
    backend = await avviaBackendReale();
    // @ts-expect-error -- override di test, vedi api/client.ts
    globalThis.__API_BASE_URL__ = backend.baseUrl;
  }, 20000);

  afterAll(async () => {
    await backend.chiudi();
  });

  beforeEach(() => {
    rimuoviTokens();
    localStorage.clear();
  });

  it('login riuscito popola utente con email e ruolo reali', async () => {
    const utenteTest = await creaUtenteTest(dsn!, 'operatore');

    function ComponenteLogin() {
      const { utente, caricamento, login } = useAuth();
      if (caricamento) return <div>caricamento...</div>;
      if (!utente) {
        return (
          <button onClick={() => login(utenteTest.email, utenteTest.password)}>entra</button>
        );
      }
      return (
        <div>
          <span data-testid="email">{utente.email}</span>
          <span data-testid="ruolo">{utente.ruolo}</span>
        </div>
      );
    }

    render(
      <AuthProvider>
        <ComponenteLogin />
      </AuthProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'entra' }));

    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent(utenteTest.email));
    expect(screen.getByTestId('ruolo')).toHaveTextContent('operatore');
  });

  it('login con credenziali sbagliate non popola utente (rimane null)', async () => {
    render(
      <AuthProvider>
        <ComponenteDiTest />
      </AuthProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'login-fallisce' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'login-fallisce' })).toBeInTheDocument();
    });
  });

  it('logout ripulisce utente e i token', async () => {
    const utenteTest = await creaUtenteTest(dsn!, 'admin');

    function ComponenteConLogout() {
      const { utente, caricamento, login, logout } = useAuth();
      if (caricamento) return <div>caricamento...</div>;
      if (!utente) {
        return <button onClick={() => login(utenteTest.email, utenteTest.password)}>entra</button>;
      }
      return <button onClick={() => logout()}>esci</button>;
    }

    render(
      <AuthProvider>
        <ComponenteConLogout />
      </AuthProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'entra' }));
    await screen.findByRole('button', { name: 'esci' });

    await userEvent.click(screen.getByRole('button', { name: 'esci' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'entra' })).toBeInTheDocument());
    expect(localStorage.getItem('polaris_access_token')).toBeNull();
  });

  it('bootstrap: con un access token già valido in storage, popola utente senza un login esplicito', async () => {
    const utenteTest = await creaUtenteTest(dsn!, 'admin');
    const loginRes = await fetch(`${backend.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: utenteTest.email, password: utenteTest.password }),
    });
    const { accessToken, refreshToken } = await loginRes.json();
    localStorage.setItem('polaris_access_token', accessToken);
    localStorage.setItem('polaris_refresh_token', refreshToken);

    render(
      <AuthProvider>
        <ComponenteDiTest />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent(utenteTest.email));
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" pnpm test src/auth/AuthContext.test.tsx
```

Expected: FAIL — `AuthContext.tsx` non esiste.

- [ ] **Step 3: Implementa `src/auth/AuthContext.tsx`**

```tsx
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, impostaTokens, rimuoviTokens, ErroreSessioneScaduta } from '../api/client.ts';

export interface Utente {
  sub: string;
  email: string;
  ruolo: 'admin' | 'operatore';
}

interface AuthContextValue {
  utente: Utente | null;
  caricamento: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function chiediUtenteCorrente(): Promise<Utente | null> {
  try {
    const r = await apiFetch('/auth/me');
    if (!r.ok) {
      return null;
    }
    return (await r.json()) as Utente;
  } catch (err) {
    if (err instanceof ErroreSessioneScaduta) {
      return null;
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [utente, setUtente] = useState<Utente | null>(null);
  const [caricamento, setCaricamento] = useState(true);

  useEffect(() => {
    let annullato = false;
    chiediUtenteCorrente()
      .then((u) => {
        if (!annullato) {
          setUtente(u);
        }
      })
      .finally(() => {
        if (!annullato) {
          setCaricamento(false);
        }
      });
    return () => {
      annullato = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const r = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      throw new Error('credenziali non valide');
    }
    const { accessToken, refreshToken } = await r.json();
    impostaTokens(accessToken, refreshToken);
    const u = await chiediUtenteCorrente();
    setUtente(u);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = localStorage.getItem('polaris_refresh_token');
    if (refreshToken) {
      try {
        await fetch('/auth/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // il logout locale deve riuscire comunque, anche se la revoca server-side fallisce
      }
    }
    rimuoviTokens();
    setUtente(null);
  }, []);

  return (
    <AuthContext.Provider value={{ utente, caricamento, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth deve essere usato dentro <AuthProvider>');
  }
  return ctx;
}
```

Nota: `login`/`logout` chiamano `fetch('/auth/login', ...)`/`fetch('/auth/logout', ...)` direttamente (path relativo, non `apiFetch`) perché non richiedono un Bearer token esistente — sono l'unico punto che stabilisce/distrugge la sessione. Nei test, il path relativo `/auth/login` funziona perché il test chiama comunque l'endpoint assoluto per ottenere i token iniziali (vedi `AuthContext.test.tsx`, che usa `fetch(`${backend.baseUrl}/auth/login`, ...)` per il bootstrap, e passa da `login()` reale — path relativo `/auth/login` — solo nei casi dove Vitest/jsdom risolve correttamente verso `globalThis.__API_BASE_URL__` tramite lo stesso meccanismo di `apiFetch`... **attenzione implementer**: se `fetch('/auth/login', ...)` nei test fallisce perché jsdom non sa risolvere un path relativo senza una base URL di documento, sostituisci queste due chiamate dirette con lo stesso helper `baseUrl()` usato in `client.ts` — che però non è esportato. In quel caso, esporta anche `baseUrl` da `client.ts` (aggiungi `export` davanti alla funzione) e usala qui al posto del path relativo nudo: `fetch(`${baseUrl()}/auth/login`, ...)`. Verifica quale dei due approcci serve eseguendo il test reale, non assumerlo a priori.

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" pnpm test src/auth/AuthContext.test.tsx
```

Expected: PASS, 4/4. Se fallisce per il motivo descritto nella nota dello Step 3, applica il fix lì indicato e ripeti.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add frontend-backoffice/src/auth/AuthContext.tsx frontend-backoffice/src/auth/AuthContext.test.tsx frontend-backoffice/src/api/client.ts
git commit -m "feat(frontend-backoffice): AuthContext con login/logout/bootstrap contro il backend reale"
```

---

### Task 5: Routing e guardia per ruolo

**Files:**
- Create: `frontend-backoffice/src/auth/ProtectedRoute.tsx`
- Create: `frontend-backoffice/src/components/BackofficeLayout.tsx`
- Modify: `frontend-backoffice/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth`, `AuthProvider` da `../auth/AuthContext.tsx` (Task 4).
- Produces: struttura di routing completa. `BackofficeLayout` consumato/modificato ulteriormente da Task 7 (Sidebar/Header al suo interno).

- [ ] **Step 1: Crea `src/auth/ProtectedRoute.tsx`**

```tsx
import React from 'react';
import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthContext.tsx';

export function ProtectedRoute(): React.ReactElement {
  const { utente, caricamento } = useAuth();

  if (caricamento) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--pa-text-muted)' }}>
        Caricamento...
      </div>
    );
  }

  if (!utente) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
```

- [ ] **Step 2: Crea `src/components/BackofficeLayout.tsx`**

Estrae la struttura Sidebar+Header+contenuto già presente in `App.tsx`, sostituendo lo switch su `currentTab` con `<Outlet/>` di `react-router` (ogni vista diventa una rotta figlia):

```tsx
import React, { useState } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { mockSeasons } from '../mockData.ts';

export function BackofficeLayout(): React.ReactElement {
  const [seasons] = useState(mockSeasons);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(mockSeasons[0].id);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--pa-bg-gray)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header seasons={seasons} selectedSeasonId={selectedSeasonId} setSelectedSeasonId={setSelectedSeasonId} />
        <main style={{ flex: 1, padding: '1.75rem', overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

Nota: `Sidebar` non prende più `currentTab`/`setCurrentTab`/`role` come props (Task 7 li rimuove, sostituendoli con `useAuth()` internamente e la posizione URL corrente via `react-router`) — questo file compila solo DOPO Task 7. Se esegui i task in ordine, questo è normale: il typecheck di questo Step passerà a fine Task 7, non qui. Non bloccarti su un errore di tipo su `<Sidebar/>`/`<Header/>` a questo punto — verificalo di nuovo alla fine di Task 7.

- [ ] **Step 3: Riscrivi `src/App.tsx`**

```tsx
import React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AuthProvider } from './auth/AuthContext.tsx';
import { ProtectedRoute } from './auth/ProtectedRoute.tsx';
import { BackofficeLayout } from './components/BackofficeLayout.tsx';
import { LoginView } from './components/LoginView.tsx';
import { ControlRoomView } from './components/ControlRoomView.tsx';
import { ImpiantiSpaziView } from './components/ImpiantiSpaziView.tsx';
import { DelegheAccreditamentiView } from './components/DelegheAccreditamentiView.tsx';
import { ParametriSistemaView } from './components/ParametriSistemaView.tsx';
import { AuditSorteggioView } from './components/AuditSorteggioView.tsx';
import { StatisticheView } from './components/StatisticheView.tsx';

const router = createBrowserRouter([
  { path: '/login', element: <LoginView /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <BackofficeLayout />,
        children: [
          { index: true, element: <ControlRoomView /> },
          { path: 'control-room', element: <ControlRoomView /> },
          { path: 'impianti-spazi', element: <ImpiantiSpaziView /> },
          { path: 'deleghe-accreditamenti', element: <DelegheAccreditamentiView /> },
          { path: 'parametri-sistema', element: <ParametriSistemaView /> },
          { path: 'audit-sorteggio', element: <AuditSorteggioView /> },
          { path: 'statistiche', element: <StatisticheView /> },
        ],
      },
    ],
  },
]);

export const App: React.FC = () => (
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
);
```

Nota: `LoginView` (Task 6) non esiste ancora a questo punto — l'errore di import è atteso, si risolve a fine Task 6.

- [ ] **Step 4: Commit (typecheck rimandato a fine Task 7)**

Questo task da solo NON ha typecheck pulito (dipende da `LoginView` di Task 6 e dalle modifiche a `Sidebar`/`Header` di Task 7). Committa comunque, il piano è sequenziale:

```bash
git add frontend-backoffice/src/auth/ProtectedRoute.tsx frontend-backoffice/src/components/BackofficeLayout.tsx frontend-backoffice/src/App.tsx
git commit -m "feat(frontend-backoffice): routing con react-router + guardia per autenticazione (typecheck completo a fine Task 7)"
```

---

### Task 6: Schermata di login (`src/components/LoginView.tsx`)

**Files:**
- Create: `frontend-backoffice/src/components/LoginView.tsx`
- Create: `frontend-backoffice/src/components/LoginView.test.tsx`

**Interfaces:**
- Consumes: `useAuth` da `../auth/AuthContext.tsx` (Task 4).
- Produces: `export function LoginView(): React.ReactElement` — consumato da `App.tsx` (Task 5, già scritto — questo task lo sblocca).

- [ ] **Step 1: Scrivi il test (component test, nessun backend reale necessario — mocka solo `AuthContext`)**

Crea `frontend-backoffice/src/components/LoginView.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as AuthContextModule from '../auth/AuthContext.tsx';
import { LoginView } from './LoginView.tsx';

describe('LoginView', () => {
  it('submit con credenziali valide chiama login con email e password inserite', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      utente: null,
      caricamento: false,
      login: loginMock,
      logout: vi.fn(),
    });

    render(<LoginView />);

    await userEvent.type(screen.getByLabelText(/email/i), 'admin@test.local');
    await userEvent.type(screen.getByLabelText(/password/i), 'password-corretta');
    await userEvent.click(screen.getByRole('button', { name: /accedi/i }));

    expect(loginMock).toHaveBeenCalledWith('admin@test.local', 'password-corretta');
  });

  it('submit con credenziali sbagliate mostra un messaggio di errore', async () => {
    const loginMock = vi.fn().mockRejectedValue(new Error('credenziali non valide'));
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      utente: null,
      caricamento: false,
      login: loginMock,
      logout: vi.fn(),
    });

    render(<LoginView />);

    await userEvent.type(screen.getByLabelText(/email/i), 'admin@test.local');
    await userEvent.type(screen.getByLabelText(/password/i), 'password-sbagliata');
    await userEvent.click(screen.getByRole('button', { name: /accedi/i }));

    expect(await screen.findByText(/credenziali non valide/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
pnpm test src/components/LoginView.test.tsx
```

Expected: FAIL — `LoginView.tsx` non esiste.

- [ ] **Step 3: Implementa `src/components/LoginView.tsx`**

```tsx
import React, { useState } from 'react';
import { Landmark } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.tsx';

export function LoginView(): React.ReactElement {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      await login(email, password);
    } catch {
      setErrore('Credenziali non valide.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--pa-bg-gray)',
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: 'var(--pa-card-bg)',
          borderRadius: '10px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          padding: '2.5rem',
          width: '360px',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #00C5CA 0%, #0066CC 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Landmark size={24} color="white" />
          </div>
          <div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.05em', color: 'var(--pa-blue-dark)' }}>POLARIS</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Backoffice — Provincia di Pescara</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="login-email" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
            Email
          </label>
          <input
            id="login-email"
            type="email"
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="login-password" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
            Password
          </label>
          <input
            id="login-password"
            type="password"
            className="form-control"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {errore && (
          <div style={{
            backgroundColor: 'var(--pa-danger-bg)',
            color: 'var(--pa-danger)',
            padding: '0.6rem 0.85rem',
            borderRadius: '6px',
            fontSize: '0.85rem',
          }}>
            {errore}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={inCorso}>
          {inCorso ? 'Accesso in corso...' : 'Accedi'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
pnpm test src/components/LoginView.test.tsx
```

Expected: PASS, 2/2.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: nessun errore di `LoginView.tsx`/`LoginView.test.tsx` in sé. L'`App.tsx` di Task 5 ora risolve correttamente l'import di `LoginView` — restano solo gli errori attesi su `Sidebar`/`Header` (risolti da Task 7).

- [ ] **Step 6: Commit**

```bash
git add frontend-backoffice/src/components/LoginView.tsx frontend-backoffice/src/components/LoginView.test.tsx
git commit -m "feat(frontend-backoffice): schermata di login reale, stile coerente con lo scaffold esistente"
```

---

### Task 7: `Sidebar`/`Header` — utente reale al posto del toggle finto

**Files:**
- Modify: `frontend-backoffice/src/components/Sidebar.tsx`
- Modify: `frontend-backoffice/src/components/Header.tsx`

**Interfaces:**
- Consumes: `useAuth` da `../auth/AuthContext.tsx` (Task 4).
- Produces: nessuna nuova interfaccia — ultimo task del blocco, chiude il typecheck lasciato in sospeso da Task 5.

- [ ] **Step 1: Riscrivi `src/components/Sidebar.tsx`**

Sostituisci l'intero contenuto con:

```tsx
import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Layers,
  Building2,
  FileCheck2,
  Settings2,
  ShieldCheck,
  BarChart3,
  LogOut,
  Landmark
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.tsx';

export const Sidebar: React.FC = () => {
  const { utente, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const role = utente!.ruolo;
  const currentTab = location.pathname === '/' ? 'control-room' : location.pathname.replace(/^\//, '');

  const menuItems = [
    { id: 'control-room', label: 'Control Room Procedura', icon: Layers, roles: ['admin', 'operatore'] },
    { id: 'impianti-spazi', label: 'Impianti & Spazi Sportivi', icon: Building2, roles: ['admin', 'operatore'] },
    { id: 'deleghe-accreditamenti', label: 'Deleghe & Accreditamenti', icon: FileCheck2, roles: ['admin', 'operatore'], badge: '2' },
    { id: 'parametri-sistema', label: 'Parametri di Sistema', icon: Settings2, roles: ['admin'] },
    { id: 'audit-sorteggio', label: 'Audit Log & Sorteggi HMAC', icon: ShieldCheck, roles: ['admin', 'operatore'] },
    { id: 'statistiche', label: 'Analisi & Statistiche', icon: BarChart3, roles: ['admin', 'operatore'] }
  ];

  return (
    <aside style={{
      width: '270px',
      backgroundColor: 'var(--pa-blue-dark)',
      color: 'white',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      boxShadow: '4px 0 10px rgba(0,0,0,0.05)'
    }}>
      {/* Header Logo */}
      <div style={{
        padding: '1.5rem 1.25rem',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem'
      }}>
        <div style={{
          width: '42px',
          height: '42px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #00C5CA 0%, #0066CC 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
        }}>
          <Landmark size={24} color="white" />
        </div>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.05em', lineHeight: 1 }}>POLARIS</div>
          <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '2px', fontWeight: 500 }}>Provincia di Pescara</div>
        </div>
      </div>

      {/* Role Indicator Banner */}
      <div style={{
        margin: '1rem 1.25rem 0.5rem',
        padding: '0.5rem 0.75rem',
        borderRadius: '6px',
        backgroundColor: role === 'admin' ? 'rgba(0, 197, 202, 0.15)' : 'rgba(255, 255, 255, 0.1)',
        border: `1px solid ${role === 'admin' ? 'var(--pa-accent)' : 'rgba(255,255,255,0.2)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.8rem'
      }}>
        <span style={{ opacity: 0.8 }}>Ruolo Attivo:</span>
        <span style={{
          fontWeight: 700,
          color: role === 'admin' ? 'var(--pa-accent)' : '#F1F5F9',
          textTransform: 'uppercase',
          fontSize: '0.75rem'
        }}>
          {role === 'admin' ? 'Amministratore' : 'Operatore'}
        </span>
      </div>

      {/* Navigation Links */}
      <nav style={{ flex: 1, padding: '1rem 0.75rem' }}>
        {menuItems
          .filter(item => item.roles.includes(role))
          .map(item => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(`/${item.id}`)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  marginBottom: '0.4rem',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: isActive ? 'var(--pa-blue-primary)' : 'transparent',
                  color: isActive ? 'white' : 'rgba(255,255,255,0.75)',
                  cursor: 'pointer',
                  fontWeight: isActive ? 600 : 400,
                  fontSize: '0.875rem',
                  transition: 'all 0.15s ease',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.color = 'white';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.75)';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span style={{
                    backgroundColor: '#E74C3C',
                    color: 'white',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    borderRadius: '10px',
                    padding: '0.1rem 0.45rem'
                  }}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
      </nav>

      {/* Footer / System Version + Logout */}
      <div style={{
        padding: '1rem 1.25rem',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        fontSize: '0.75rem',
        color: 'rgba(255,255,255,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Versione POLARIS</span>
          <span style={{ color: 'var(--pa-accent)', fontWeight: 600 }}>v2.4.0</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Engine Go</span>
          <span style={{ color: '#2ECC71', fontWeight: 600 }}>Connected</span>
        </div>
        <button
          onClick={() => logout()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginTop: '0.5rem',
            padding: '0.5rem 0.6rem',
            borderRadius: '6px',
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.75)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            textAlign: 'left'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = 'white';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'rgba(255,255,255,0.75)';
          }}
        >
          <LogOut size={16} />
          <span>Esci</span>
        </button>
      </div>
    </aside>
  );
};
```

Nota: `role`/`setRole` erano già assenti da questo file (`Sidebar` prendeva solo `role` in lettura, mai `setRole` — quello era su `Header`). `currentTab` è ora derivato da `useLocation()` invece che da una prop, e la navigazione usa `useNavigate()` invece di `setCurrentTab`.

- [ ] **Step 2: Riscrivi `src/components/Header.tsx`**

Sostituisci l'intero contenuto con:

```tsx
import React from 'react';
import { Season } from '../types.ts';
import { Calendar, Bell } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.tsx';

interface HeaderProps {
  seasons: Season[];
  selectedSeasonId: string;
  setSelectedSeasonId: (id: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  seasons,
  selectedSeasonId,
  setSelectedSeasonId,
}) => {
  const { utente } = useAuth();
  const currentSeason = seasons.find(s => s.id === selectedSeasonId) || seasons[0];
  const role = utente!.ruolo;

  return (
    <header style={{
      height: '64px',
      backgroundColor: 'white',
      borderBottom: '1px solid var(--pa-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 1.75rem',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      {/* Left: Season selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--pa-blue-dark)', fontWeight: 600, fontSize: '0.9rem' }}>
          <Calendar size={18} color="var(--pa-blue-primary)" />
          <span>Stagione Operativa:</span>
        </div>
        <select
          value={selectedSeasonId}
          onChange={(e) => setSelectedSeasonId(e.target.value)}
          className="form-control"
          style={{
            width: 'auto',
            fontWeight: 600,
            padding: '0.4rem 0.8rem',
            borderColor: 'var(--pa-blue-primary)',
            color: 'var(--pa-blue-dark)',
            cursor: 'pointer'
          }}
        >
          {seasons.map(s => (
            <option key={s.id} value={s.id}>
              {s.nome} ({s.stato.toUpperCase()})
            </option>
          ))}
        </select>
        <span className="badge badge-info" style={{ textTransform: 'uppercase', fontSize: '0.725rem' }}>
          Fase {currentSeason.faseCorrenteNum} di 16
        </span>
      </div>

      {/* Right: User profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Notifications Icon */}
        <div style={{ position: 'relative', cursor: 'pointer' }}>
          <Bell size={20} color="var(--pa-text-muted)" />
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#E74C3C'
          }} />
        </div>

        {/* User Card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', borderLeft: '1px solid #E2E8F0', paddingLeft: '1.25rem' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: 'var(--pa-blue-light)',
            color: 'var(--pa-blue-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '0.85rem'
          }}>
            {utente!.email.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)', lineHeight: 1.1 }}>
              {utente!.email}
            </span>
            <span style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)', marginTop: '2px' }}>
              {role === 'admin' ? 'Amministratore Sistema' : 'Funzionario Servizio Sport'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
```

Nota su `utente!` in `Sidebar`/`Header`: il `!` non-null assertion è sicuro qui perché entrambi i componenti sono renderizzati SOLO dentro `<ProtectedRoute>` (Task 5), che garantisce `utente !== null` prima di renderizzare i suoi figli — non serve un controllo difensivo duplicato.

- [ ] **Step 3: Typecheck completo del blocco**

```bash
pnpm exec tsc --noEmit
```

Expected: nessun errore — questo chiude anche gli errori lasciati aperti da Task 5 (`BackofficeLayout`/`App.tsx` ora risolvono `Sidebar`/`Header` con le nuove firme).

- [ ] **Step 4: Esegui l'intera suite di test del blocco**

```bash
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre?sslmode=disable" pnpm test
```

Expected: tutti i test passano (client, AuthContext, LoginView), nessuna regressione.

- [ ] **Step 5: Verifica manuale nel browser**

Con backend e Postgres reali in esecuzione (`cd backend-node && DATABASE_URL=... JWT_SECRET=... node src/index.ts`) e il frontend (`cd frontend-backoffice && pnpm dev`): apri `http://localhost:5173`, verifica redirect a `/login`, login con un utente backoffice reale esistente, navigazione tra le voci del menu (URL cambia), bottone "Esci" riporta a `/login`.

- [ ] **Step 6: Commit**

```bash
git add frontend-backoffice/src/components/Sidebar.tsx frontend-backoffice/src/components/Header.tsx
git commit -m "feat(frontend-backoffice): Sidebar/Header mostrano l'utente reale, rimosso il toggle ruolo finto"
```

---

## Self-Review Notes

- **Spec coverage**: token storage `localStorage` (Task 3). `react-router` con rotte esistenti invariate (Task 5). Bump TS 7.0.2 (Task 1). Proxy Vite dev (Task 2). Vitest+Testing Library, backend reale nei test per client/auth, Testing Library puro per `LoginView` (Task 2-4, 6). `AuthContext` con bootstrap/login/logout (Task 4). `ProtectedRoute` (Task 5). `Sidebar`/`Header` aggiornati, bottone logout su icona `LogOut` già importata (Task 7). Nessuna vista funzionale toccata (confermato: `ControlRoomView` ecc. importate invariate in `App.tsx`/Task 5). Deviazione dichiarata dalla spec originale: identità mostrata è `email`, non `nome/cognome` (il backend non li espone da `/auth/me`) — corretto rispetto alla bozza iniziale della spec, coerente con lo schema JWT reale (`PayloadAccessToken = {sub, email, ruolo}`).
- **Placeholder scan**: nessun TODO/TBD. La nota nello Step 3 di Task 4 non è un placeholder — è un'istruzione condizionale esplicita con entrambi i rami di codice forniti per intero (path relativo vs `baseUrl()` esportata), necessaria perché il comportamento esatto di `fetch` con path relativo dentro jsdom/Vitest dipende da una configurazione (`testEnvironmentOptions.url`) che l'implementer deve verificare eseguendo il test, non assumere a tavolino.
- **Type consistency**: `Utente` (Task 4: `{sub, email, ruolo}`) usato identico in `ProtectedRoute` (Task 5, solo `utente !== null`), `LoginView` (Task 6, non legge campi di `Utente` direttamente), `Sidebar`/`Header` (Task 7, `utente!.ruolo`/`utente!.email`). `apiFetch`/`impostaTokens`/`rimuoviTokens`/`ErroreSessioneScaduta` (Task 3) usati con la stessa firma in `AuthContext` (Task 4) e nei test. `avviaBackendReale`/`creaUtenteTest` (Task 3) riusati identici in Task 4.
