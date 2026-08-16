# Frontend pubblico: login OIDC reale + entità rappresentate + pannello OIDC backoffice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire l'`Header` hardcoded del frontend pubblico (persona finta, associazioni finte) con un login OIDC SPID/CIE reale contro il backend Node già pronto, aggiungere l'unico endpoint mancante lato backend (elenco delle proprie deleghe), e dare all'admin backoffice una UI per configurare OIDC (oggi solo un endpoint HTTP raggiungibile a mano).

**Architecture:** Nessuna nuova dipendenza router: `App.tsx` (frontend pubblico) fa da gate a tre stati leggendo `window.location.pathname` (pattern verificato in ComunicaPA, stesso protocollo OIDC lato backend) — redirect pieno per login, pathname `/oidc/callback` per lo scambio code/state, token in `localStorage`. Un nuovo `AuthContext` (Context React puro, nessun router) espone persona/entità/login/logout, mirror dell'`AuthContext` già esistente in `frontend-backoffice`. Il pannello OIDC backoffice riusa `react-router` già presente lì, stesso pattern di `ParametriSistemaView`.

**Tech Stack:** React 19 + TypeScript, Vite, Express 5 + zod + `pg` (backend, invariato), Vitest + Testing Library + jsdom (da bootstrappare in `frontend-pubblico`, oggi assente), `node --test` (backend, invariato).

## Global Constraints

- Decimal-as-string invariant: non tocchiamo NUMERIC in questo blocco, non applicabile.
- Ogni operazione di scrittura tracciata via `registraOperazione` (art. B.39) — le nuove rotte di questo piano sono tutte `GET` (lettura), nessun audit log da aggiungere. Le rotte di scrittura toccate (`PUT /backoffice/impostazioni/oidc`) hanno già l'audit log, non lo tocchiamo.
- Nessuna nuova dipendenza di routing in `frontend-pubblico` — redirect pieno + pathname check manuale, coerente con l'assenza di route multiple reali nell'app (a tab, non a pagine).
- `frontend-pubblico` non ha oggi alcuna infrastruttura di test (niente vitest/testing-library nel `package.json`, niente `test` script) — va bootstrappata (Task 1) mirror esatto di `frontend-backoffice` (stesso `vitest.config.ts`/`setupFiles`, stesso pattern `testUtil/backendReale.ts` con import cross-package relativo a `backend-node/src/...`, già un pattern accettato nel repo — vedi `frontend-backoffice/src/testUtil/creaUtenteTest.ts`).
- Naming: funzioni che restituiscono collezioni si chiamano `listaX` (mai `leggiX`), coerente con `listaAbilitazioni`/`listaVersioni`/`listaDeleghe` già nel codebase.
- Ogni file `.ts`/`.tsx` nuovo va aggiunto con lo stesso stile (fetch wrapper, gestione errori `ErroreRichiestaApi`, italiano nei nomi funzione/variabile/commenti) del resto del repo — non introdurre inglese o pattern diversi.
- CI: `frontend-pubblico` non ha oggi un job GitHub Actions dedicato — va aggiunto in `.github/workflows/ci.yml`, mirror del job `frontend-backoffice` (stesso servizio Postgres, stesso `pnpm install --frozen-lockfile` a livello di workspace root, stesso `TEST_DATABASE_URL`/`JWT_SECRET`).

---

### Task 1: Bootstrap infrastruttura di test in `frontend-pubblico` + job CI

**Files:**
- Modify: `frontend-pubblico/package.json`
- Modify: `frontend-pubblico/vite.config.ts`
- Create: `frontend-pubblico/src/testUtil/setup.ts`
- Create: `frontend-pubblico/src/testUtil/backendReale.ts`
- Create: `frontend-pubblico/src/testUtil/creaPersonaTest.ts`
- Create: `frontend-pubblico/src/sanity.test.tsx`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produce (usate da Task 4-6): `avviaBackendReale(): Promise<{baseUrl: string; chiudi: () => Promise<void>}>` (identico a `frontend-backoffice/src/testUtil/backendReale.ts`, stesso file copiato).
- Produce: `creaPersonaTest(dsn: string): Promise<{persona: {id: string; codiceFiscale: string; nome: string; cognome: string}; accessToken: string; refreshToken: string; elimina: () => Promise<void>}>` — inserisce una riga in `persone_fisiche` via `pg` diretto e genera un token con `generaAccessTokenPubblico` (import cross-package da `backend-node/src/auth/jwtPubblico.ts`, stesso pattern di `creaUtenteTest.ts` che importa `backend-node/src/auth/password.ts`) + un refresh token vero inserendo la sessione in `sessioni_persona_fisica` (import `creaSessionePersonaFisica`/`generaRefreshToken`/`hashRefreshToken` da `backend-node/src`). Serve perché generare un `code` OIDC reale in un test HTTP puro non è praticabile — bypassa lo scambio OIDC, non la sua verifica (già coperta da `backend-node/src/auth/loginPubblico.test.ts` e `docs/claude/oidc-spid-cie.md`).

- [ ] **Step 1: Aggiungi le devDependencies e lo script di test**

In `frontend-pubblico/package.json`, aggiungi al blocco `"scripts"`:

```json
    "test": "vitest run"
```

E sostituisci `"devDependencies"` con:

```json
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.0",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.3",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^30.0.1",
    "pg": "^8.22.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.7",
    "vitest": "^4.1.10"
  }
```

(versioni identiche a `frontend-backoffice/package.json` — stesso workspace pnpm, stesso lockfile radice, `pg` serve a `creaPersonaTest.ts` per l'insert diretto).

- [ ] **Step 2: Aggiorna `vite.config.ts` con test config + proxy dev**

Sostituisci il contenuto di `frontend-pubblico/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/pubblico': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testUtil/setup.ts'],
    globals: true,
    restoreMocks: true,
  },
});
```

- [ ] **Step 3: Crea `src/testUtil/setup.ts`**

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Copia `src/testUtil/backendReale.ts`**

Contenuto identico a `frontend-backoffice/src/testUtil/backendReale.ts` (stesso file, stesso `BACKEND_DIR` — la risoluzione `path.resolve(__dirname, '../../../backend-node')` funziona identica perché la profondità relativa da `frontend-pubblico/src/testUtil/` alla radice del monorepo è la stessa di `frontend-backoffice/src/testUtil/`).

- [ ] **Step 5: Crea `src/testUtil/creaPersonaTest.ts`**

```typescript
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { generaAccessTokenPubblico } from '../../../backend-node/src/auth/jwtPubblico.ts';
import { generaRefreshToken, hashRefreshToken } from '../../../backend-node/src/auth/refreshToken.ts';

export interface PersonaTest {
  persona: { id: string; codiceFiscale: string; nome: string; cognome: string };
  accessToken: string;
  refreshToken: string;
  // Rimuove la persona di test creata (e la sessione collegata via ON DELETE CASCADE —
  // sessioni_persona_fisica ha la FK a cascata, a differenza di utenti_backoffice/
  // log_operazioni: vedi commento in creaUtenteTest.ts per il caso opposto).
  elimina: () => Promise<void>;
}

export async function creaPersonaTest(dsn: string): Promise<PersonaTest> {
  const pool = new Pool({ connectionString: dsn });
  try {
    const suffisso = randomUUID();
    const r = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Frontend', 'Test', $2, 'spid') RETURNING id`,
      [`FRNTST80A01H501U-${suffisso}`, suffisso],
    );
    const id = r.rows[0]!.id;
    const persona = { id, codiceFiscale: `FRNTST80A01H501U-${suffisso}`, nome: 'Frontend', cognome: 'Test' };
    const accessToken = generaAccessTokenPubblico(persona);
    const refreshToken = generaRefreshToken();
    await pool.query(
      `INSERT INTO sessioni_persona_fisica (persona_fisica_id, refresh_token_hash, scade_il)
       VALUES ($1, $2, now() + interval '7 days')`,
      [id, hashRefreshToken(refreshToken)],
    );
    return {
      persona,
      accessToken,
      refreshToken,
      elimina: async () => {
        const poolPulizia = new Pool({ connectionString: dsn });
        try {
          await poolPulizia.query('DELETE FROM persone_fisiche WHERE id = $1', [id]);
        } finally {
          await poolPulizia.end();
        }
      },
    };
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 6: Crea un test di sanità per verificare il wiring**

`frontend-pubblico/src/sanity.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('sanity check infrastruttura di test', () => {
  it('jsdom + testing-library funzionano', () => {
    render(<div>ok</div>);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Installa le dipendenze e lancia i test**

Run: `pnpm install` (a livello di workspace root, `C:\Users\mirko.daddiego\Documents\palestre`)
Run: `cd frontend-pubblico && pnpm test`
Expected: 1 file, 1 test, PASS.

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`
Expected: nessun errore (verifica che i nuovi file `testUtil/*.ts` tipizzino correttamente contro `backend-node`).

- [ ] **Step 8: Aggiungi il job CI**

In `.github/workflows/ci.yml`, dopo il job `frontend-backoffice:` (che termina prima di `compose-config:`), aggiungi un nuovo job `frontend-pubblico:` copiato identico a `frontend-backoffice:` ma con:
- `working-directory: frontend-pubblico` in ogni step
- Step "Typecheck" invariato (`pnpm exec tsc --noEmit`)
- Step "Test" con lo stesso commento adattato: `# Test (backend reale spawnato per-file, ciclo OIDC/persona contro Postgres reale)`, comando `run: pnpm test`
- Nessuno step "Applica le migration" duplicato: il job può condividere lo stesso step di migration del job `frontend-backoffice` solo se sono job separati (GitHub Actions non condivide step tra job) — quindi duplica anche lo step "Applica le migration" identico.

- [ ] **Step 9: Commit**

```bash
git add frontend-pubblico/package.json frontend-pubblico/vite.config.ts frontend-pubblico/src/testUtil frontend-pubblico/src/sanity.test.tsx .github/workflows/ci.yml
git commit -m "test(frontend-pubblico): bootstrap infrastruttura vitest/testing-library + job CI"
```

---

### Task 2: Backend — `GET /pubblico/deleghe/mie`

**Files:**
- Modify: `backend-node/src/abilitazioni.ts`
- Modify: `backend-node/src/server.ts`
- Test: `backend-node/src/abilitazioni.test.ts`
- Test: `backend-node/src/server.deleghe.test.ts`

**Interfaces:**
- Consumes: `listaAbilitazioni(db, filtri)` esistente (`backend-node/src/abilitazioni.ts:187`), `RequestAutenticataPubblico`/`richiedeAutenticazionePubblico` (`backend-node/src/auth/middleware.ts`), entrambi già importati in `server.ts`.
- Produces: `GET /pubblico/deleghe/mie` → `200 AbilitazioneConDettagli[]` (stesso DTO di `GET /backoffice/deleghe`), `401` senza token.

- [ ] **Step 1: Aggiungi il filtro `personaFisicaId` a `listaAbilitazioni`**

In `backend-node/src/abilitazioni.ts`, sostituisci la firma e il corpo (righe 187-215):

```typescript
export async function listaAbilitazioni(
  db: Db,
  filtri: { stato?: string | undefined; stagioneId?: string | undefined; personaFisicaId?: string | undefined },
): Promise<AbilitazioneConDettagli[]> {
  const condizioni: string[] = [];
  const parametri: unknown[] = [];
  if (filtri.stato) {
    parametri.push(filtri.stato);
    condizioni.push(`a.stato = $${parametri.length}`);
  }
  if (filtri.stagioneId) {
    parametri.push(filtri.stagioneId);
    condizioni.push(`a.stagione_id = $${parametri.length}`);
  }
  if (filtri.personaFisicaId) {
    parametri.push(filtri.personaFisicaId);
    condizioni.push(`a.persona_fisica_id = $${parametri.length}`);
  }
  const whereClause = condizioni.length > 0 ? `WHERE ${condizioni.join(' AND ')}` : '';
  const r = await db.query<RigaAbilitazioneConDettagli>(
    `SELECT a.id, a.persona_fisica_id, a.associazione_id, a.istituzione_scolastica_id, a.stagione_id,
            a.titolo, a.ruolo, a.stato, a.motivazione, a.creata_da_abilitazione_id,
            p.nome AS persona_nome, p.cognome AS persona_cognome, p.codice_fiscale AS persona_codice_fiscale,
            ass.denominazione AS associazione_denominazione, ass.codice_fiscale_partita_iva AS associazione_cf_piva
     FROM abilitazioni a
     JOIN persone_fisiche p ON p.id = a.persona_fisica_id
     LEFT JOIN associazioni ass ON ass.id = a.associazione_id
     ${whereClause}
     ORDER BY a.richiesta_il DESC`,
    parametri,
  );
  return r.rows.map(daRigaConDettagli);
}
```

- [ ] **Step 2: Test unitario del filtro in `abilitazioni.test.ts`**

Aggiungi (segui il pattern dei test esistenti nello stesso file per fixture stagione/associazione/persona — cercali con `creaAbilitazionePrincipale` per lo schema esatto degli insert già in uso):

```typescript
test(
  'listaAbilitazioni filtra per personaFisicaId, escludendo le abilitazioni di altre persone',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione filtro persona ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Filtro Persona', $1) RETURNING id`,
      [randomUUID()],
    );
    const personaA = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Anna', 'Uno', $2, 'spid') RETURNING id`,
      [`AAAUNO80A01H501U-${randomUUID()}`, randomUUID()],
    );
    const personaB = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Bruno', 'Due', $2, 'spid') RETURNING id`,
      [`BBBDUE80A01H501U-${randomUUID()}`, randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: personaA.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: personaB.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    const soloA = await listaAbilitazioni(pool, { personaFisicaId: personaA.rows[0]!.id });
    assert.equal(soloA.length, 1);
    assert.equal(soloA[0]!.personaFisicaCognome, 'Uno');
  },
);
```

- [ ] **Step 3: Esegui i test**

Run: `node --test src/abilitazioni.test.ts` (in `backend-node/`, con `TEST_DATABASE_URL` impostata)
Expected: PASS.

- [ ] **Step 4: Aggiungi la rotta `GET /pubblico/deleghe/mie`**

In `backend-node/src/server.ts`, subito dopo il blocco `app.post('/pubblico/deleghe', ...)` che termina alla riga 1315 (prima di `app.put('/backoffice/deleghe/:id/approva', ...)`), inserisci:

```typescript
  // Le proprie deleghe: nessun filtro stagione (una persona può averne su stagioni
  // diverse), tutti gli stati (la UI deve poter mostrare anche in_attesa/respinta,
  // non solo approvata).
  app.get('/pubblico/deleghe/mie', richiedeAutenticazionePubblico, async (req: RequestAutenticataPubblico, res) => {
    try {
      res.status(200).json(await listaAbilitazioni(pool, { personaFisicaId: req.persona!.sub }));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

```

- [ ] **Step 5: Test HTTP in `server.deleghe.test.ts`**

Aggiungi al file esistente (segui il pattern già presente nello stesso file — `avviaServerTest`, `creaUtenteTest` locali già definiti lì; per la persona pubblica usa `creaAbilitazionePrincipale` + insert diretto di `persone_fisiche` come già fa il test esistente `GET /backoffice/deleghe`; per il token pubblico importa `generaAccessTokenPubblico` da `./auth/jwtPubblico.ts`):

```typescript
test(
  'GET /pubblico/deleghe/mie',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione mie deleghe HTTP ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Mie Deleghe HTTP', $1) RETURNING id`,
      [randomUUID()],
    );
    const cfMia = `MIEDLG80A01H501U-${randomUUID()}`;
    const persona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Mia', 'Delega', $2, 'spid') RETURNING id`,
      [cfMia, randomUUID()],
    );
    const altraPersona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Altra', 'Persona', $2, 'spid') RETURNING id`,
      [`ALTPRS80A01H501U-${randomUUID()}`, randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: persona.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: altraPersona.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    const token = generaAccessTokenPubblico({
      sub: persona.rows[0]!.id,
      codiceFiscale: cfMia,
      nome: 'Mia',
      cognome: 'Delega',
    });

    const r = await fetch(`${base}/pubblico/deleghe/mie`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as Array<{ personaFisicaCognome: string }>;
    assert.equal(body.length, 1);
    assert.equal(body[0]!.personaFisicaCognome, 'Delega');

    const senzaAuth = await fetch(`${base}/pubblico/deleghe/mie`);
    assert.equal(senzaAuth.status, 401);
  },
);
```

Aggiungi `import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';` in cima al file se non già presente.

- [ ] **Step 6: Esegui i test**

Run: `node --test "src/server.deleghe.test.ts" "src/abilitazioni.test.ts"`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `cd backend-node && pnpm exec tsc`

```bash
git add backend-node/src/abilitazioni.ts backend-node/src/server.ts backend-node/src/abilitazioni.test.ts backend-node/src/server.deleghe.test.ts
git commit -m "feat(backend-node): aggiunge GET /pubblico/deleghe/mie (elenco deleghe proprie)"
```

---

### Task 3: Frontend pubblico — livello API (`client.ts`, `auth.ts`, `deleghe.ts`)

**Files:**
- Create: `frontend-pubblico/src/api/client.ts`
- Create: `frontend-pubblico/src/api/auth.ts`
- Create: `frontend-pubblico/src/api/deleghe.ts`
- Test: `frontend-pubblico/src/api/client.test.ts`
- Test: `frontend-pubblico/src/api/auth.test.ts`

**Interfaces:**
- Consumes: `avviaBackendReale`/`creaPersonaTest` da Task 1.
- Produces (usate da Task 4): `apiFetch`, `impostaTokens`, `rimuoviTokens`, `ErroreSessioneScaduta`, `ErroreRichiestaApi`, `richiedi` (da `client.ts`); `avviaLoginOidc(): void`, `scambiaCallbackOidc(code: string, state: string): Promise<void>` (scambia e salva i token, non ritorna la persona — il chiamante rilegge via `leggiPersonaAutenticata`), `leggiPersonaAutenticata(): Promise<PersonaAutenticata>`, `eseguiLogout(): Promise<void>` (da `auth.ts`); `listaEntitaRappresentate(): Promise<RepresentedEntity[]>` (da `deleghe.ts`).

- [ ] **Step 1: `src/api/client.ts`**

Copia `frontend-backoffice/src/api/client.ts` (contenuto già letto in questa sessione) con queste sole differenze:
- `CHIAVE_ACCESS = 'polaris_pubblico_access_token'`
- `CHIAVE_REFRESH = 'polaris_pubblico_refresh_token'`
- `provaRefresh` chiama `${baseUrl()}/auth/pubblico/refresh` invece di `/auth/refresh`
- Tutto il resto (compresa `ErroreSessioneScaduta`, `ErroreRichiestaApi`, `richiedi`, il single-flight refresh) identico.

- [ ] **Step 2: `src/api/auth.ts`**

```typescript
import { baseUrl, richiedi } from './client.ts';

export interface PersonaAutenticata {
  sub: string;
  codiceFiscale: string;
  nome: string;
  cognome: string;
}

// Redirect pieno del browser: il flusso OIDC (Authorization Code + PKCE) è
// interamente gestito dal backend/proxy, non da fetch — vedi docs/claude/oidc-spid-cie.md.
export function avviaLoginOidc(): void {
  window.location.href = `${baseUrl()}/auth/oidc/start`;
}

export async function scambiaCallbackOidc(code: string, state: string): Promise<void> {
  const r = await fetch(`${baseUrl()}/auth/oidc/callback`, {
    method: 'POST',
    // Il cookie di stato firmato (impostato da GET /auth/oidc/start) viaggia
    // automaticamente con la richiesta grazie a 'include' — necessario perché
    // il backend confronta lo state del body con quello nel cookie (fix login-CSRF,
    // vedi docs/claude/oidc-spid-cie.md).
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, state }),
  });
  if (!r.ok) {
    let messaggio = 'Autenticazione OIDC fallita, riprovare.';
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta il messaggio di default
    }
    throw new Error(messaggio);
  }
  const { accessToken, refreshToken } = (await r.json()) as { accessToken: string; refreshToken: string };
  const { impostaTokens } = await import('./client.ts');
  impostaTokens(accessToken, refreshToken);
}

export function leggiPersonaAutenticata(): Promise<PersonaAutenticata> {
  return richiedi('/auth/pubblico/me');
}

export async function eseguiLogout(): Promise<void> {
  const { rimuoviTokens } = await import('./client.ts');
  const refreshToken = localStorage.getItem('polaris_pubblico_refresh_token');
  if (refreshToken) {
    try {
      await fetch(`${baseUrl()}/auth/pubblico/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // il logout locale deve riuscire comunque, anche se la revoca server-side fallisce
    }
  }
  rimuoviTokens();
}
```

Nota per l'implementatore: gli `import('./client.ts')` dinamici dentro `scambiaCallbackOidc`/`eseguiLogout` sono superflui (il modulo è già importabile staticamente in cima al file, `richiedi`/`baseUrl` lo sono già) — usa un unico import statico in cima:
`import { baseUrl, richiedi, impostaTokens, rimuoviTokens } from './client.ts';` e rimuovi i due `await import(...)` inline, chiamando direttamente `impostaTokens`/`rimuoviTokens`.

- [ ] **Step 3: `src/api/deleghe.ts`**

```typescript
import { richiedi } from './client.ts';

export interface EntitaRappresentata {
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
  personaFisicaNome: string;
  personaFisicaCognome: string;
  personaFisicaCodiceFiscale: string;
  associazioneDenominazione: string | null;
  associazioneCodiceFiscalePartitaIva: string | null;
}

export function listaEntitaRappresentate(): Promise<EntitaRappresentata[]> {
  return richiedi('/pubblico/deleghe/mie');
}
```

- [ ] **Step 4: Test `client.test.ts`**

Mirror esatto di `frontend-backoffice/src/api/client.test.ts` (letto in questa sessione), con queste sostituzioni:
- `creaUtenteTest` → `creaPersonaTest` (da `../testUtil/creaPersonaTest.ts`, Task 1)
- Login manuale via `POST /auth/login` + email/password → sostituito da `accessToken`/`refreshToken` già pronti restituiti da `creaPersonaTest`
- Endpoint di prova: `/auth/pubblico/me` invece di `/auth/me`
- Chiavi storage verificate nell'ultimo test: `polaris_pubblico_access_token`/`polaris_pubblico_refresh_token`
- Per il test "su 401 con refresh token valido, rinnova": usa `impostaTokens('token-invalido', persona.refreshToken)` sfruttando il refresh token vero creato da `creaPersonaTest` (che ha già inserito una riga in `sessioni_persona_fisica`).

- [ ] **Step 5: Test `auth.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { avviaLoginOidc, scambiaCallbackOidc, leggiPersonaAutenticata } from './auth.ts';
import { rimuoviTokens } from './client.ts';

describe('auth.ts', () => {
  beforeEach(() => {
    rimuoviTokens();
  });

  it('avviaLoginOidc reindirizza a /auth/oidc/start', () => {
    const originale = window.location;
    // @ts-expect-error -- override di window.location per il test, ripristinato in afterEach
    delete window.location;
    window.location = { ...originale, href: '' } as Location;

    avviaLoginOidc();

    expect(window.location.href).toContain('/auth/oidc/start');
    window.location = originale;
  });

  it('scambiaCallbackOidc su risposta non-ok propaga il messaggio di errore del backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errore: 'sessione di login scaduta o non valida, riprovare' }), { status: 401 }),
    );

    await expect(scambiaCallbackOidc('code-test', 'state-test')).rejects.toThrow(
      'sessione di login scaduta o non valida, riprovare',
    );
  });
});
```

(`leggiPersonaAutenticata` è già coperto end-to-end da `client.test.ts` sopra tramite `richiedi` — nessun test isolato aggiuntivo necessario, evita duplicazione.)

- [ ] **Step 6: Esegui i test**

Run: `cd frontend-pubblico && pnpm test`
Expected: PASS (richiede `TEST_DATABASE_URL` per `client.test.ts`; `auth.test.ts` gira sempre).

- [ ] **Step 7: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/api
git commit -m "feat(frontend-pubblico): aggiunge livello API auth OIDC + deleghe proprie"
```

---

### Task 4: Frontend pubblico — `AuthContext`, `LoginView`, `OidcCallbackView`

**Files:**
- Create: `frontend-pubblico/src/auth/AuthContext.tsx`
- Create: `frontend-pubblico/src/components/LoginView.tsx`
- Create: `frontend-pubblico/src/components/OidcCallbackView.tsx`
- Test: `frontend-pubblico/src/auth/AuthContext.test.tsx`
- Test: `frontend-pubblico/src/components/LoginView.test.tsx`
- Test: `frontend-pubblico/src/components/OidcCallbackView.test.tsx`

**Interfaces:**
- Consumes: `avviaLoginOidc`, `scambiaCallbackOidc`, `leggiPersonaAutenticata`, `eseguiLogout` (Task 3, `api/auth.ts`), `listaEntitaRappresentate` (Task 3, `api/deleghe.ts`), `ErroreSessioneScaduta`/`impostaTokens`/`rimuoviTokens` (Task 3, `api/client.ts`).
- Produces (usate da Task 5): `AuthProvider`, `useAuth(): { persona: PersonaAutenticata | null; entities: EntitaRappresentata[]; caricamento: boolean; ricarica: () => void; logout: () => Promise<void> }`.

- [ ] **Step 1: `src/auth/AuthContext.tsx`**

```typescript
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { leggiPersonaAutenticata, eseguiLogout, type PersonaAutenticata } from '../api/auth.ts';
import { listaEntitaRappresentate, type EntitaRappresentata } from '../api/deleghe.ts';
import { ErroreSessioneScaduta, rimuoviTokens } from '../api/client.ts';

interface AuthContextValue {
  persona: PersonaAutenticata | null;
  entities: EntitaRappresentata[];
  caricamento: boolean;
  ricarica: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function caricaSessione(): Promise<{ persona: PersonaAutenticata; entities: EntitaRappresentata[] } | null> {
  try {
    const persona = await leggiPersonaAutenticata();
    const entities = await listaEntitaRappresentate();
    return { persona, entities };
  } catch (err) {
    if (err instanceof ErroreSessioneScaduta) {
      return null;
    }
    // Nessun token presente: leggiPersonaAutenticata risponde 401, richiedi() lo
    // mappa in ErroreRichiestaApi (non ErroreSessioneScaduta, perché non c'è un
    // refresh token da tentare — vedi apiFetch in client.ts) — anche questo caso
    // equivale a "nessuna sessione".
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [persona, setPersona] = useState<PersonaAutenticata | null>(null);
  const [entities, setEntities] = useState<EntitaRappresentata[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [versione, setVersione] = useState(0);

  const ricarica = useCallback(() => setVersione((v) => v + 1), []);

  useEffect(() => {
    let annullato = false;
    setCaricamento(true);
    caricaSessione()
      .then((esito) => {
        if (annullato) return;
        setPersona(esito?.persona ?? null);
        setEntities(esito?.entities ?? []);
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });
    return () => {
      annullato = true;
    };
  }, [versione]);

  const logout = useCallback(async (): Promise<void> => {
    await eseguiLogout();
    setPersona(null);
    setEntities([]);
  }, []);

  return (
    <AuthContext.Provider value={{ persona, entities, caricamento, ricarica, logout }}>
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

- [ ] **Step 2: `src/components/LoginView.tsx`**

Stile ripreso da `Header.tsx` esistente (colori `--pa-blue-dark`/`--pa-accent`) e dalla struttura di `frontend-backoffice/src/components/LoginView.tsx` (card centrata), ma con un solo bottone (niente form email/password: la scelta SPID/CIE/eIDAS avviene sul proxy OIDC, non da noi — stesso principio di ComunicaPA "un solo bottone").

```typescript
import React from 'react';
import { Landmark, ShieldCheck } from 'lucide-react';
import { avviaLoginOidc } from '../api/auth.ts';

export const LoginView: React.FC = () => (
  <div style={{
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--pa-bg-gray)',
  }}>
    <div style={{
      backgroundColor: 'white',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
      padding: '2.5rem',
      width: '400px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1.25rem',
      textAlign: 'center',
    }}>
      <div style={{
        width: '52px',
        height: '52px',
        borderRadius: '10px',
        background: 'linear-gradient(135deg, #00C5CA 0%, #0066CC 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Landmark size={28} color="white" />
      </div>
      <div>
        <h1 style={{ fontSize: '1.3rem', color: 'var(--pa-blue-dark)', margin: 0 }}>POLARIS</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
          Portale Spazi Sportivi — Provincia di Pescara
        </p>
      </div>
      <button onClick={avviaLoginOidc} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
        <ShieldCheck size={18} />
        <span>Accedi con SPID / CIE</span>
      </button>
    </div>
  </div>
);
```

- [ ] **Step 3: `src/components/OidcCallbackView.tsx`**

```typescript
import React, { useEffect, useState } from 'react';
import { scambiaCallbackOidc } from '../api/auth.ts';

interface OidcCallbackViewProps {
  onCompletato: () => void;
}

export const OidcCallbackView: React.FC<OidcCallbackViewProps> = ({ onCompletato }) => {
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const erroreProvider = params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    if (erroreProvider) {
      setErrore(`Accesso negato dal provider: ${erroreProvider}`);
      return;
    }
    if (!code || !state) {
      setErrore('Risposta OIDC incompleta.');
      return;
    }

    scambiaCallbackOidc(code, state)
      .then(() => {
        window.history.replaceState({}, '', '/');
        onCompletato();
      })
      .catch((err: unknown) => {
        setErrore(err instanceof Error ? err.message : 'Autenticazione OIDC fallita, riprovare.');
      });
  }, [onCompletato]);

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--pa-bg-gray)',
      flexDirection: 'column',
      gap: '1rem',
    }}>
      {errore ? (
        <>
          <div style={{ color: 'var(--pa-danger)', fontWeight: 600 }}>{errore}</div>
          <a href="/">Torna alla pagina di accesso</a>
        </>
      ) : (
        <div>Completamento accesso in corso…</div>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Test `AuthContext.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as authApi from '../api/auth.ts';
import * as deleghe from '../api/deleghe.ts';
import { AuthProvider, useAuth } from './AuthContext.tsx';

function Sonda(): React.ReactElement {
  const { persona, entities, caricamento } = useAuth();
  if (caricamento) return <div>caricamento</div>;
  return <div>{persona ? `${persona.nome} ${persona.cognome} - ${entities.length} entità` : 'nessuna sessione'}</div>;
}

describe('AuthContext', () => {
  it('carica persona ed entità quando la sessione è valida', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockResolvedValue({
      sub: 'p1', codiceFiscale: 'CF', nome: 'Mario', cognome: 'Rossi',
    });
    vi.spyOn(deleghe, 'listaEntitaRappresentate').mockResolvedValue([]);

    render(<AuthProvider><Sonda /></AuthProvider>);

    expect(await screen.findByText('Mario Rossi - 0 entità')).toBeInTheDocument();
  });

  it('nessuna sessione: persona resta null', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockRejectedValue(new Error('401'));

    render(<AuthProvider><Sonda /></AuthProvider>);

    expect(await screen.findByText('nessuna sessione')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Test `LoginView.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as authApi from '../api/auth.ts';
import { LoginView } from './LoginView.tsx';

describe('LoginView', () => {
  it('il bottone chiama avviaLoginOidc', async () => {
    const spy = vi.spyOn(authApi, 'avviaLoginOidc').mockImplementation(() => {});
    render(<LoginView />);

    await userEvent.click(screen.getByRole('button', { name: /accedi con spid/i }));

    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Test `OidcCallbackView.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as authApi from '../api/auth.ts';
import { OidcCallbackView } from './OidcCallbackView.tsx';

function conQueryString(qs: string, ui: React.ReactElement): ReturnType<typeof render> {
  window.history.pushState({}, '', `/oidc/callback${qs}`);
  return render(ui);
}

describe('OidcCallbackView', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('scambia code+state e chiama onCompletato', async () => {
    const scambia = vi.spyOn(authApi, 'scambiaCallbackOidc').mockResolvedValue(undefined);
    const onCompletato = vi.fn();

    conQueryString('?code=abc&state=xyz', <OidcCallbackView onCompletato={onCompletato} />);

    await vi.waitFor(() => expect(onCompletato).toHaveBeenCalled());
    expect(scambia).toHaveBeenCalledWith('abc', 'xyz');
  });

  it('error dal provider: mostra il messaggio, non chiama scambiaCallbackOidc', async () => {
    const scambia = vi.spyOn(authApi, 'scambiaCallbackOidc');

    conQueryString('?error=access_denied', <OidcCallbackView onCompletato={vi.fn()} />);

    expect(await screen.findByText(/accesso negato dal provider: access_denied/i)).toBeInTheDocument();
    expect(scambia).not.toHaveBeenCalled();
  });

  it('scambio fallito: mostra il messaggio di errore del backend', async () => {
    vi.spyOn(authApi, 'scambiaCallbackOidc').mockRejectedValue(new Error('sessione di login scaduta o non valida, riprovare'));

    conQueryString('?code=abc&state=xyz', <OidcCallbackView onCompletato={vi.fn()} />);

    expect(await screen.findByText(/sessione di login scaduta/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Esegui i test**

Run: `cd frontend-pubblico && pnpm test`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/auth frontend-pubblico/src/components/LoginView.tsx frontend-pubblico/src/components/OidcCallbackView.tsx frontend-pubblico/src/components/LoginView.test.tsx frontend-pubblico/src/components/OidcCallbackView.test.tsx frontend-pubblico/src/auth/AuthContext.test.tsx
git commit -m "feat(frontend-pubblico): aggiunge AuthContext, LoginView, OidcCallbackView"
```

---

### Task 5: Frontend pubblico — `Header` reale + gate `App.tsx`

**Files:**
- Modify: `frontend-pubblico/src/types.ts`
- Modify: `frontend-pubblico/src/components/Header.tsx`
- Modify: `frontend-pubblico/src/App.tsx`
- Modify: `frontend-pubblico/src/mockData.ts`
- Test: `frontend-pubblico/src/components/Header.test.tsx`
- Test: `frontend-pubblico/src/App.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 4), `PersonaAutenticata` (Task 3 `api/auth.ts`), `EntitaRappresentata` (Task 3 `api/deleghe.ts`), `LoginView`/`OidcCallbackView` (Task 4).

- [ ] **Step 1: Aggiorna `src/types.ts`**

Rimuovi l'interfaccia `RepresentedEntity` esistente (righe 1-9) — sostituita da `EntitaRappresentata` in `api/deleghe.ts` (Task 3), che è la fonte di verità reale. Aggiorna gli import nelle altre view mock (`AccreditamentoDelegaView.tsx` e chiunque altro importi `RepresentedEntity` da `./types.ts`) per importarla invece da `./api/deleghe.ts` come `EntitaRappresentata` — **non** modificare il comportamento di quelle view in questo task, solo l'import del tipo (sono fuori scope, mock data invariato).

`ApplicationWizardState` e `ConcertazioneProposal` restano invariate (usate solo dalle view ancora mock).

- [ ] **Step 2: Riscrivi `src/components/Header.tsx`**

Stessa struttura JSX esistente, con queste sostituzioni:
- Props: `{ persona: PersonaAutenticata; entities: EntitaRappresentata[]; activeEntity: EntitaRappresentata | null; setActiveEntity: (e: EntitaRappresentata) => void; activeTab: string; setActiveTab: (t: string) => void; onLogout: () => void }` (import `PersonaAutenticata` da `../api/auth.ts`, `EntitaRappresentata` da `../api/deleghe.ts`).
- Riga "Autenticato via SPID (L2)" + nome hardcoded → `<span style={{ fontWeight: 600 }}>{persona.nome} {persona.cognome} (CF: {persona.codiceFiscale})</span>`, badge invariato ma testo generico "Identità Digitale Verificata" (non possiamo affermare "SPID" specificamente: `docs/claude/oidc-spid-cie.md` documenta che il provider esatto non è ancora distinguibile dai claim — placeholder noto, non risolto qui).
- Switcher associazioni: se `entities.length === 0`, mostra `<div style={{...}}>Nessuna associazione accreditata</div>` invece della `<select>`; altrimenti `<select>` con `entities.map(...)`, `option` label `{ent.associazioneDenominazione ?? '—'} ({ent.stato})`.
- Aggiungi un bottone logout nella barra identità in alto (stesso punto dove sta il badge), `onClick={onLogout}`, icona `LogOut` da `lucide-react`.
- `activeEntity` ora è `EntitaRappresentata | null` (può essere null se `entities` è vuoto) — lo `<select>` va renderizzato solo quando `activeEntity` non è null.

- [ ] **Step 3: Riscrivi `src/App.tsx`**

```typescript
import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.tsx';
import { LoginView } from './components/LoginView.tsx';
import { OidcCallbackView } from './components/OidcCallbackView.tsx';
import { Header } from './components/Header.tsx';
import { AccreditamentoDelegaView } from './components/AccreditamentoDelegaView';
import { WizardDomandaView } from './components/WizardDomandaView';
import { EsitiIsfView } from './components/EsitiIsfView';
import { ConcertazioneView } from './components/ConcertazioneView';
import { CalendarioDefinitivoView } from './components/CalendarioDefinitivoView';
import type { EntitaRappresentata } from './api/deleghe.ts';

const AppAutenticata: React.FC = () => {
  const { persona, entities, caricamento, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('accreditamento');
  const [activeEntity, setActiveEntity] = useState<EntitaRappresentata | null>(null);

  useEffect(() => {
    if (entities.length > 0 && !activeEntity) {
      setActiveEntity(entities[0]!);
    }
  }, [entities, activeEntity]);

  if (caricamento) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Caricamento…</div>;
  }

  if (!persona) {
    return <LoginView />;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--pa-bg-gray)', display: 'flex', flexDirection: 'column' }}>
      <Header
        persona={persona}
        entities={entities}
        activeEntity={activeEntity}
        setActiveEntity={setActiveEntity}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={logout}
      />

      <main style={{ flex: 1, paddingBottom: '3rem' }}>
        {activeTab === 'accreditamento' && <AccreditamentoDelegaView entities={[]} onAddNewEntity={() => {}} />}
        {activeTab === 'domanda-wizard' && <WizardDomandaView />}
        {activeTab === 'esiti-isf' && <EsitiIsfView />}
        {activeTab === 'concertazione' && <ConcertazioneView />}
        {activeTab === 'calendario-definitivo' && <CalendarioDefinitivoView />}
      </main>

      <footer style={{
        backgroundColor: 'var(--pa-blue-dark)',
        color: 'rgba(255,255,255,0.7)',
        padding: '1.5rem',
        fontSize: '0.8rem',
        textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div><strong>POLARIS</strong> — Provincia di Pescara • Servizio Pubblico Spazi Sportivi Scolastici</div>
          <div>Conforme Linee Guida AgID & Italia Design System • Accessibilità WCAG 2.1 AA</div>
        </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  const [inCallback] = useState(window.location.pathname === '/oidc/callback');
  const [callbackCompletato, setCallbackCompletato] = useState(false);

  if (inCallback && !callbackCompletato) {
    return <OidcCallbackView onCompletato={() => setCallbackCompletato(true)} />;
  }

  return (
    <AuthProvider>
      <AppAutenticata />
    </AuthProvider>
  );
};
```

Nota: `AccreditamentoDelegaView` riceve ancora `entities={[]}`/`onAddNewEntity={() => {}}` — resta sul suo mock interno per ora (fuori scope, un blocco a parte la collegherà a `listaEntitaRappresentate` reale e permetterà di aggiungere associazioni). L'implementatore verifichi la firma esatta di `AccreditamentoDelegaViewProps` in `AccreditamentoDelegaView.tsx` e adatti la chiamata se diversa da quanto sopra (il file non è stato riletto in dettaglio in questo piano).

- [ ] **Step 4: Ripulisci `src/mockData.ts`**

Rimuovi `mockRepresentedEntities` (non più usato — l'`Header` ora riceve `entities` reali da `AuthContext`). Verifica con una ricerca (`grep -rn mockRepresentedEntities frontend-pubblico/src`) che nessun'altra view mock lo importi ancora prima di rimuoverlo; se lo importano, lascialo e segnalalo come nota per il blocco successivo invece di rimuoverlo (non rompere le altre view mock in questo task).

- [ ] **Step 5: Test `Header.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';

const PERSONA = { sub: 'p1', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi' };
const ENTITA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 's1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

describe('Header', () => {
  it('mostra la persona reale, non hardcoded', () => {
    render(
      <Header persona={PERSONA} entities={[ENTITA]} activeEntity={ENTITA} setActiveEntity={vi.fn()}
        activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={vi.fn()} />,
    );
    expect(screen.getByText(/Mario Rossi/)).toBeInTheDocument();
    expect(screen.queryByText(/Marco Rossi/)).not.toBeInTheDocument();
  });

  it('nessuna entità: mostra lo stato vuoto invece dello switcher', () => {
    render(
      <Header persona={PERSONA} entities={[]} activeEntity={null} setActiveEntity={vi.fn()}
        activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={vi.fn()} />,
    );
    expect(screen.getByText(/nessuna associazione accreditata/i)).toBeInTheDocument();
  });

  it('bottone logout chiama onLogout', async () => {
    const onLogout = vi.fn();
    render(
      <Header persona={PERSONA} entities={[ENTITA]} activeEntity={ENTITA} setActiveEntity={vi.fn()}
        activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={onLogout} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /esci|logout/i }));
    expect(onLogout).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Test `App.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as authApi from './api/auth.ts';
import * as deleghe from './api/deleghe.ts';
import { App } from './App.tsx';

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('senza sessione, mostra LoginView', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockRejectedValue(new Error('401'));
    render(<App />);
    expect(await screen.findByRole('button', { name: /accedi con spid/i })).toBeInTheDocument();
  });

  it('con sessione valida, mostra Header con la persona reale', async () => {
    vi.spyOn(authApi, 'leggiPersonaAutenticata').mockResolvedValue({
      sub: 'p1', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
    });
    vi.spyOn(deleghe, 'listaEntitaRappresentate').mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByText(/Mario Rossi/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Esegui i test**

Run: `cd frontend-pubblico && pnpm test`
Expected: PASS (comprese le view mock esistenti, che non devono rompersi).

- [ ] **Step 8: Typecheck + commit**

Run: `cd frontend-pubblico && pnpm exec tsc --noEmit`

```bash
git add frontend-pubblico/src/types.ts frontend-pubblico/src/components/Header.tsx frontend-pubblico/src/App.tsx frontend-pubblico/src/mockData.ts frontend-pubblico/src/components/Header.test.tsx frontend-pubblico/src/App.test.tsx
git commit -m "feat(frontend-pubblico): Header e App collegati alla sessione OIDC reale"
```

---

### Task 6: Frontend pubblico — smoke test end-to-end + script mock-IdP per verifica manuale

**Files:**
- Test: `frontend-pubblico/src/App.realBackend.test.tsx`
- Create: `backend-node/scripts/mock-idp.mjs`

**Interfaces:**
- Consumes: `avviaBackendReale`, `creaPersonaTest` (Task 1), `impostaTokens`/`rimuoviTokens` (Task 3 `api/client.ts`).

- [ ] **Step 1: `App.realBackend.test.tsx`**

Copre il gate completo contro backend reale — login già autenticato (token pre-iniettato via `creaPersonaTest`, coerente con la scelta di design documentata in spec: lo scambio OIDC completo resta coperto dai test backend + dai test mockati di `OidcCallbackView`).

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { avviaBackendReale, type BackendReale } from './testUtil/backendReale.ts';
import { creaPersonaTest, type PersonaTest } from './testUtil/creaPersonaTest.ts';
import { impostaTokens, rimuoviTokens } from './api/client.ts';
import { App } from './App.tsx';

const dsn = process.env.TEST_DATABASE_URL;
const descrivi = dsn ? describe : describe.skip;

descrivi('App (backend reale)', () => {
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

  it('senza token, mostra LoginView', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /accedi con spid/i })).toBeInTheDocument();
  });

  it('con token reale, carica persona da /auth/pubblico/me e mostra Header', async () => {
    const p = await creaPersonaTest(dsn!);
    personeCreate.push(p);
    impostaTokens(p.accessToken, p.refreshToken);

    render(<App />);

    expect(await screen.findByText(new RegExp(`${p.persona.nome} ${p.persona.cognome}`))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Esegui il test**

Run: `cd frontend-pubblico && pnpm test -- App.realBackend.test.tsx`
Expected: PASS (richiede `TEST_DATABASE_URL`).

- [ ] **Step 3: Script mock-IdP standalone per verifica manuale in browser**

`backend-node/scripts/mock-idp.mjs` — adatta la logica di `avviaMockIdp` già scritta in `backend-node/src/auth/loginPubblico.test.ts` (RSA generata al volo, endpoint `/.well-known/openid-configuration`, `/authorize`, `/token`, stesso vincolo `client_secret_basic` del vero `pa-sso-proxy`) in uno script Node standalone che resta in ascolto invece di chiudersi a fine test. Non incluso in build/Docker (solo dev tool, richiamato a mano). Aggiungi in testa al file un commento che spiega come usarlo: avviare con `node scripts/mock-idp.mjs`, stampa a console `issuer`/`clientId`/`clientSecret` da incollare in `ImpostazioniOidcView` (Task 7) con `redirectUri = http://localhost:5174/oidc/callback`.

L'implementatore: legga prima `backend-node/src/auth/loginPubblico.test.ts` per la logica esatta di `avviaMockIdp` (RSA keygen, JWKS, endpoint `/token` che firma un id_token) e la traduca in uno script long-running (nessun `t.after()`/chiusura automatica, resta in ascolto finché non viene interrotto manualmente).

- [ ] **Step 4: Verifica manuale end-to-end (una tantum, non automatizzata)**

1. Avvia Postgres + applica le migration.
2. Avvia `node scripts/mock-idp.mjs` (stampa issuer/clientId/clientSecret).
3. Avvia il backend (`cd backend-node && node src/index.ts`).
4. Avvia il frontend backoffice, crea un admin (wizard bootstrap), fai login, vai su "Impostazioni OIDC" (Task 7) e configura issuer/clientId/clientSecret/redirectUri dal mock-IdP.
5. Avvia il frontend pubblico (`cd frontend-pubblico && pnpm dev`), apri `http://localhost:5174`.
6. Click "Accedi con SPID/CIE" → verifica redirect al mock-IdP → consenso → redirect a `/oidc/callback` → `Header` popolato con la persona vera.
7. Click logout → torna a `LoginView`.

Riporta l'esito nel report del task (non è un test automatico, ma va eseguito e documentato prima di considerare il blocco chiuso).

- [ ] **Step 5: Commit**

```bash
git add frontend-pubblico/src/App.realBackend.test.tsx backend-node/scripts/mock-idp.mjs
git commit -m "test(frontend-pubblico): smoke test end-to-end gate autenticazione + script mock-IdP per verifica manuale"
```

---

### Task 7: Backoffice — `ImpostazioniOidcView`

**Files:**
- Create: `frontend-backoffice/src/api/impostazioniOidc.ts`
- Create: `frontend-backoffice/src/components/ImpostazioniOidcView.tsx`
- Modify: `frontend-backoffice/src/components/Sidebar.tsx`
- Modify: `frontend-backoffice/src/routes.tsx`
- Test: `frontend-backoffice/src/components/ImpostazioniOidcView.test.tsx`
- Test: `frontend-backoffice/src/components/ImpostazioniOidcView.realBackend.test.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /backoffice/impostazioni/oidc` (backend già pronto, `ConfigOidcPubblica`/`ConfigOidcInput` in `backend-node/src/oidc/config.ts`), `richiedi` (`api/client.ts` esistente).

- [ ] **Step 1: `src/api/impostazioniOidc.ts`**

```typescript
import { ErroreRichiestaApi, richiedi } from './client.ts';

export { ErroreRichiestaApi };

export interface ConfigOidc {
  issuer: string;
  clientId: string;
  redirectUri: string;
  clientSecretConfigurato: boolean;
}

export interface DatiSalvaConfigOidc {
  issuer: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string | undefined;
}

// 404 = "non ancora configurato" (stato legittimo, non un errore da propagare al
// chiamante come tale): la view lo interpreta come form vuoto da compilare al
// primo salvataggio, coerente con ErroreClientSecretMancante lato backend.
export async function leggiConfigOidc(): Promise<ConfigOidc | null> {
  try {
    return await richiedi<ConfigOidc>('/backoffice/impostazioni/oidc');
  } catch (err) {
    if (err instanceof ErroreRichiestaApi && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export function salvaConfigOidc(dati: DatiSalvaConfigOidc): Promise<ConfigOidc> {
  return richiedi('/backoffice/impostazioni/oidc', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}
```

- [ ] **Step 2: `src/components/ImpostazioniOidcView.tsx`**

Stesso pattern di `ParametriSistemaView.tsx`/`VersioneParametricaForm.tsx` (card, `useState` per il form, `errore`/`inCorso`, `campoLabelStyle`), campo `clientSecret` con placeholder condizionale:

```typescript
import React, { useEffect, useState } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { leggiConfigOidc, salvaConfigOidc, type ConfigOidc, type DatiSalvaConfigOidc, ErroreRichiestaApi } from '../api/impostazioniOidc.ts';

export const ImpostazioniOidcView: React.FC = () => {
  const [config, setConfig] = useState<ConfigOidc | null | undefined>(undefined);
  const [dati, setDati] = useState<DatiSalvaConfigOidc>({ issuer: '', clientId: '', redirectUri: '', clientSecret: undefined });
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggioSalvato, setMessaggioSalvato] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    leggiConfigOidc()
      .then((c) => {
        setConfig(c);
        if (c) {
          setDati({ issuer: c.issuer, clientId: c.clientId, redirectUri: c.redirectUri, clientSecret: undefined });
        }
      })
      .catch((err) => setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare la configurazione OIDC.'));
  }, []);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setMessaggioSalvato(null);
    setInCorso(true);
    try {
      const salvato = await salvaConfigOidc(dati);
      setConfig(salvato);
      setDati({ issuer: salvato.issuer, clientId: salvato.clientId, redirectUri: salvato.redirectUri, clientSecret: undefined });
      setMessaggioSalvato('Configurazione salvata.');
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  if (config === undefined) {
    return <div>Caricamento…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Impostazioni OIDC (SPID/CIE)</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Configurazione del proxy OIDC (pa-sso-proxy) usato dal frontend pubblico per l'autenticazione SPID/CIE/eIDAS.
        </p>
      </div>

      <div className="pa-card" style={{ backgroundColor: '#FEF9E7', borderLeft: '4px solid #F39C12' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Lock size={22} color="#D68910" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, color: '#B7950B' }}>Client Secret cifrato at-rest</div>
            <div style={{ fontSize: '0.825rem', color: '#7D6608', marginTop: '2px' }}>
              Il client secret non viene mai restituito in chiaro. Lascia il campo vuoto per mantenere il valore già salvato.
            </div>
          </div>
        </div>
      </div>

      {errore && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {errore}
        </div>
      )}
      {messaggioSalvato && (
        <div style={{ backgroundColor: 'var(--pa-success-bg, #E8F8F0)', color: 'var(--pa-success, #1E8449)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {messaggioSalvato}
        </div>
      )}

      <form onSubmit={handleSubmit} className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '520px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-issuer" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Issuer</label>
          <input id="oidc-issuer" className="form-control" value={dati.issuer}
            onChange={(e) => setDati((p) => ({ ...p, issuer: e.target.value }))} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-client-id" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Client ID</label>
          <input id="oidc-client-id" className="form-control" value={dati.clientId}
            onChange={(e) => setDati((p) => ({ ...p, clientId: e.target.value }))} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-redirect-uri" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Redirect URI</label>
          <input id="oidc-redirect-uri" className="form-control" value={dati.redirectUri}
            onChange={(e) => setDati((p) => ({ ...p, redirectUri: e.target.value }))} required />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor="oidc-client-secret" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            <KeyRound size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            Client Secret
          </label>
          <input id="oidc-client-secret" type="password" className="form-control" value={dati.clientSecret ?? ''}
            placeholder={config?.clientSecretConfigurato ? 'Invariato (lascia vuoto per non modificarlo)' : 'Obbligatorio al primo salvataggio'}
            onChange={(e) => setDati((p) => ({ ...p, clientSecret: e.target.value || undefined }))} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={inCorso}>
          {inCorso ? 'Salvataggio…' : 'Salva configurazione'}
        </button>
      </form>
    </div>
  );
};
```

- [ ] **Step 3: Aggiungi la voce Sidebar**

In `frontend-backoffice/src/components/Sidebar.tsx`, aggiungi all'array `menuItems` (dopo `parametri-sistema`, stessa `roles: ['admin']`):

```typescript
    { id: 'impostazioni-oidc', label: 'Impostazioni OIDC', icon: ShieldCheck, roles: ['admin'] },
```

(riusa l'icona `ShieldCheck` già importata; se preferisci un'icona distinta da `audit-sorteggio`, importa `KeyRound` da `lucide-react` e usa quella).

- [ ] **Step 4: Aggiungi la route**

In `frontend-backoffice/src/routes.tsx`, importa `ImpostazioniOidcView` e aggiungila dentro lo stesso blocco `ProtectedRoute ruoliAmmessi={['admin']}` già usato per `parametri-sistema`:

```typescript
          {
            element: <ProtectedRoute ruoliAmmessi={['admin']} />,
            children: [
              { path: 'parametri-sistema', element: <ParametriSistemaView /> },
              { path: 'impostazioni-oidc', element: <ImpostazioniOidcView /> },
            ],
          },
```

- [ ] **Step 5: Test `ImpostazioniOidcView.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api/impostazioniOidc.ts';
import { ImpostazioniOidcView } from './ImpostazioniOidcView.tsx';

const CONFIG: api.ConfigOidc = {
  issuer: 'https://idp.test', clientId: 'client-test', redirectUri: 'http://localhost:5174/oidc/callback', clientSecretConfigurato: true,
};

describe('ImpostazioniOidcView', () => {
  it('non ancora configurato: mostra il form vuoto', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(null);
    render(<ImpostazioniOidcView />);
    expect(await screen.findByLabelText(/issuer/i)).toHaveValue('');
    expect(screen.getByPlaceholderText(/obbligatorio al primo salvataggio/i)).toBeInTheDocument();
  });

  it('già configurato: precompila il form, secret non mostrato in chiaro', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    render(<ImpostazioniOidcView />);
    expect(await screen.findByLabelText(/issuer/i)).toHaveValue('https://idp.test');
    expect(screen.getByPlaceholderText(/invariato/i)).toBeInTheDocument();
  });

  it('salva la configurazione senza clientSecret quando il campo resta vuoto', async () => {
    vi.spyOn(api, 'leggiConfigOidc').mockResolvedValue(CONFIG);
    const salva = vi.spyOn(api, 'salvaConfigOidc').mockResolvedValue(CONFIG);
    render(<ImpostazioniOidcView />);
    await screen.findByLabelText(/issuer/i);

    await userEvent.click(screen.getByRole('button', { name: /salva configurazione/i }));

    expect(salva).toHaveBeenCalledWith({
      issuer: 'https://idp.test', clientId: 'client-test', redirectUri: 'http://localhost:5174/oidc/callback', clientSecret: undefined,
    });
  });
});
```

- [ ] **Step 6: Test `ImpostazioniOidcView.realBackend.test.tsx`**

Mirror di `StatisticheView.realBackend.test.tsx` (letto in questa sessione): `avviaBackendReale`, `creaUtenteTest`, `createMemoryRouter(routes, {initialEntries: ['/impostazioni-oidc']})`, login admin, `renderApp`. Verifica: admin vede il form e può salvare (issuer/clientId/redirectUri validi, es. `https://mock-idp.test`/`client-e2e`/`http://localhost:5174/oidc/callback`, `clientSecret: 'secret-e2e-test'`), poi ricaricando la view il placeholder mostra "Invariato"; un utente `operatore` che naviga a `/impostazioni-oidc` viene reindirizzato (stesso comportamento già testato per `parametri-sistema` — verifica cercando come `ParametriSistemaView` lo testa, se esiste un test equivalente, altrimenti verifica che il `ProtectedRoute ruoliAmmessi` neghi l'accesso mostrando redirect a `/`).

- [ ] **Step 7: Esegui i test**

Run: `cd frontend-backoffice && pnpm test`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

Run: `cd frontend-backoffice && pnpm exec tsc --noEmit`

```bash
git add frontend-backoffice/src/api/impostazioniOidc.ts frontend-backoffice/src/components/ImpostazioniOidcView.tsx frontend-backoffice/src/components/ImpostazioniOidcView.test.tsx frontend-backoffice/src/components/ImpostazioniOidcView.realBackend.test.tsx frontend-backoffice/src/components/Sidebar.tsx frontend-backoffice/src/routes.tsx
git commit -m "feat(frontend-backoffice): aggiunge ImpostazioniOidcView (pannello configurazione OIDC admin)"
```

---

## Note finali per chi esegue il piano

- Dopo l'ultimo task, aggiorna `CLAUDE.md`/`docs/claude/backend-node.md`/`docs/claude/oidc-spid-cie.md` con l'esito (endpoint nuovo, view collegate, script mock-IdP, residuo "5 view pubbliche ancora mock" ridotto a 5 — Header/login non più nell'elenco) prima del merge, seguendo la stessa convenzione già in uso nel resto del progetto.
- Il residuo "mai testato contro il vero pa-sso-proxy" resta aperto (serve accesso a credenziali reali) — non chiuderlo in questo blocco, limitarsi ad aggiornare la formulazione se necessario.
