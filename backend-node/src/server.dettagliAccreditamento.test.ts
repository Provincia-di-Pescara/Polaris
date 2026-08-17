import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaPersonaFisicaTest(pool: Pool): Promise<{ id: string; token: string }> {
  const cf = `TSTDET${randomUUID().slice(0, 10).toUpperCase()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessTokenPubblico({ sub: id, codiceFiscale: cf, nome: 'Mario', cognome: 'Rossi' });
  return { id, token };
}

async function creaUtenteBackofficeTest(pool: Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `backoffice-dettagli-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Backoffice', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessToken({ sub: id, email, ruolo });
  return { id, token };
}

async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-dettagli-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

const referenteTest = {
  nome: 'Luca',
  cognome: 'Bianchi',
  natoA: 'Pescara',
  natoIl: '1980-01-01',
  residenteVia: 'Via Roma 1',
  residenteCitta: 'Pescara',
  cellulare: '3331234567',
  cartaIdentita: 'CI12345',
};

const referenteEmergenzeDaeTest = {
  ...referenteTest,
  daeMarca: 'Marca DAE',
  daeMatricola: 'DAE-001',
  daeScadenza: '2030-01-01',
};

const assicurazioneTest = {
  compagnia: 'Compagnia Assicurativa SpA',
  numeroPolizza: 'POL-001',
  massimale: '1000000.00',
  coperturaDal: '2026-01-01',
  coperturaAl: '2027-01-01',
};

test(
  'GET /backoffice/associazioni/:id/dettagli-accreditamento',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const persona = await creaPersonaFisicaTest(pool);
    const admin = await creaUtenteBackofficeTest(pool, 'admin');
    const stagioneId = await creaStagioneTest(pool);

    // Creazione dell'associazione tramite il flusso pubblico reale (Finding 3 della code
    // review finale: la route deve poter leggere quello che questo stesso flusso scrive
    // in associazioni_referenti/associazioni_assicurazioni).
    const rAss = await fetch(`${base}/pubblico/associazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify({
        denominazione: 'ASD Dettagli Accreditamento Test',
        codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
        stagioneId,
        rappresentanteLegaleNome: 'Mario',
        rappresentanteLegaleCognome: 'Rossi',
        indirizzoVia: 'Via Milano 10',
        indirizzoCivico: '10',
        indirizzoCitta: 'Pescara',
        email: 'asd-dettagli@example.com',
        tipologiaSoggetto: 'associazione_sportiva',
        iscrittaRasd: false,
        haPersonaleAssunto: false,
        referenteSicurezza: referenteTest,
        referenteEmergenzeDae: referenteEmergenzeDaeTest,
        assicurazioneRct: assicurazioneTest,
      }),
    });
    assert.equal(rAss.status, 201);
    const associazione = (await rAss.json()) as { id: string };

    await t.test('senza token: 401', async () => {
      const r = await fetch(`${base}/backoffice/associazioni/${associazione.id}/dettagli-accreditamento`);
      assert.equal(r.status, 401);
    });

    await t.test('associazione inesistente: 404', async () => {
      const r = await fetch(`${base}/backoffice/associazioni/${randomUUID()}/dettagli-accreditamento`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 404);
    });

    await t.test('con token backoffice admin: 200, referenti (con DAE su emergenze) e assicurazione RCT presenti', async () => {
      const r = await fetch(`${base}/backoffice/associazioni/${associazione.id}/dettagli-accreditamento`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      assert.equal(r.status, 200);
      const body = (await r.json()) as {
        referenti: Array<{ tipo: string; nome: string; cognome: string; daeMarca: string | null; daeMatricola: string | null; daeScadenza: string | null }>;
        assicurazioni: Array<{ tipo: string; compagnia: string; numeroPolizza: string }>;
      };

      assert.equal(body.referenti.length, 2);
      const sicurezza = body.referenti.find((ref) => ref.tipo === 'sicurezza');
      const emergenze = body.referenti.find((ref) => ref.tipo === 'emergenze_dae');
      assert.ok(sicurezza, 'atteso referente sicurezza');
      assert.equal(sicurezza?.nome, referenteTest.nome);
      assert.equal(sicurezza?.cognome, referenteTest.cognome);
      assert.ok(emergenze, 'atteso referente emergenze/DAE');
      assert.equal(emergenze?.daeMarca, referenteEmergenzeDaeTest.daeMarca);
      assert.equal(emergenze?.daeMatricola, referenteEmergenzeDaeTest.daeMatricola);
      assert.equal(emergenze?.daeScadenza, referenteEmergenzeDaeTest.daeScadenza);

      assert.equal(body.assicurazioni.length, 1);
      const rct = body.assicurazioni.find((ass) => ass.tipo === 'rct');
      assert.ok(rct, 'attesa assicurazione RCT');
      assert.equal(rct?.compagnia, assicurazioneTest.compagnia);
      assert.equal(rct?.numeroPolizza, assicurazioneTest.numeroPolizza);
    });
  },
);
