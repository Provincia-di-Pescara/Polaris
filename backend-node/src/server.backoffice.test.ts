import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { hashPassword } from './auth/password.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { creaAssociazione } from './associazioni.ts';
import { creaAbilitazionePrincipale } from './abilitazioni.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { leggiConfigOidc } from './oidc/config.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

// inviaEmail/backofficeBaseUrl iniettati con un default no-op: la maggior parte degli
// scenari CRUD di questo file non tocca l'email, ma la route di invito utenti (Task 2)
// ne ha bisogno per non rispondere 503 — nessun SMTP_HOST reale nell'ambiente di test.
async function avviaServerTest(
  pool: Pool,
  emailInviate: Array<{ a: string; oggetto: string; testo: string }> = [],
): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool, {
    inviaEmail: async (email) => {
      emailInviate.push(email);
    },
    backofficeBaseUrl: 'https://backoffice.test',
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteBackofficeTest(
  pool: Pool,
  ruolo: 'admin' | 'operatore',
): Promise<{ id: string; token: string }> {
  const email = `backoffice-crud-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'CRUD', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessToken({ sub: id, email, ruolo });
  return { id, token };
}

test(
  'CRUD backoffice: discipline sportive (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const codice = `TST-${randomUUID().slice(0, 8).toUpperCase()}`;

    await t.test('senza token: 401', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, { method: 'GET' });
      assert.equal(r.status, 401);
    });

    await t.test('operatore crea una disciplina: 201, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ codice, denominazione: 'Pallavolo Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { codice: string; denominazione: string };
      assert.equal(body.codice, codice);

      const log = await pool.query(
        `SELECT azione, entita_tipo, entita_id FROM log_operazioni
         WHERE utente_backoffice_id = $1 AND azione = 'crea_disciplina_sportiva'`,
        [operatore.id],
      );
      assert.equal(log.rows.length, 1);
      assert.equal(log.rows[0]!.entita_tipo, 'discipline_sportive');
      assert.equal(log.rows[0]!.entita_id, null);
    });

    await t.test('lista include la disciplina creata', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
      const lista = (await r.json()) as { codice: string }[];
      assert.ok(lista.some((d) => d.codice === codice));
    });

    await t.test('creazione con codice duplicato: 409', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ codice, denominazione: 'Altra' }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('body malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/discipline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Senza codice' }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('aggiorna denominazione: 200, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/discipline/${codice}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Nuovo Nome' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'Nuovo Nome');

      const log = await pool.query(
        `SELECT 1 FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'aggiorna_disciplina_sportiva'`,
        [operatore.id],
      );
      assert.equal(log.rows.length, 1);
    });

    await t.test('aggiorna codice inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/discipline/NON-ESISTE-${randomUUID()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'X' }),
      });
      assert.equal(r.status, 404);
    });
  },
);

test(
  'CRUD backoffice: istituzioni scolastiche (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const admin = await creaUtenteBackofficeTest(pool, 'admin');
    let istituzioneId = '';

    await t.test('admin crea un\'istituzione: 201, log_operazioni scritto', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ denominazione: 'IIS Backoffice Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; denominazione: string };
      istituzioneId = body.id;
      assert.ok(istituzioneId);

      const log = await pool.query(
        `SELECT entita_id FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'crea_istituzione_scolastica'`,
        [admin.id],
      );
      assert.equal(log.rows[0]!.entita_id, istituzioneId);
    });

    await t.test('lista include l\'istituzione creata', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni`, { headers: { Authorization: `Bearer ${admin.token}` } });
      const lista = (await r.json()) as { id: string }[];
      assert.ok(lista.some((i) => i.id === istituzioneId));
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${istituzioneId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'IIS Backoffice Test');
    });

    await t.test('get per id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${randomUUID()}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('aggiorna: 200', async () => {
      const r = await fetch(`${base}/backoffice/istituzioni/${istituzioneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ denominazione: 'IIS Rinominato' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { denominazione: string };
      assert.equal(body.denominazione, 'IIS Rinominato');
    });
  },
);

test(
  'CRUD backoffice: impianti (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    let impiantoId = '';

    await t.test('crea impianto senza istituzione: 201', async () => {
      const r = await fetch(`${base}/backoffice/impianti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Palestra HTTP Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string };
      impiantoId = body.id;
    });

    await t.test('istituzioneScolasticaId non valida (non uuid): 400', async () => {
      const r = await fetch(`${base}/backoffice/impianti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'X', istituzioneScolasticaId: 'non-un-uuid' }),
      });
      assert.equal(r.status, 400);
    });

    // Finding 3 (review whole-branch): un UUID sintatticamente valido ma che non esiste in
    // istituzioni_scolastiche violava la FK a runtime (23503) e faceva trapelare un 500 con
    // l'errore Postgres grezzo, invece di un 400 leggibile — id ben formato ma dominio
    // sbagliato, zod da solo non può accorgersene senza un round-trip sul DB.
    await t.test('istituzioneScolasticaId valida ma inesistente (FK violation): 400, non 500', async () => {
      const r = await fetch(`${base}/backoffice/impianti`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Palestra FK Inesistente', istituzioneScolasticaId: randomUUID() }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
    });

    await t.test('aggiorna: 200', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Palestra Rinominata' }),
      });
      assert.equal(r.status, 200);
    });
  },
);

test(
  'CRUD backoffice: spazi sportivi (server vero, ruolo)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const impianto = await pool.query<{ id: string }>(
      `INSERT INTO impianti (denominazione) VALUES ('Impianto Spazi HTTP') RETURNING id`,
    );
    const impiantoId = impianto.rows[0]!.id;
    let spazioId = '';

    await t.test('crea uno spazio dentro l\'impianto: 201', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}/spazi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Campo HTTP Test' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; impiantoId: string };
      spazioId = body.id;
      assert.equal(body.impiantoId, impiantoId);
    });

    await t.test('lista spazi dell\'impianto', async () => {
      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}/spazi`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      const lista = (await r.json()) as { id: string }[];
      assert.ok(lista.some((s) => s.id === spazioId));
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/spazi/${spazioId}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r.status, 200);
    });

    // Finding 3 (review whole-branch): un path param non-UUID (es. digitato a mano, o un
    // link rotto) fa fallire il cast implicito $1::uuid lato Postgres (22P02) — senza
    // gestione, era un 500 con l'errore Postgres grezzo esposto al client.
    await t.test('get con id malformato (non uuid): 400, non 500', async () => {
      const r = await fetch(`${base}/backoffice/spazi/not-a-uuid`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 400);
    });

    await t.test('aggiorna: 200', async () => {
      const r = await fetch(`${base}/backoffice/spazi/${spazioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Campo Rinominato' }),
      });
      assert.equal(r.status, 200);
    });

    await t.test('aggiorna omettendo disciplineCompatibili preserva le discipline esistenti', async () => {
      const discipline = await pool.query<{ codice: string }>(
        `INSERT INTO discipline_sportive (codice, denominazione) VALUES
         ('HTTPD1-${randomUUID().slice(0, 6)}', 'HTTP Disciplina 1'),
         ('HTTPD2-${randomUUID().slice(0, 6)}', 'HTTP Disciplina 2')
         RETURNING codice`,
      );
      const d1 = discipline.rows[0]!.codice;
      const d2 = discipline.rows[1]!.codice;

      const r = await fetch(`${base}/backoffice/impianti/${impiantoId}/spazi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Campo Con Discipline', disciplineCompatibili: [d1, d2] }),
      });
      assert.equal(r.status, 201);
      const spazio = (await r.json()) as { id: string; disciplineCompatibili: string[] };
      const spazioIdOmit = spazio.id;
      assert.deepEqual([...spazio.disciplineCompatibili].sort(), [d1, d2].sort());

      const rUpdate = await fetch(`${base}/backoffice/spazi/${spazioIdOmit}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ denominazione: 'Campo Rinominato Omit' }),
      });
      assert.equal(rUpdate.status, 200);
      const aggiornato = (await rUpdate.json()) as { disciplineCompatibili: string[] };
      assert.deepEqual([...aggiornato.disciplineCompatibili].sort(), [d1, d2].sort());
    });
  },
);

test(
  'CRUD backoffice: slot settimana tipo (server vero, ruolo, conflitto EXCLUDE)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2036-09-01', '2037-06-30') RETURNING id`,
      [`slot-http-${randomUUID()}`],
    );
    const stagioneId = stagione.rows[0]!.id;
    const impianto = await pool.query<{ id: string }>(`INSERT INTO impianti (denominazione) VALUES ('Impianto Slot HTTP') RETURNING id`);
    const spazio = await pool.query<{ id: string }>(
      `INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, 'Campo Slot HTTP') RETURNING id`,
      [impianto.rows[0]!.id],
    );
    const spazioId = spazio.rows[0]!.id;
    let slotId = '';

    await t.test('crea slot dentro la stagione: 201', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ spazioId, giornoSettimana: 1, orarioInizio: '16:30', orarioFine: '18:00' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; durataMinuti: number };
      slotId = body.id;
      assert.equal(body.durataMinuti, 90);
    });

    await t.test('crea slot sovrapposto: 409', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ spazioId, giornoSettimana: 1, orarioInizio: '17:00', orarioFine: '19:00' }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('orario malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ spazioId, giornoSettimana: 1, orarioInizio: '25:99', orarioFine: '18:00' }),
      });
      assert.equal(r.status, 400);
    });

    // Finding 3 (review whole-branch): orarioInizio >= orarioFine violava il CHECK
    // slot_orario_valido a livello DB (23514) — catturato ora da zod .refine() prima di
    // arrivare a Postgres, quindi 400 invece di un 500 con l'errore Postgres grezzo.
    await t.test('orarioInizio dopo orarioFine: 400 (refine zod, non 23514/500 da Postgres)', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ spazioId, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '16:30' }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('lista slot della stagione', async () => {
      const r = await fetch(`${base}/backoffice/stagioni/${stagioneId}/slot`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      const lista = (await r.json()) as { id: string }[];
      assert.ok(lista.some((s) => s.id === slotId));
    });

    await t.test('get per id', async () => {
      const r = await fetch(`${base}/backoffice/slot/${slotId}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r.status, 200);
    });

    await t.test('aggiorna marcando indisponibile_permanente: 200', async () => {
      const r = await fetch(`${base}/backoffice/slot/${slotId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({
          giornoSettimana: 1,
          orarioInizio: '16:30',
          orarioFine: '18:00',
          pregiata: false,
          indisponibilePermanente: true,
        }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { indisponibilePermanente: boolean };
      assert.equal(body.indisponibilePermanente, true);
    });
  },
);

test(
  'creazione stagioni: solo admin (server vero)',
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

    await t.test('admin crea una stagione: 201, log_operazioni scritto', async () => {
      const nome = `stagione-http-${randomUUID()}`;
      const r = await fetch(`${base}/backoffice/stagioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome, dataInizio: '2039-09-01', dataFine: '2040-06-30' }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; nome: string };
      assert.equal(body.nome, nome);

      const log = await pool.query(
        `SELECT entita_id FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'crea_stagione'`,
        [admin.id],
      );
      assert.equal(log.rows[0]!.entita_id, body.id);
    });

    await t.test('operatore NON può creare una stagione: 403', async () => {
      const r = await fetch(`${base}/backoffice/stagioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ nome: `stagione-vietata-${randomUUID()}`, dataInizio: '2040-09-01', dataFine: '2041-06-30' }),
      });
      assert.equal(r.status, 403);
    });

    // Finding 3 (review whole-branch): dataInizio >= dataFine violava il CHECK
    // stagioni_date_valide a livello DB (23514) — catturato ora da zod .refine(), 400
    // invece di un 500 con l'errore Postgres grezzo.
    await t.test('dataInizio dopo dataFine: 400 (refine zod, non 23514/500 da Postgres)', async () => {
      const r = await fetch(`${base}/backoffice/stagioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome: `stagione-date-invertite-${randomUUID()}`, dataInizio: '2042-06-30', dataFine: '2042-01-01' }),
      });
      assert.equal(r.status, 400);
    });

    // Finding 4 (review whole-branch): stagioni_sportive_nome_uq (UNIQUE su nome) non era
    // mappato su ErroreValoreDuplicato/409 come le altre entità con vincolo UNIQUE
    // (istituzioni.codice_meccanografico, discipline.codice) — creaStagione lasciava
    // trapelare un 23505 come 500 grezzo.
    await t.test('nome stagione duplicato: 409, non 500', async () => {
      const nome = `stagione-duplicata-${randomUUID()}`;
      const primaRisposta = await fetch(`${base}/backoffice/stagioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome, dataInizio: '2043-09-01', dataFine: '2044-06-30' }),
      });
      assert.equal(primaRisposta.status, 201);

      const secondaRisposta = await fetch(`${base}/backoffice/stagioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome, dataInizio: '2044-09-01', dataFine: '2045-06-30' }),
      });
      assert.equal(secondaRisposta.status, 409);
    });
  },
);

test(
  'PUT/DELETE /backoffice/stagioni/:id: solo admin, solo in censimento',
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

    async function creaStagioneFixture(): Promise<{ id: string; nome: string }> {
      const nome = `stagione-put-http-${randomUUID()}`;
      const r = await fetch(`${base}/backoffice/stagioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome, dataInizio: '2070-09-01', dataFine: '2071-06-30' }),
      });
      const body = (await r.json()) as { id: string; nome: string };
      return body;
    }

    await t.test('admin, PUT: 200, log_operazioni scritto', async () => {
      const s = await creaStagioneFixture();
      const nomeAggiornato = `${s.nome}-rinominata`;
      const r = await fetch(`${base}/backoffice/stagioni/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome: nomeAggiornato, dataInizio: '2070-09-15', dataFine: '2071-07-15' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { nome: string };
      assert.equal(body.nome, nomeAggiornato);

      const log = await pool.query(
        `SELECT entita_id FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'aggiorna_stagione' AND entita_id = $2`,
        [admin.id, s.id],
      );
      assert.equal(log.rowCount, 1);
    });

    await t.test('operatore, PUT/DELETE: 403 su entrambe', async () => {
      const s = await creaStagioneFixture();
      const rPut = await fetch(`${base}/backoffice/stagioni/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ nome: s.nome, dataInizio: '2070-09-01', dataFine: '2071-06-30' }),
      });
      assert.equal(rPut.status, 403);
      const rDelete = await fetch(`${base}/backoffice/stagioni/${s.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(rDelete.status, 403);
    });

    await t.test('admin, PUT fuori censimento: 409', async () => {
      const s = await creaStagioneFixture();
      await pool.query(`UPDATE stagioni_sportive SET stato = 'concertazione' WHERE id = $1`, [s.id]);
      const r = await fetch(`${base}/backoffice/stagioni/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ nome: s.nome, dataInizio: '2070-09-01', dataFine: '2071-06-30' }),
      });
      assert.equal(r.status, 409);
    });

    await t.test('admin, DELETE: 204, riga sparita; su id inesistente 409', async () => {
      const s = await creaStagioneFixture();
      const r = await fetch(`${base}/backoffice/stagioni/${s.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 204);
      const riga = await pool.query('SELECT 1 FROM stagioni_sportive WHERE id = $1', [s.id]);
      assert.equal(riga.rowCount, 0);

      const log = await pool.query(
        `SELECT 1 FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'elimina_stagione' AND entita_id = $2`,
        [admin.id, s.id],
      );
      assert.equal(log.rowCount, 1);

      const rRiprova = await fetch(`${base}/backoffice/stagioni/${s.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(rRiprova.status, 409, 'stagione già eliminata: verificaStagioneModificabile la tratta come "non trovata" -> 409, non 404 (coerente con ErroreStagioneNonModificabile, mai un codice a parte per questo caso raro)');
    });
  },
);

test(
  'PUT /backoffice/deleghe/:id/approva|respingi',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Approvazione Test',
      codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
      rappresentanteLegaleNome: 'Test',
      rappresentanteLegaleCognome: 'Rappresentante',
      indirizzoVia: 'Via Test',
      indirizzoCivico: '1',
      indirizzoCitta: 'Pescara',
      email: `associazione-${randomUUID()}@test.local`,
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
    });
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2032-09-01', '2033-06-30') RETURNING id`,
      [`stagione-approva-${randomUUID()}`],
    );
    // Una persona fisica dedicata per sub-test: abilitazioni_persona_associazione_attiva_uq
    // considera "attiva" sia 'in_attesa' che 'approvata' — riusare la stessa persona dopo
    // che il primo sub-test l'ha approvata farebbe collidere il setup dei sub-test successivi.
    async function nuovaPersonaTest(): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO persone_fisiche (id, codice_fiscale, nome, cognome) VALUES ($1, $2, 'Test', 'Persona')`,
        [id, `TSTPRS${randomUUID().slice(0, 10).toUpperCase()}`],
      );
      return id;
    }

    await t.test('approva: 200, stato approvata', async () => {
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: await nuovaPersonaTest(),
        associazioneId: associazione.id,
        stagioneId: stagione.rows[0]!.id,
      });
      const r = await fetch(`${base}/backoffice/deleghe/${principale.id}/approva`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { stato: string };
      assert.equal(body.stato, 'approvata');
    });

    await t.test('respingi senza motivazione: 400', async () => {
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: await nuovaPersonaTest(),
        associazioneId: associazione.id,
        stagioneId: stagione.rows[0]!.id,
      });
      const r = await fetch(`${base}/backoffice/deleghe/${principale.id}/respingi`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({}),
      });
      assert.equal(r.status, 400);
    });

    await t.test('respingi con motivazione: 200, stato respinta', async () => {
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: await nuovaPersonaTest(),
        associazioneId: associazione.id,
        stagioneId: stagione.rows[0]!.id,
      });
      const r = await fetch(`${base}/backoffice/deleghe/${principale.id}/respingi`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({ motivazione: 'documentazione mancante' }),
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { stato: string; motivazione: string };
      assert.equal(body.stato, 'respinta');
      assert.equal(body.motivazione, 'documentazione mancante');
    });

    await t.test('id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/deleghe/${randomUUID()}/approva`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 404);
    });
  },
);

test(
  'PUT /backoffice/deleghe/:id/revoca: cascata sulle sub-deleghe',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Revoca Test',
      codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
      rappresentanteLegaleNome: 'Test',
      rappresentanteLegaleCognome: 'Rappresentante',
      indirizzoVia: 'Via Test',
      indirizzoCivico: '1',
      indirizzoCitta: 'Pescara',
      email: `associazione-${randomUUID()}@test.local`,
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
    });
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2033-09-01', '2034-06-30') RETURNING id`,
      [`stagione-revoca-${randomUUID()}`],
    );
    const personaId = randomUUID();
    await pool.query(
      `INSERT INTO persone_fisiche (id, codice_fiscale, nome, cognome) VALUES ($1, $2, 'Test', 'Revoca')`,
      [personaId, `TSTREV${randomUUID().slice(0, 10).toUpperCase()}`],
    );
    const principale = await creaAbilitazionePrincipale(pool, {
      personaFisicaId: personaId,
      associazioneId: associazione.id,
      stagioneId: stagione.rows[0]!.id,
    });
    await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [principale.id]);

    await t.test('revoca: 200, log_operazioni tracciato', async () => {
      const r = await fetch(`${base}/backoffice/deleghe/${principale.id}/revoca`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 200);

      const log = await pool.query(
        `SELECT azione FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'revoca_delega'`,
        [operatore.id],
      );
      assert.equal(log.rows.length, 1);
    });

    await t.test('id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/deleghe/${randomUUID()}/revoca`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 404);
    });
  },
);

test(
  'GET/PUT /backoffice/impostazioni/oidc: solo admin, secret mai in chiaro, merge-on-omit',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    // Chiave singleton 'oidc' in impostazioni_sistema: gli scenari sotto dipendono dallo
    // stato esatto della configurazione (incluso "nessuna config esiste ancora" per il
    // primo GET/PUT), e server.test.ts/loginPubblico.test.ts scrivono la stessa chiave in
    // parallelo sul DB condiviso — stesso gotcha già risolto nel Task 1
    // (oidc/config.test.ts), stesso rimedio: database dedicato usa-e-getta.
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteBackofficeTest(pool, 'admin');
    const operatore = await creaUtenteBackofficeTest(pool, 'operatore');

    await t.test('operatore: 403 su GET e PUT', async () => {
      const rGet = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(rGet.status, 403);
      const rPut = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify({}),
      });
      assert.equal(rPut.status, 403);
    });

    await t.test('admin, GET senza config: 404', async () => {
      const r = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 404);
    });

    // Bug reale trovato in produzione (2026-08-24): senza questo endpoint separato,
    // il redirect URI calcolato era leggibile solo attraverso la GET sopra --
    // inutilizzabile alla primissima configurazione (404 finché nulla è ancora
    // salvato), impedendo a un admin di leggerlo/copiarlo PRIMA di registrare il
    // client lato IdP. redirectUriOidc() è puro (solo env var), quindi questo
    // endpoint deve rispondere 200 indipendentemente dallo stato della config.
    await t.test('admin, GET redirect-uri: 200 anche senza nessuna config OIDC salvata', async () => {
      const r = await fetch(`${base}/backoffice/impostazioni/oidc/redirect-uri`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { redirectUri: string | null };
      // FRONTEND_PUBBLICO_BASE_URL non impostata in questo file di test.
      assert.equal(body.redirectUri, null);
    });

    await t.test('operatore, GET redirect-uri: 403', async () => {
      const r = await fetch(`${base}/backoffice/impostazioni/oidc/redirect-uri`, {
        headers: { Authorization: `Bearer ${operatore.token}` },
      });
      assert.equal(r.status, 403);
    });

    await t.test('admin, GET redirect-uri: calcolato da FRONTEND_PUBBLICO_BASE_URL quando impostata', async () => {
      const originale = process.env.FRONTEND_PUBBLICO_BASE_URL;
      process.env.FRONTEND_PUBBLICO_BASE_URL = 'https://pubblico-http-test.invalid';
      try {
        const r = await fetch(`${base}/backoffice/impostazioni/oidc/redirect-uri`, {
          headers: { Authorization: `Bearer ${admin.token}` },
        });
        assert.equal(r.status, 200);
        const body = (await r.json()) as { redirectUri: string | null };
        assert.equal(body.redirectUri, 'https://pubblico-http-test.invalid/oidc/callback');
      } finally {
        if (originale === undefined) delete process.env.FRONTEND_PUBBLICO_BASE_URL;
        else process.env.FRONTEND_PUBBLICO_BASE_URL = originale;
      }
    });

    await t.test('admin, primo PUT senza clientSecret: 400', async () => {
      const r = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          issuer: 'https://idp-http-test.invalid',
          clientId: 'client-http-test',
        }),
      });
      assert.equal(r.status, 400);
    });

    await t.test('admin, primo PUT con clientSecret: 200, GET non espone il secret', async () => {
      const rPut = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          issuer: 'https://idp-http-test.invalid',
          clientId: 'client-http-test',
          clientSecret: 'segreto-http-test',
        }),
      });
      assert.equal(rPut.status, 200);
      const bodyPut = (await rPut.json()) as Record<string, unknown>;
      assert.equal('clientSecret' in bodyPut, false, 'PUT non deve mai riflettere il secret nella risposta');
      assert.equal(bodyPut.clientSecretConfigurato, true);
      // redirectUri è calcolato da FRONTEND_PUBBLICO_BASE_URL, non impostata in
      // questo file di test (non serve: nessun test qui esercita il flusso di
      // login reale) — null, mai un valore inventato.
      assert.equal(bodyPut.redirectUri, null);

      const rGet = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(rGet.status, 200);
      const bodyGet = (await rGet.json()) as Record<string, unknown>;
      assert.equal('clientSecret' in bodyGet, false);
      assert.equal(bodyGet.issuer, 'https://idp-http-test.invalid');
      assert.equal(bodyGet.redirectUri, null);

      const log = await pool.query(
        `SELECT dettaglio FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'aggiorna_impostazioni_oidc' ORDER BY avvenuta_il DESC LIMIT 1`,
        [admin.id],
      );
      const dettaglio = log.rows[0]?.dettaglio as Record<string, unknown> | undefined;
      assert.ok(dettaglio);
      assert.equal('clientSecret' in dettaglio!, false, 'il secret non deve mai finire nel dettaglio dell\'audit log');
    });

    await t.test('admin, PUT successivo senza clientSecret: 200, secret precedente preservato', async () => {
      const rPut = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          issuer: 'https://idp-http-test-2.invalid',
          clientId: 'client-http-test',
        }),
      });
      assert.equal(rPut.status, 200);
      const bodyPut = (await rPut.json()) as { issuer: string; clientSecretConfigurato: boolean };
      assert.equal(bodyPut.issuer, 'https://idp-http-test-2.invalid');
      assert.equal(bodyPut.clientSecretConfigurato, true, 'il flag resta true anche se il secret non è stato reinviato');

      // Non fidarsi solo del body HTTP (clientSecretConfigurato è un booleano, non prova
      // che il valore sia rimasto INVARIATO): rileggere la config reale e confrontare il
      // secret decifrato con quello del primo PUT.
      const configReale = await leggiConfigOidc(pool);
      assert.ok(configReale);
      assert.equal(configReale!.clientSecret, 'segreto-http-test');
    });

    await t.test('admin, PUT con issuer con trailing slash: normalizzato senza slash finale', async () => {
      const rPut = await fetch(`${base}/backoffice/impostazioni/oidc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          issuer: 'https://idp-http-test-3.invalid/',
          clientId: 'client-http-test',
        }),
      });
      assert.equal(rPut.status, 200);
      const bodyPut = (await rPut.json()) as { issuer: string };
      assert.equal(bodyPut.issuer, 'https://idp-http-test-3.invalid');

      const configReale = await leggiConfigOidc(pool);
      assert.equal(configReale!.issuer, 'https://idp-http-test-3.invalid');
    });
  },
);

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
