# CRUD utenti backoffice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un admin può creare (via invito email), listare, modificare, (dis)attivare e resettare la password di altri utenti backoffice — oggi solo il wizard primo avvio popola `utenti_backoffice`.

**Architecture:** Riuso totale delle colonne `token_verifica_hash`/`token_verifica_scade_il` già esistenti (migration `000005`, generiche per costruzione — nessuna migration in questo blocco). Stesso pattern di `auth/bootstrapAdmin.ts` (token SHA-256, TTL 24h, email via `DipendenzeApp.inviaEmail`/`backofficeBaseUrl` già iniettabili in `creaApp`) ma modulo indipendente in `repository/utentiBackoffice.ts` — non condivide codice col bootstrap, che resta un flusso a parte per il primo admin. Protezione "ultimo admin attivo" e "non puoi toccare te stesso" a livello applicativo (check-poi-update, accettato con lo stesso standard di tolleranza al TOCTOU già in uso altrove nel progetto, mitigato dal fatto che check e update girano nella stessa transazione).

**Tech Stack:** Node.js 24, TypeScript 7.0.2, Express 5, zod, `pg`, `node --test` contro Postgres 18 reale.

## Global Constraints

- Niente ORM: query SQL parametrizzate dirette.
- Ogni scrittura passa da `registraOperazione` nella stessa transazione via `eseguiInTransazione`.
- Mapping errori: 23505→409 (`ErroreValoreDuplicato`), 22P02/23503→400 (`comeErroreRiferimentoNonValido`), zod→400. Applicato su OGNI route di scrittura E sulle GET-by-id.
- Solo `richiedeRuolo('admin')` su tutte le route tranne `POST /backoffice/utenti/accetta-invito`, che è **pubblica** (nessun `richiedeAutenticazione`: l'invitato non ha ancora un JWT).
- **Nessun campo sensibile** (`password_hash`, `token_verifica_hash`) esposto in nessuna risposta HTTP.
- `password_hash` è `NOT NULL` a schema: un utente appena invitato riceve un hash sentinella (`hashPassword(randomBytes(32).toString('hex'))`, mai comunicato) — irraggiungibile comunque perché `auth/login.ts:47` blocca il login su `stato !== 'attivo'` prima di controllare la password.
- Postgres 18 dev persistente su `localhost:5433`, credenziali `postgres:test`, database `palestre`, schema già applicato. `cd backend-node` prima dei comandi npm/node.
- Test con `node --test` contro Postgres reale, mai mock del DB. Per gli scenari che devono controllare l'intera tabella `utenti_backoffice` (conteggio admin attivi, unicità email) usare `testutil/dbDedicato.ts::creaDatabaseDedicato()` (stesso motivo già documentato per `bootstrapAdmin.test.ts`: query "quanti admin attivi esistono" non è isolabile sul DB condiviso con altri file di test in esecuzione parallela).
- `exactOptionalPropertyTypes: true`: campi opzionali dichiarati `campo?: T | undefined` esplicito.

---

### Task 1: Repository — invito, lista, modifica, cambio stato, reset, completamento invito

**Files:**
- Modify: `backend-node/src/repository/utentiBackoffice.ts`
- Modify: `backend-node/src/repository/sessioni.ts`
- Create: `backend-node/src/repository/utentiBackoffice.test.ts`

**Interfaces:**
- Consumes: `Db` da `../db.ts`; `hashPassword` da `../auth/password.ts`; `ErroreValoreDuplicato`, `ErroreNonTrovato` da `../erroriDominio.ts`; `randomBytes`, `createHash` da `node:crypto`.
- Produces:
  - `UtenteBackoffice { id, email, passwordHash, nome, cognome, ruolo: 'admin'|'operatore', stato: 'attivo'|'disattivato'|'in_attesa_verifica', creatoDa: string|null, creatoIl: string, ultimoAccessoIl: string|null }` (interfaccia estesa, retrocompatibile — `login.ts` continua a usare solo `.stato`/`.passwordHash`).
  - `UtenteBackofficePubblico` — stesso shape senza `passwordHash`; `aPubblico(u: UtenteBackoffice): UtenteBackofficePubblico`.
  - `trovaUtentePerEmail(db: Db, email: string): Promise<UtenteBackoffice | null>`, `trovaUtentePerId(db: Db, id: string): Promise<UtenteBackoffice | null>` (firma allargata da `Pool` a `Db`, comportamento invariato).
  - `class ErroreUltimoAdmin extends Error {}`, `class ErroreTokenInvitoNonValido extends Error {}`.
  - `creaUtenteInvitato(db: Db, dati: {email,nome,cognome,ruolo}, creatoDa: string): Promise<{utente: UtenteBackoffice; token: string}>`.
  - `listaUtenti(db: Db): Promise<UtenteBackoffice[]>`.
  - `aggiornaUtente(db: Db, id: string, dati: {nome,cognome,ruolo}): Promise<UtenteBackoffice>` (lancia `ErroreUltimoAdmin` se declassa l'ultimo admin attivo).
  - `cambiaStatoUtente(db: Db, id: string, nuovoStato: 'attivo'|'disattivato', chiamanteId: string): Promise<UtenteBackoffice>` (lancia `ErroreUltimoAdmin` su auto-modifica o disattivazione dell'ultimo admin attivo).
  - `impostaNuovoInvito(db: Db, id: string): Promise<{utente: UtenteBackoffice; token: string} | null>`.
  - `completaInvito(db: Db, token: string, password: string): Promise<UtenteBackoffice>` (lancia `ErroreTokenInvitoNonValido`).
  - `revocaSessioniUtente(db: Db, utenteBackofficeId: string): Promise<void>` in `repository/sessioni.ts`.

- [ ] **Step 1: Scrivere i test RED**

`backend-node/src/repository/utentiBackoffice.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  creaUtenteInvitato,
  listaUtenti,
  aggiornaUtente,
  cambiaStatoUtente,
  impostaNuovoInvito,
  completaInvito,
  trovaUtentePerId,
  ErroreUltimoAdmin,
  ErroreTokenInvitoNonValido,
} from './utentiBackoffice.ts';
import { revocaSessioniUtente, creaSessione } from './sessioni.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from '../erroriDominio.ts';
import { verificaPassword } from '../auth/password.ts';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function svuota(pool: import('pg').Pool): Promise<void> {
  await pool.query('DELETE FROM sessioni_backoffice');
  await pool.query('DELETE FROM log_operazioni WHERE utente_backoffice_id IS NOT NULL');
  await pool.query('DELETE FROM utenti_backoffice');
}

test(
  'ciclo completo invito -> completamento, unicità email, ultimo admin protetto',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    let primoAdminId = '';

    await t.test('setup: un admin iniziale (simula il bootstrap)', async () => {
      await svuota(pool);
      const r = await pool.query<{ id: string }>(
        `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
         VALUES ($1, 'scrypt:1:1:1:aa:bb', 'Prima', 'Admin', 'admin', 'attivo') RETURNING id`,
        [`admin-iniziale-${randomUUID()}@test.local`],
      );
      primoAdminId = r.rows[0]!.id;
    });

    let tokenInvito = '';
    let invitatoId = '';

    await t.test('creaUtenteInvitato: stato in_attesa_verifica, token restituito', async () => {
      const email = `invitato-${randomUUID()}@test.local`;
      const { utente, token } = await creaUtenteInvitato(
        pool,
        { email, nome: 'Nuovo', cognome: 'Operatore', ruolo: 'operatore' },
        primoAdminId,
      );
      assert.equal(utente.stato, 'in_attesa_verifica');
      assert.equal(utente.email, email);
      assert.match(token, /^[a-f0-9]{64}$/);
      invitatoId = utente.id;
      tokenInvito = token;

      await assert.rejects(
        () =>
          creaUtenteInvitato(pool, { email, nome: 'Dup', cognome: 'Licato', ruolo: 'operatore' }, primoAdminId),
        ErroreValoreDuplicato,
      );
    });

    await t.test('listaUtenti include entrambi', async () => {
      const lista = await listaUtenti(pool);
      assert.ok(lista.length >= 2);
      assert.ok(lista.some((u) => u.id === invitatoId));
    });

    await t.test('completaInvito con token sbagliato: rifiutato', async () => {
      await assert.rejects(() => completaInvito(pool, 'a'.repeat(64), 'password-nuova-123456'), ErroreTokenInvitoNonValido);
    });

    await t.test('completaInvito: attiva, imposta password, token consumato', async () => {
      const attivato = await completaInvito(pool, tokenInvito, 'password-nuova-123456');
      assert.equal(attivato.stato, 'attivo');
      assert.ok(await verificaPassword('password-nuova-123456', attivato.passwordHash));

      await assert.rejects(() => completaInvito(pool, tokenInvito, 'altra-password-123456'), ErroreTokenInvitoNonValido);
    });

    await t.test('aggiornaUtente: nome/cognome/ruolo aggiornati', async () => {
      const aggiornato = await aggiornaUtente(pool, invitatoId, { nome: 'Rinominato', cognome: 'Operatore', ruolo: 'operatore' });
      assert.equal(aggiornato.nome, 'Rinominato');
      await assert.rejects(
        () => aggiornaUtente(pool, randomUUID(), { nome: 'X', cognome: 'Y', ruolo: 'operatore' }),
        ErroreNonTrovato,
      );
    });

    await t.test('cambiaStatoUtente: auto-modifica vietata', async () => {
      await assert.rejects(() => cambiaStatoUtente(pool, primoAdminId, 'disattivato', primoAdminId), ErroreUltimoAdmin);
    });

    await t.test('cambiaStatoUtente: ultimo admin attivo non disattivabile', async () => {
      // primoAdminId è l'unico admin attivo (invitatoId è operatore)
      await assert.rejects(() => cambiaStatoUtente(pool, primoAdminId, 'disattivato', invitatoId), ErroreUltimoAdmin);
    });

    await t.test('aggiornaUtente: non può declassare l\'ultimo admin attivo a operatore', async () => {
      await assert.rejects(
        () => aggiornaUtente(pool, primoAdminId, { nome: 'Prima', cognome: 'Admin', ruolo: 'operatore' }),
        ErroreUltimoAdmin,
      );
    });

    await t.test('con un secondo admin attivo, disattivazione/declassamento del primo permessi', async () => {
      const { utente: secondoAdmin, token } = await creaUtenteInvitato(
        pool,
        { email: `secondo-admin-${randomUUID()}@test.local`, nome: 'Secondo', cognome: 'Admin', ruolo: 'admin' },
        primoAdminId,
      );
      await completaInvito(pool, token, 'password-secondo-admin-123');

      const declassato = await aggiornaUtente(pool, primoAdminId, { nome: 'Prima', cognome: 'Admin', ruolo: 'operatore' });
      assert.equal(declassato.ruolo, 'operatore');

      const disattivato = await cambiaStatoUtente(pool, secondoAdmin.id, 'disattivato', primoAdminId);
      assert.equal(disattivato.stato, 'disattivato');
    });

    await t.test('impostaNuovoInvito: rigenera token, stato torna in_attesa_verifica, sessioni revocate', async () => {
      const { id: sessioneId } = { id: await creaSessione(pool, { utenteBackofficeId: invitatoId, refreshTokenHash: 'hash-finto', scadeIl: new Date(Date.now() + 3600_000) }) };
      const reset = await impostaNuovoInvito(pool, invitatoId);
      assert.ok(reset);
      assert.equal(reset!.utente.stato, 'in_attesa_verifica');
      assert.match(reset!.token, /^[a-f0-9]{64}$/);

      await revocaSessioniUtente(pool, invitatoId);
      const sessione = await pool.query<{ revocata_il: string | null }>('SELECT revocata_il FROM sessioni_backoffice WHERE id = $1', [sessioneId]);
      assert.ok(sessione.rows[0]!.revocata_il, 'la sessione precedente deve risultare revocata');

      const idInesistente = await impostaNuovoInvito(pool, '00000000-0000-0000-0000-000000000000');
      assert.equal(idInesistente, null);
    });

    await t.test('trovaUtentePerId legge i nuovi campi', async () => {
      const t2 = await trovaUtentePerId(pool, invitatoId);
      assert.equal(t2?.nome, 'Rinominato');
      assert.equal(t2?.creatoDa, primoAdminId);
    });
  },
);
```

- [ ] **Step 2: Eseguire il test, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/repository/utentiBackoffice.test.ts`
Expected: FAIL — le nuove funzioni non esistono, `creaUtenteInvitato`/`ErroreUltimoAdmin`/ecc. non definiti.

- [ ] **Step 3: Riscrivere `repository/utentiBackoffice.ts`**

```ts
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseError } from 'pg';
import type { Db } from '../db.ts';
import { hashPassword } from '../auth/password.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from '../erroriDominio.ts';

const TTL_TOKEN_INVITO_MS = 24 * 60 * 60 * 1000;

export class ErroreUltimoAdmin extends Error {}
export class ErroreTokenInvitoNonValido extends Error {}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface UtenteBackoffice {
  id: string;
  email: string;
  passwordHash: string;
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
  stato: 'attivo' | 'disattivato' | 'in_attesa_verifica';
  creatoDa: string | null;
  creatoIl: string;
  ultimoAccessoIl: string | null;
}

export interface UtenteBackofficePubblico {
  id: string;
  email: string;
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
  stato: 'attivo' | 'disattivato' | 'in_attesa_verifica';
  creatoDa: string | null;
  creatoIl: string;
  ultimoAccessoIl: string | null;
}

export function aPubblico(u: UtenteBackoffice): UtenteBackofficePubblico {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    cognome: u.cognome,
    ruolo: u.ruolo,
    stato: u.stato,
    creatoDa: u.creatoDa,
    creatoIl: u.creatoIl,
    ultimoAccessoIl: u.ultimoAccessoIl,
  };
}

interface RigaUtenteBackoffice {
  id: string;
  email: string;
  password_hash: string;
  nome: string;
  cognome: string;
  ruolo: string;
  stato: string;
  creato_da: string | null;
  creato_il: string;
  ultimo_accesso_il: string | null;
}

const COLONNE_SELECT = 'id, email, password_hash, nome, cognome, ruolo, stato, creato_da, creato_il, ultimo_accesso_il';

function daRiga(riga: RigaUtenteBackoffice): UtenteBackoffice {
  return {
    id: riga.id,
    email: riga.email,
    passwordHash: riga.password_hash,
    nome: riga.nome,
    cognome: riga.cognome,
    ruolo: riga.ruolo as UtenteBackoffice['ruolo'],
    stato: riga.stato as UtenteBackoffice['stato'],
    creatoDa: riga.creato_da,
    creatoIl: riga.creato_il,
    ultimoAccessoIl: riga.ultimo_accesso_il,
  };
}

export async function trovaUtentePerEmail(db: Db, email: string): Promise<UtenteBackoffice | null> {
  const risultato = await db.query<RigaUtenteBackoffice>(`SELECT ${COLONNE_SELECT} FROM utenti_backoffice WHERE email = $1`, [
    email,
  ]);
  const riga = risultato.rows[0];
  return riga ? daRiga(riga) : null;
}

export async function trovaUtentePerId(db: Db, id: string): Promise<UtenteBackoffice | null> {
  const risultato = await db.query<RigaUtenteBackoffice>(`SELECT ${COLONNE_SELECT} FROM utenti_backoffice WHERE id = $1`, [
    id,
  ]);
  const riga = risultato.rows[0];
  return riga ? daRiga(riga) : null;
}

export interface DatiCreaUtenteInvitato {
  email: string;
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
}

export async function creaUtenteInvitato(
  db: Db,
  dati: DatiCreaUtenteInvitato,
  creatoDa: string,
): Promise<{ utente: UtenteBackoffice; token: string }> {
  const token = randomBytes(32).toString('hex');
  // Sentinella non verificabile: nessuna password reale finché l'invito non è
  // completato. Irraggiungibile via login perché auth/login.ts blocca su stato
  // diverso da 'attivo' PRIMA di controllare la password.
  const passwordSentinella = await hashPassword(randomBytes(32).toString('hex'));
  try {
    const r = await db.query<RigaUtenteBackoffice>(
      `INSERT INTO utenti_backoffice
         (email, password_hash, nome, cognome, ruolo, stato, creato_da, token_verifica_hash, token_verifica_scade_il)
       VALUES ($1, $2, $3, $4, $5, 'in_attesa_verifica', $6, $7, $8)
       RETURNING ${COLONNE_SELECT}`,
      [
        dati.email,
        passwordSentinella,
        dati.nome,
        dati.cognome,
        dati.ruolo,
        creatoDa,
        hashToken(token),
        new Date(Date.now() + TTL_TOKEN_INVITO_MS),
      ],
    );
    return { utente: daRiga(r.rows[0]!), token };
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('esiste già un utente backoffice con questa email');
    }
    throw err;
  }
}

export async function listaUtenti(db: Db): Promise<UtenteBackoffice[]> {
  const r = await db.query<RigaUtenteBackoffice>(`SELECT ${COLONNE_SELECT} FROM utenti_backoffice ORDER BY creato_il`);
  return r.rows.map(daRiga);
}

async function contaAltriAdminAttivi(db: Db, idEscluso: string): Promise<number> {
  const r = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM utenti_backoffice WHERE ruolo = 'admin' AND stato = 'attivo' AND id <> $1`,
    [idEscluso],
  );
  return Number(r.rows[0]!.count);
}

export interface DatiAggiornaUtente {
  nome: string;
  cognome: string;
  ruolo: 'admin' | 'operatore';
}

export async function aggiornaUtente(db: Db, id: string, dati: DatiAggiornaUtente): Promise<UtenteBackoffice> {
  if (dati.ruolo === 'operatore') {
    const attuale = await trovaUtentePerId(db, id);
    if (!attuale) {
      throw new ErroreNonTrovato('utente non trovato');
    }
    if (attuale.ruolo === 'admin' && attuale.stato === 'attivo' && (await contaAltriAdminAttivi(db, id)) === 0) {
      throw new ErroreUltimoAdmin("non è possibile declassare l'ultimo admin attivo a operatore");
    }
  }
  const r = await db.query<RigaUtenteBackoffice>(
    `UPDATE utenti_backoffice SET nome = $2, cognome = $3, ruolo = $4 WHERE id = $1 RETURNING ${COLONNE_SELECT}`,
    [id, dati.nome, dati.cognome, dati.ruolo],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('utente non trovato');
  }
  return daRiga(riga);
}

export async function cambiaStatoUtente(
  db: Db,
  id: string,
  nuovoStato: 'attivo' | 'disattivato',
  chiamanteId: string,
): Promise<UtenteBackoffice> {
  if (id === chiamanteId) {
    throw new ErroreUltimoAdmin('non puoi modificare lo stato del tuo stesso account');
  }
  if (nuovoStato === 'disattivato') {
    const attuale = await trovaUtentePerId(db, id);
    if (!attuale) {
      throw new ErroreNonTrovato('utente non trovato');
    }
    if (attuale.ruolo === 'admin' && attuale.stato === 'attivo' && (await contaAltriAdminAttivi(db, id)) === 0) {
      throw new ErroreUltimoAdmin("non è possibile disattivare l'ultimo admin attivo");
    }
  }
  const r = await db.query<RigaUtenteBackoffice>(
    `UPDATE utenti_backoffice SET stato = $2 WHERE id = $1 RETURNING ${COLONNE_SELECT}`,
    [id, nuovoStato],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('utente non trovato');
  }
  return daRiga(riga);
}

export async function impostaNuovoInvito(db: Db, id: string): Promise<{ utente: UtenteBackoffice; token: string } | null> {
  const token = randomBytes(32).toString('hex');
  const r = await db.query<RigaUtenteBackoffice>(
    `UPDATE utenti_backoffice
     SET stato = 'in_attesa_verifica', token_verifica_hash = $2, token_verifica_scade_il = $3
     WHERE id = $1
     RETURNING ${COLONNE_SELECT}`,
    [id, hashToken(token), new Date(Date.now() + TTL_TOKEN_INVITO_MS)],
  );
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return { utente: daRiga(riga), token };
}

export async function completaInvito(db: Db, token: string, password: string): Promise<UtenteBackoffice> {
  const passwordHash = await hashPassword(password);
  const r = await db.query<RigaUtenteBackoffice>(
    `UPDATE utenti_backoffice
     SET stato = 'attivo', password_hash = $2, token_verifica_hash = NULL, token_verifica_scade_il = NULL
     WHERE token_verifica_hash = $1 AND stato = 'in_attesa_verifica' AND token_verifica_scade_il > now()
     RETURNING ${COLONNE_SELECT}`,
    [hashToken(token), passwordHash],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreTokenInvitoNonValido('token non valido o scaduto');
  }
  return daRiga(riga);
}
```
(sostituisce interamente il contenuto attuale del file)

- [ ] **Step 4: Aggiungere `revocaSessioniUtente` a `repository/sessioni.ts`**

Aggiungere in fondo al file (import `Db` da `../db.ts` da aggiungere alla riga di import esistente, insieme a `Pool`):
```ts
export async function revocaSessioniUtente(db: Db, utenteBackofficeId: string): Promise<void> {
  await db.query(
    'UPDATE sessioni_backoffice SET revocata_il = now() WHERE utente_backoffice_id = $1 AND revocata_il IS NULL',
    [utenteBackofficeId],
  );
}
```

- [ ] **Step 5: Eseguire il test, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/repository/utentiBackoffice.test.ts`
Expected: PASS.

- [ ] **Step 6: Verificare che `auth/login.ts` resti compatibile**

`auth/login.ts` chiama `trovaUtentePerEmail(pool, email)`/`trovaUtentePerId(pool, id)` — `Pool` soddisfa `Db`, nessuna modifica necessaria. Eseguire per conferma:
```
cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/auth/login.test.ts
```
Expected: PASS, invariato.

- [ ] **Step 7: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```

- [ ] **Step 8: Commit**

```bash
git add backend-node/src/repository/utentiBackoffice.ts backend-node/src/repository/utentiBackoffice.test.ts backend-node/src/repository/sessioni.ts
git commit -m "feat(backend): repository utenti backoffice — invito, lista, modifica, cambio stato, reset, completamento (protezione ultimo admin)"
```

---

### Task 2: `POST /backoffice/utenti` (invito) + `GET` lista/dettaglio

**Files:**
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`

**Interfaces:**
- Consumes: `creaUtenteInvitato`, `listaUtenti`, `trovaUtentePerId`, `aPubblico`, `ErroreValoreDuplicato` (già in `erroriDominio.ts`) da `./repository/utentiBackoffice.ts` (Task 1); `inviaEmailFn`/`backofficeBaseUrl` (già in closure di `creaApp`, stesso pattern del bootstrap).
- Produces: `schemaCreaUtenteBackoffice` (zod); route `POST /backoffice/utenti`, `GET /backoffice/utenti`, `GET /backoffice/utenti/:id`.

- [ ] **Step 1: Aggiungere lo schema zod**

Aggiungere a `backend-node/src/backofficeSchema.ts`:
```ts
export const schemaCreaUtenteBackoffice = z.object({
  email: z.string().email(),
  nome: z.string().min(1),
  cognome: z.string().min(1),
  ruolo: z.enum(['admin', 'operatore']),
});
export type CreaUtenteBackofficeRequest = z.infer<typeof schemaCreaUtenteBackoffice>;
```

- [ ] **Step 2: Scrivere gli scenari HTTP RED**

Aggiungere a `backend-node/src/server.backoffice.test.ts` (riusa `avviaServerTest`/`creaUtenteBackofficeTest` già definiti in cima al file):
```ts
test(
  'POST/GET /backoffice/utenti: invito, lista, dettaglio',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const admin = await creaUtenteBackofficeTest(pool, 'admin');
    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');

    await t.test('operatore: 403', async () => {
      const r = await fetch(`${base}/backoffice/utenti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ email: 'x@test.local', nome: 'X', cognome: 'Y', ruolo: 'operatore' }),
      });
      assert.equal(r.status, 403);
    });

    const emailInvitato = `invitato-http-${randomUUID()}@test.local`;
    await t.test('admin: crea invito, 201, stato in_attesa_verifica, nessun campo sensibile', async () => {
      const r = await fetch(`${base}/backoffice/utenti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ email: emailInvitato, nome: 'Nuovo', cognome: 'Invitato', ruolo: 'operatore' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as Record<string, unknown>;
      assert.equal(body.stato, 'in_attesa_verifica');
      assert.equal('passwordHash' in body, false);
      assert.equal('tokenVerificaHash' in body, false);
    });

    await t.test('email duplicata: 409', async () => {
      const r = await fetch(`${base}/backoffice/utenti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ email: emailInvitato, nome: 'Dup', cognome: 'Licato', ruolo: 'operatore' }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('GET lista: include l\'invitato, nessun campo sensibile', async () => {
      const r = await fetch(`${base}/backoffice/utenti`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 200);
      const lista = (await r.json()) as Array<Record<string, unknown>>;
      const trovato = lista.find((u) => u.email === emailInvitato);
      assert.ok(trovato);
      assert.equal('passwordHash' in trovato!, false);
    });

    await t.test('GET dettaglio inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/utenti/${randomUUID()}`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 404);
    });

    await t.test('GET dettaglio id malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/utenti/non-un-uuid`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 400);
    });
  },
);
```
(aggiungere `import { randomUUID } from 'node:crypto';` in cima al file se non già presente)

- [ ] **Step 3: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: FAIL — 404 sulle rotte non wired.

- [ ] **Step 4: Wire delle route in `server.ts`**

Import da aggiungere:
```ts
import {
  creaUtenteInvitato,
  listaUtenti,
  trovaUtentePerId,
  aPubblico,
} from './repository/utentiBackoffice.ts';
```
E aggiungere `schemaCreaUtenteBackoffice` alla riga di import esistente da `./backofficeSchema.ts`.

Route (dopo l'ultima route esistente, prima di `return app; }`):
```ts
  app.post(
    '/backoffice/utenti',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaUtenteBackoffice.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      if (!inviaEmailFn || !backofficeBaseUrl) {
        res.status(503).json({ errore: 'SMTP non configurato (SMTP_HOST/BACKOFFICE_BASE_URL in .env)' });
        return;
      }
      try {
        const utente = await eseguiInTransazione(pool, async (client) => {
          const { utente: u, token } = await creaUtenteInvitato(client, parsed.data, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: u.id,
            dettaglio: { email: u.email, nome: u.nome, cognome: u.cognome, ruolo: u.ruolo },
          });
          await inviaEmailFn({
            a: u.email,
            oggetto: 'POLARIS — invito account backoffice',
            testo: [
              `Buongiorno ${u.nome} ${u.cognome},`,
              '',
              'è stato creato per lei un account sul backoffice POLARIS. Per attivarlo e impostare la password apra questo link:',
              '',
              `${backofficeBaseUrl}/utenti/accetta-invito?token=${token}`,
              '',
              'Il link scade tra 24 ore.',
            ].join('\n'),
          });
          return u;
        });
        res.status(201).json(aPubblico(utente));
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

  app.get('/backoffice/utenti', richiedeAutenticazione, richiedeRuolo('admin'), async (_req, res) => {
    try {
      res.status(200).json((await listaUtenti(pool)).map(aPubblico));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/utenti/:id', richiedeAutenticazione, richiedeRuolo('admin'), async (req, res) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const utente = await trovaUtentePerId(pool, id);
      if (!utente) {
        res.status(404).json({ errore: 'utente non trovato' });
        return;
      }
      res.status(200).json(aPubblico(utente));
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });
```
Nota: `inviaEmailFn`/`backofficeBaseUrl` sono già variabili nello scope di `creaApp` (usate dalla route bootstrap esistente) — non serve reimportarle o ridefinirle.

- [ ] **Step 5: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/backofficeSchema.ts backend-node/src/server.ts backend-node/src/server.backoffice.test.ts
git commit -m "feat(backend): POST/GET /backoffice/utenti (invito via email, lista, dettaglio)"
```

---

### Task 3: `PUT /backoffice/utenti/:id` + `PUT /backoffice/utenti/:id/stato`

**Files:**
- Modify: `backend-node/src/backofficeSchema.ts`
- Modify: `backend-node/src/server.ts`
- Modify: `backend-node/src/server.backoffice.test.ts`

**Interfaces:**
- Consumes: `aggiornaUtente`, `cambiaStatoUtente`, `ErroreUltimoAdmin` da `./repository/utentiBackoffice.ts` (Task 1); `ErroreNonTrovato` (già importato in `server.ts`).
- Produces: `schemaAggiornaUtenteBackoffice`, `schemaCambiaStatoUtenteBackoffice` (zod); route `PUT /backoffice/utenti/:id`, `PUT /backoffice/utenti/:id/stato`.

- [ ] **Step 1: Aggiungere gli schemi zod**

Aggiungere a `backend-node/src/backofficeSchema.ts`:
```ts
export const schemaAggiornaUtenteBackoffice = z.object({
  nome: z.string().min(1),
  cognome: z.string().min(1),
  ruolo: z.enum(['admin', 'operatore']),
});
export type AggiornaUtenteBackofficeRequest = z.infer<typeof schemaAggiornaUtenteBackoffice>;

export const schemaCambiaStatoUtenteBackoffice = z.object({
  stato: z.enum(['attivo', 'disattivato']),
});
export type CambiaStatoUtenteBackofficeRequest = z.infer<typeof schemaCambiaStatoUtenteBackoffice>;
```

- [ ] **Step 2: Scrivere gli scenari HTTP RED**

Aggiungere a `backend-node/src/server.backoffice.test.ts`:
```ts
test(
  'PUT /backoffice/utenti/:id e /:id/stato: modifica, protezione ultimo admin',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const admin = await creaUtenteBackofficeTest(pool, 'admin');
    const secondoAdmin = await creaUtenteBackofficeTest(pool, 'admin');
    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');

    await t.test('operatore: 403 su entrambe', async () => {
      const r1 = await fetch(`${base}/backoffice/utenti/${operatore.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ nome: 'X', cognome: 'Y', ruolo: 'operatore' }),
      });
      assert.equal(r1.status, 403);
      const r2 = await fetch(`${base}/backoffice/utenti/${operatore.id}/stato`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ stato: 'disattivato' }),
      });
      assert.equal(r2.status, 403);
    });

    await t.test('admin aggiorna anagrafica operatore: 200', async () => {
      const r = await fetch(`${base}/backoffice/utenti/${operatore.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome: 'Rinominato', cognome: 'Cognome', ruolo: 'operatore' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { nome: string };
      assert.equal(body.nome, 'Rinominato');
    });

    await t.test('admin disattiva se stesso: 409', async () => {
      const r = await fetch(`${base}/backoffice/utenti/${admin.id}/stato`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ stato: 'disattivato' }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('secondoAdmin disattiva operatore: 200 (non è l\'ultimo admin, non è auto-modifica)', async () => {
      const r = await fetch(`${base}/backoffice/utenti/${operatore.id}/stato`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secondoAdmin.token}` },
        body: JSON.stringify({ stato: 'disattivato' }),
      });
      assert.equal(r.status, 200);
    });

    await t.test('id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/utenti/${randomUUID()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome: 'X', cognome: 'Y', ruolo: 'operatore' }),
      });
      assert.equal(r.status, 404);
    });
  },
);
```

- [ ] **Step 3: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: FAIL — 404 sulle rotte non wired.

- [ ] **Step 4: Wire delle route in `server.ts`**

Import da aggiungere: `aggiornaUtente, cambiaStatoUtente, ErroreUltimoAdmin` alla riga di import esistente da `./repository/utentiBackoffice.ts`; `schemaAggiornaUtenteBackoffice, schemaCambiaStatoUtenteBackoffice` alla riga da `./backofficeSchema.ts`.

Route:
```ts
  app.put(
    '/backoffice/utenti/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaUtenteBackoffice.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const utente = await eseguiInTransazione(pool, async (client) => {
          const u = await aggiornaUtente(client, id, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'aggiorna_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: u.id,
            dettaglio: { nome: u.nome, cognome: u.cognome, ruolo: u.ruolo },
          });
          return u;
        });
        res.status(200).json(aPubblico(utente));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreUltimoAdmin) {
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
    '/backoffice/utenti/:id/stato',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCambiaStatoUtenteBackoffice.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const utente = await eseguiInTransazione(pool, async (client) => {
          const u = await cambiaStatoUtente(client, id, parsed.data.stato, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'cambia_stato_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: u.id,
            dettaglio: { stato: u.stato },
          });
          return u;
        });
        res.status(200).json(aPubblico(utente));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreUltimoAdmin) {
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

- [ ] **Step 5: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.backoffice.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/backofficeSchema.ts backend-node/src/server.ts backend-node/src/server.backoffice.test.ts
git commit -m "feat(backend): PUT /backoffice/utenti/:id e /:id/stato (protezione ultimo admin e auto-modifica)"
```

---

### Task 4: `POST /backoffice/utenti/:id/reset-password` + `POST /backoffice/utenti/accetta-invito`

**Files:**
- Modify: `backend-node/src/auth/schema.ts`
- Modify: `backend-node/src/server.ts`
- Create: `backend-node/src/server.utentiBackoffice.test.ts`

**Interfaces:**
- Consumes: `impostaNuovoInvito`, `completaInvito`, `ErroreTokenInvitoNonValido` da `./repository/utentiBackoffice.ts` (Task 1); `revocaSessioniUtente` da `./repository/sessioni.ts` (Task 1); `generaAccessToken` da `./auth/jwt.ts` (per il test, login post-attivazione).
- Produces: `schemaAccettaInvitoUtente` (zod, in `auth/schema.ts` — è un endpoint pubblico affine al bootstrap, non al CRUD backoffice); route `POST /backoffice/utenti/:id/reset-password`, `POST /backoffice/utenti/accetta-invito`.

- [ ] **Step 1: Aggiungere lo schema zod**

Aggiungere a `backend-node/src/auth/schema.ts` (stesso file di `schemaBootstrapVerifica`, stesso pattern):
```ts
export const schemaAccettaInvitoUtente = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(12),
});
export type AccettaInvitoUtenteRequest = z.infer<typeof schemaAccettaInvitoUtente>;
```

- [ ] **Step 2: Scrivere gli scenari HTTP RED**

`backend-node/src/server.utentiBackoffice.test.ts` (nuovo file, ciclo completo end-to-end: crea invito → estrae token dall'email catturata → accetta invito → login funziona; poi reset password → vecchia sessione revocata):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { hashPassword } from './auth/password.ts';
import { generaAccessToken } from './auth/jwt.ts';
import type { Email } from './email/smtp.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

function estraiToken(email: Email): string {
  const m = email.testo.match(/token=([a-f0-9]{64})/);
  assert.ok(m, `nessun token nel corpo email: ${email.testo}`);
  return m[1]!;
}

test(
  'ciclo completo: invito -> accetta-invito -> login funziona; reset-password -> vecchia sessione revocata',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const emailInviate: Email[] = [];
    const app = creaApp(pool, {
      inviaEmail: async (e) => {
        emailInviate.push(e);
      },
      backofficeBaseUrl: 'https://backoffice.test',
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    t.after(() => {
      server.close();
      return pool.end();
    });

    const emailAdmin = `admin-reset-test-${randomUUID()}@test.local`;
    const hash = await hashPassword('password-admin-test-123456');
    const rAdmin = await pool.query<{ id: string }>(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, $2, 'Admin', 'Reset', 'admin', 'attivo') RETURNING id`,
      [emailAdmin, hash],
    );
    const adminToken = generaAccessToken({ sub: rAdmin.rows[0]!.id, email: emailAdmin, ruolo: 'admin' });

    const emailInvitato = `invitato-reset-test-${randomUUID()}@test.local`;

    await t.test('crea invito, estrai token, completa invito, login funziona', async () => {
      const rInvito = await fetch(`${base}/backoffice/utenti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ email: emailInvitato, nome: 'Invitato', cognome: 'Test', ruolo: 'operatore' }),
      });
      assert.equal(rInvito.status, 201);
      assert.equal(emailInviate.length, 1);
      const token = estraiToken(emailInviate[0]!);

      const rAccetta = await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'password-invitato-123456' }),
      });
      assert.equal(rAccetta.status, 200);

      const rLogin = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInvitato, password: 'password-invitato-123456' }),
      });
      assert.equal(rLogin.status, 200);
    });

    await t.test('token già usato: 400/401 al riuso', async () => {
      const rInvito = await fetch(`${base}/backoffice/utenti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ email: `secondo-${emailInvitato}`, nome: 'X', cognome: 'Y', ruolo: 'operatore' }),
      });
      const token = estraiToken(emailInviate[emailInviate.length - 1]!);
      await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'password-una-volta-123456' }),
      });
      const riuso = await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'altra-password-123456' }),
      });
      assert.equal(riuso.status, 400);
      void rInvito;
    });

    await t.test('operatore: 403 su reset-password altrui', async () => {
      const rLoginInvitato = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInvitato, password: 'password-invitato-123456' }),
      });
      const { accessToken } = (await rLoginInvitato.json()) as { accessToken: string };
      const r = await fetch(`${base}/backoffice/utenti/${rAdmin.rows[0]!.id}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      assert.equal(r.status, 403);
    });

    await t.test('admin richiede reset password per l\'invitato: nuova email, vecchie sessioni revocate', async () => {
      const rLoginInvitato = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInvitato, password: 'password-invitato-123456' }),
      });
      const { refreshToken: refreshVecchio } = (await rLoginInvitato.json()) as { refreshToken: string };

      const utenteInvitato = await pool.query<{ id: string }>('SELECT id FROM utenti_backoffice WHERE email = $1', [emailInvitato]);
      const rReset = await fetch(`${base}/backoffice/utenti/${utenteInvitato.rows[0]!.id}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(rReset.status, 200);

      const rRefresh = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshVecchio }),
      });
      assert.equal(rRefresh.status, 401, 'il refresh token emesso prima del reset deve risultare revocato');

      const token = estraiToken(emailInviate[emailInviate.length - 1]!);
      const rNuovoAccesso = await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'password-dopo-reset-123456' }),
      });
      assert.equal(rNuovoAccesso.status, 200);
    });

    await t.test('reset-password su id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/utenti/${randomUUID()}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('accetta-invito con token malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/utenti/accetta-invito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'non-esadecimale', password: 'password-lunga-123456' }),
      });
      assert.equal(r.status, 400);
    });
  },
);
```
Verificare prima di scrivere questo test la forma esatta della risposta di `POST /auth/login` (`accessToken`/`refreshToken` come chiavi) e di `POST /auth/refresh` (body atteso, es. `{refreshToken}`) leggendo `backend-node/src/server.ts` e `backend-node/src/auth/login.test.ts` — adattare i nomi dei campi sopra se differiscono da quanto assunto qui.

- [ ] **Step 3: Eseguire, verificare RED**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.utentiBackoffice.test.ts`
Expected: FAIL — 404 sulle rotte non wired.

- [ ] **Step 4: Wire delle route in `server.ts`**

Import da aggiungere: `impostaNuovoInvito, completaInvito, ErroreTokenInvitoNonValido` alla riga di import esistente da `./repository/utentiBackoffice.ts`; `revocaSessioniUtente` da `./repository/sessioni.ts`; `schemaAccettaInvitoUtente` alla riga di import esistente da `./auth/schema.ts`.

Route:
```ts
  app.post(
    '/backoffice/utenti/:id/reset-password',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      if (!inviaEmailFn || !backofficeBaseUrl) {
        res.status(503).json({ errore: 'SMTP non configurato (SMTP_HOST/BACKOFFICE_BASE_URL in .env)' });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const risultato = await eseguiInTransazione(pool, async (client) => {
          const esito = await impostaNuovoInvito(client, id);
          if (!esito) {
            return null;
          }
          await revocaSessioniUtente(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'richiedi_reset_password_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: id,
          });
          return esito;
        });
        if (!risultato) {
          res.status(404).json({ errore: 'utente non trovato' });
          return;
        }
        await inviaEmailFn({
          a: risultato.utente.email,
          oggetto: 'POLARIS — reimposta la password del tuo account backoffice',
          testo: [
            `Buongiorno ${risultato.utente.nome} ${risultato.utente.cognome},`,
            '',
            'è stato richiesto un reset della password del suo account backoffice POLARIS. Per impostarne una nuova apra questo link:',
            '',
            `${backofficeBaseUrl}/utenti/accetta-invito?token=${risultato.token}`,
            '',
            'Il link scade tra 24 ore. Le sessioni attive precedenti sono state disconnesse.',
          ].join('\n'),
        });
        res.status(200).json(aPubblico(risultato.utente));
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

  app.post('/backoffice/utenti/accetta-invito', limitatoreLogin, async (req, res) => {
    const parsed = schemaAccettaInvitoUtente.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      const utente = await eseguiInTransazione(pool, async (client) => {
        const u = await completaInvito(client, parsed.data.token, parsed.data.password);
        await registraOperazione(client, {
          attore: { tipo: 'backoffice', utenteBackofficeId: u.id, ruolo: u.ruolo },
          azione: 'accetta_invito_utente_backoffice',
          entitaTipo: 'utenti_backoffice',
          entitaId: u.id,
        });
        return u;
      });
      res.status(200).json(aPubblico(utente));
    } catch (err) {
      if (err instanceof ErroreTokenInvitoNonValido) {
        res.status(400).json({ errore: err.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });
```
Nota: `limitatoreLogin` (rate limiter già esistente, usato dal bootstrap) riusato su `accetta-invito` perché è un endpoint pubblico non autenticato — stessa protezione volumetrica del resto degli endpoint pubblici sensibili.

- [ ] **Step 5: Eseguire, verificare GREEN**

Run: `cd backend-node && TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" node --test src/server.utentiBackoffice.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + suite intera**

```bash
cd backend-node
./node_modules/.bin/tsc
TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/palestre" npm test
```
Expected: pulito, nessuna regressione.

- [ ] **Step 7: Commit**

```bash
git add backend-node/src/auth/schema.ts backend-node/src/server.ts backend-node/src/server.utentiBackoffice.test.ts
git commit -m "feat(backend): reset password + accettazione invito utenti backoffice (POST /backoffice/utenti/:id/reset-password, /accetta-invito)"
```

---

### Task 5: Aggiornare la documentazione di progetto

**Files:**
- Modify: `docs/SPEC.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Aggiornare `docs/SPEC.md`**

Nella sezione Fase 4, item 3 (già corretto per OIDC nel blocco precedente), aggiungere che anche "utenti backoffice" è ora fatto: endpoint, meccanismo invito, protezione ultimo admin. Nella sezione "5. Contratto API", spostare `POST /backoffice/utenti`, `GET /backoffice/utenti`, `GET /backoffice/utenti/:id`, `PUT /backoffice/utenti/:id`, `PUT /backoffice/utenti/:id/stato`, `POST /backoffice/utenti/:id/reset-password`, `POST /backoffice/utenti/accetta-invito` da "Previste" a "Esistenti" (o aggiungerli se non già elencati).

- [ ] **Step 2: Aggiornare `CLAUDE.md`**

Nella sezione "Backend Node", dopo il blocco "Fatto — Flusso pubblico" o "Fatto — impostazioni OIDC" (qualunque sia l'ultimo), aggiungere un blocco "Fatto — CRUD utenti backoffice" che descrive: riuso delle colonne `token_verifica_hash`/`token_verifica_scade_il` (nessuna migration), meccanismo invito (nessuna password scelta dall'admin), protezione ultimo admin (disattivazione e declassamento), reset password con revoca sessioni. Includere eventuali gotcha reali incontrati durante l'esecuzione del piano (da scrivere quando effettivamente trovati).

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md CLAUDE.md
git commit -m "docs: mark backoffice users CRUD block done"
```

---

## Self-Review (fatto in fase di scrittura del piano)

**Copertura spec**: invito senza password scelta dall'admin ✅ (Task 1/2), lista/dettaglio senza campi sensibili ✅ (Task 2), modifica anagrafica/ruolo ✅ (Task 3), protezione ultimo admin su disattivazione e declassamento ✅ (Task 1/3), auto-modifica vietata ✅ (Task 1/3), reset password con revoca sessioni ✅ (Task 1/4), accettazione invito pubblica con token one-shot ✅ (Task 1/4).

**Placeholder**: nessun TBD/TODO nei passi di codice. La nota nel Task 4 Step 2 ("verificare la forma esatta della risposta di `/auth/login`/`/auth/refresh`") è una verifica puntuale contro codice esistente prima di scrivere il test, non un'ambiguità di design.

**Coerenza tipi**: `UtenteBackoffice`/`UtenteBackofficePubblico`/`ErroreUltimoAdmin`/`ErroreTokenInvitoNonValido` definiti una sola volta nel Task 1 e riusati identici nei Task 2-4. `aPubblico()` è l'unico punto che produce la forma esposta via HTTP, riusato da tutte e 4 le route che restituiscono un utente (crea, lista, dettaglio, aggiorna, cambia-stato, reset-password, accetta-invito) — nessuna serializzazione manuale duplicata altrove.
