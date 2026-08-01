import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaVersione } from './repository/parametrico.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: import('pg').Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteTest(pool: import('pg').Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `parametrico-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Parametrico', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/parametrico, /versioni, /versioni/:id',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteTest(pool, 'admin');
    const operatore = await creaUtenteTest(pool, 'operatore');

    await t.test('operatore: 403 su tutte e 3', async () => {
      const r1 = await fetch(`${base}/backoffice/parametrico`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r1.status, 403);
      const r2 = await fetch(`${base}/backoffice/parametrico/versioni`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r2.status, 403);
      const r3 = await fetch(`${base}/backoffice/parametrico/versioni/${randomUUID()}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
      assert.equal(r3.status, 403);
    });

    await t.test('admin: GET attivo ritorna il seed iniziale', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { quotaNuoveAssociazioniPct: string; csdScaglioni: unknown[] };
      assert.equal(body.quotaNuoveAssociazioniPct, '0.0000');
      assert.ok(Array.isArray(body.csdScaglioni));
    });

    let secondaVersioneId = '';

    await t.test('crea una seconda versione via repository, poi GET attivo la ritorna', async () => {
      const versione = await creaVersione(
        pool,
        {
          moltiplicatoreMinutiPerPunto: '60.000',
          pesoFasciaPregiata: '1.500',
          minutiSettimanaliMax: '600.000',
          slotMaxStessoImpianto: 4,
          fascePregiateMax: 2,
          giornateGaraMax: 1,
          incrementoSquadreNeutro: 0,
          caaNeutro: '1.000',
          csdNeutro: '1.000',
          tolleranzaIsfPct: '0.0050',
          sogliaMancatiUtilizziDiffida: 2,
          sogliaMancatiUtilizziDecadenza: 3,
          sogliaScostamentoDichiaratoPct: '0.2000',
          sogliaIsfCompensazione: '0.2000',
          retentionLogOperazioniGiorni: 30,
          quotaNuoveAssociazioniPct: '0.0000',
          csdScaglioni: [],
        },
        admin.id,
      );
      secondaVersioneId = versione.id;

      const r = await fetch(`${base}/backoffice/parametrico`, { headers: { Authorization: `Bearer ${admin.token}` } });
      const body = (await r.json()) as { id: string; pesoFasciaPregiata: string };
      assert.equal(body.id, secondaVersioneId);
      assert.equal(body.pesoFasciaPregiata, '1.500');
    });

    await t.test('GET /versioni: lista entrambe, la più recente prima', async () => {
      const r = await fetch(`${base}/backoffice/parametrico/versioni`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 200);
      const lista = (await r.json()) as Array<{ id: string }>;
      assert.ok(lista.length >= 2);
      assert.equal(lista[0]!.id, secondaVersioneId);
    });

    await t.test('GET /versioni/:id sulla versione appena creata', async () => {
      const r = await fetch(`${base}/backoffice/parametrico/versioni/${secondaVersioneId}`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { pesoFasciaPregiata: string };
      assert.equal(body.pesoFasciaPregiata, '1.500');
    });

    await t.test('GET /versioni/:id inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/parametrico/versioni/${randomUUID()}`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 404);
    });

    await t.test('GET /versioni/:id malformato: 400', async () => {
      const r = await fetch(`${base}/backoffice/parametrico/versioni/non-un-uuid`, { headers: { Authorization: `Bearer ${admin.token}` } });
      assert.equal(r.status, 400);
    });
  },
);

test(
  'POST /backoffice/parametrico: crea nuova versione, audit log, validazione',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteTest(pool, 'admin');
    const operatore = await creaUtenteTest(pool, 'operatore');

    const DATI_VALIDI = {
      note: 'nuova versione via HTTP',
      moltiplicatoreMinutiPerPunto: '60.000',
      pesoFasciaPregiata: '1.250',
      minutiSettimanaliMax: '600.000',
      slotMaxStessoImpianto: 4,
      fascePregiateMax: 2,
      giornateGaraMax: 1,
      incrementoSquadreNeutro: 0,
      caaNeutro: '1.000',
      csdNeutro: '1.000',
      tolleranzaIsfPct: '0.0050',
      sogliaMancatiUtilizziDiffida: 2,
      sogliaMancatiUtilizziDecadenza: 3,
      sogliaScostamentoDichiaratoPct: '0.2000',
      sogliaIsfCompensazione: '0.2000',
      retentionLogOperazioniGiorni: 30,
      quotaNuoveAssociazioniPct: '0.0000',
      csdScaglioni: [{ rapportoFdFrMin: '0.000', rapportoFdFrMax: null, coefficiente: '1.000' }],
    };

    await t.test('operatore: 403', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
        body: JSON.stringify(DATI_VALIDI),
      });
      assert.equal(r.status, 403);
    });

    await t.test('admin, campo mancante: 400', async () => {
      const { pesoFasciaPregiata, ...senzaCampo } = DATI_VALIDI;
      void pesoFasciaPregiata;
      const r = await fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify(senzaCampo),
      });
      assert.equal(r.status, 400);
    });

    await t.test('admin, scaglione con rapportoFdFrMax <= min: 400', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ ...DATI_VALIDI, csdScaglioni: [{ rapportoFdFrMin: '1.000', rapportoFdFrMax: '0.500', coefficiente: '1.000' }] }),
      });
      assert.equal(r.status, 400);
    });

    let nuovaVersioneId = '';

    await t.test('admin, dati validi: 201, nuova versione persistita, audit log scritto', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify(DATI_VALIDI),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; note: string; pubblicataDa: string };
      assert.equal(body.note, 'nuova versione via HTTP');
      assert.equal(body.pubblicataDa, admin.id);
      nuovaVersioneId = body.id;

      const log = await pool.query(
        `SELECT azione, entita_id FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'crea_versione_parametrico'`,
        [admin.id],
      );
      assert.equal(log.rows.length, 1);
      assert.equal(log.rows[0]?.entita_id, nuovaVersioneId);
    });

    await t.test('GET attivo ora ritorna la versione appena creata via HTTP', async () => {
      const r = await fetch(`${base}/backoffice/parametrico`, { headers: { Authorization: `Bearer ${admin.token}` } });
      const body = (await r.json()) as { id: string };
      assert.equal(body.id, nuovaVersioneId);
    });
  },
);

// Regressione final-review whole-branch (2026-07-31): 4 finding Important, ciascuno
// verificato bloccato (400) da qui in avanti, dove prima passava (201) e rompeva
// silenziosamente il sistema (audit log azzerato, round-robin irraggiungibile,
// istruttoria rotta da CSD non coprente, 500 grezzo su overflow numerico).
test(
  'POST /backoffice/parametrico: finding di final review bloccati (400)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteTest(pool, 'admin');

    const DATI_VALIDI = {
      note: 'base valida per i test di regressione',
      moltiplicatoreMinutiPerPunto: '60.000',
      pesoFasciaPregiata: '1.250',
      minutiSettimanaliMax: '600.000',
      slotMaxStessoImpianto: 4,
      fascePregiateMax: 2,
      giornateGaraMax: 1,
      incrementoSquadreNeutro: 0,
      caaNeutro: '1.000',
      csdNeutro: '1.000',
      tolleranzaIsfPct: '0.0050',
      sogliaMancatiUtilizziDiffida: 2,
      sogliaMancatiUtilizziDecadenza: 3,
      sogliaScostamentoDichiaratoPct: '0.2000',
      sogliaIsfCompensazione: '0.2000',
      retentionLogOperazioniGiorni: 30,
      quotaNuoveAssociazioniPct: '0.0000',
      csdScaglioni: [{ rapportoFdFrMin: '0.000', rapportoFdFrMax: null, coefficiente: '1.000' }],
    };

    async function posta(body: unknown): Promise<Response> {
      return fetch(`${base}/backoffice/parametrico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify(body),
      });
    }

    await t.test('sanity: dati validi ancora 201 (baseline non regredita)', async () => {
      const r = await posta(DATI_VALIDI);
      assert.equal(r.status, 201);
    });

    await t.test('Finding 1: retentionLogOperazioniGiorni: 0 -> 400 (azzererebbe log_operazioni)', async () => {
      const r = await posta({ ...DATI_VALIDI, retentionLogOperazioniGiorni: 0 });
      assert.equal(r.status, 400);
    });

    await t.test('Finding 2: quotaNuoveAssociazioniPct: "20.0000" -> 400 (20% scritto come 20 invece di 0.20)', async () => {
      const r = await posta({ ...DATI_VALIDI, quotaNuoveAssociazioniPct: '20.0000' });
      assert.equal(r.status, 400);
    });

    await t.test('Finding 2: sogliaMancatiUtilizziDiffida >= Decadenza -> 400', async () => {
      const r = await posta({ ...DATI_VALIDI, sogliaMancatiUtilizziDiffida: 3, sogliaMancatiUtilizziDecadenza: 3 });
      assert.equal(r.status, 400);
    });

    await t.test('Finding 2: caaNeutro "0.000" -> 400 (coefficiente neutro non può essere zero)', async () => {
      const r = await posta({ ...DATI_VALIDI, caaNeutro: '0.000' });
      assert.equal(r.status, 400);
    });

    await t.test('Finding 3: csdScaglioni vuoto -> 400', async () => {
      const r = await posta({ ...DATI_VALIDI, csdScaglioni: [] });
      assert.equal(r.status, 400);
    });

    await t.test('Finding 3: csdScaglioni con buco tra 1.000 e 1.500 -> 400', async () => {
      const r = await posta({
        ...DATI_VALIDI,
        csdScaglioni: [
          { rapportoFdFrMin: '0.000', rapportoFdFrMax: '1.000', coefficiente: '1.000' },
          { rapportoFdFrMin: '1.500', rapportoFdFrMax: null, coefficiente: '0.850' },
        ],
      });
      assert.equal(r.status, 400);
    });

    await t.test('Finding 3: csdScaglioni sovrapposti ([0,2) e [1,null)) -> 400', async () => {
      const r = await posta({
        ...DATI_VALIDI,
        csdScaglioni: [
          { rapportoFdFrMin: '0.000', rapportoFdFrMax: '2.000', coefficiente: '1.000' },
          { rapportoFdFrMin: '1.000', rapportoFdFrMax: null, coefficiente: '0.850' },
        ],
      });
      assert.equal(r.status, 400);
    });

    await t.test('Finding 3: csdScaglioni validi e contigui -> 201', async () => {
      const r = await posta({
        ...DATI_VALIDI,
        note: 'scaglioni contigui validi',
        csdScaglioni: [
          { rapportoFdFrMin: '0.000', rapportoFdFrMax: '1.000', coefficiente: '1.000' },
          { rapportoFdFrMin: '1.000', rapportoFdFrMax: '2.000', coefficiente: '0.900' },
          { rapportoFdFrMin: '2.000', rapportoFdFrMax: null, coefficiente: '0.850' },
        ],
      });
      assert.equal(r.status, 201);
    });

    await t.test('Finding 4: moltiplicatoreMinutiPerPunto "99999999" -> 400, non 500 (overflow numeric)', async () => {
      const r = await posta({ ...DATI_VALIDI, moltiplicatoreMinutiPerPunto: '99999999' });
      assert.equal(r.status, 400);
    });
  },
);
