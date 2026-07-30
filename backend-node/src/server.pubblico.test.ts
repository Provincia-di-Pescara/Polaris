import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';

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
  const cf = `TSTPUB${randomUUID().slice(0, 10).toUpperCase()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessTokenPubblico({ sub: id, codiceFiscale: cf, nome: 'Mario', cognome: 'Rossi' });
  return { id, token };
}

async function creaStagioneTest(pool: Pool): Promise<string> {
  const nome = `stagione-pubblico-test-${randomUUID()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [nome],
  );
  return r.rows[0]!.id;
}

test(
  'POST /pubblico/associazioni crea associazione + abilitazione in_attesa',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const persona = await creaPersonaFisicaTest(pool);
    const stagioneId = await creaStagioneTest(pool);

    await t.test('senza token: 401', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, { method: 'POST' });
      assert.equal(r.status, 401);
    });

    await t.test('con token valido: 201, abilitazione in_attesa creata, log scritto', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify({
          denominazione: 'ASD Volley Pescara',
          codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
          stagioneId,
        }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; denominazione: string };
      assert.equal(body.denominazione, 'ASD Volley Pescara');

      const abilitazione = await pool.query(
        `SELECT stato, titolo, ruolo, creata_da_abilitazione_id FROM abilitazioni
         WHERE persona_fisica_id = $1 AND associazione_id = $2`,
        [persona.id, body.id],
      );
      assert.equal(abilitazione.rows[0]?.stato, 'in_attesa');
      assert.equal(abilitazione.rows[0]?.titolo, 'legale_rappresentante');
      assert.equal(abilitazione.rows[0]?.ruolo, 'rappresentante');
      assert.equal(abilitazione.rows[0]?.creata_da_abilitazione_id, null);

      const log = await pool.query(
        `SELECT azione FROM log_operazioni WHERE persona_fisica_id = $1 AND azione = 'accreditamento_associazione'`,
        [persona.id],
      );
      assert.equal(log.rows.length, 1);
    });

    await t.test('codice fiscale/partita IVA duplicato: 409', async () => {
      const piva = `PIVA-${randomUUID().slice(0, 8)}`;
      const dati = { denominazione: 'ASD Duplicata', codiceFiscalePartitaIva: piva, stagioneId };
      await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(dati),
      });
      const r2 = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(dati),
      });
      assert.equal(r2.status, 409);
    });

    await t.test('stagioneId inesistente: 400', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify({
          denominazione: 'ASD Fantasma',
          codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
          stagioneId: randomUUID(),
        }),
      });
      assert.equal(r.status, 400);
    });
  },
);

test(
  'POST /pubblico/deleghe: sub-delega auto-approvata, catena tracciata',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const rappresentante = await creaPersonaFisicaTest(pool);
    const stagioneId = await creaStagioneTest(pool);
    const rAss = await fetch(`${base}/pubblico/associazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
      body: JSON.stringify({
        denominazione: 'ASD Delega Test',
        codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
        stagioneId,
      }),
    });
    const associazione = (await rAss.json()) as { id: string };
    await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE associazione_id = $1`, [associazione.id]);

    await t.test('rappresentante senza abilitazione attiva su un\'altra associazione: 403', async () => {
      const altraStagione = await creaStagioneTest(pool);
      const r = await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify({
          codiceFiscale: `TSTX${randomUUID().slice(0, 12).toUpperCase()}`,
          nome: 'X',
          cognome: 'Y',
          associazioneId: associazione.id,
          stagioneId: altraStagione,
          ruolo: 'operatore',
        }),
      });
      assert.equal(r.status, 403);
    });

    await t.test('rappresentante approvato delega una persona nuova (mai autenticata): 201, auto-approvata', async () => {
      const cfDelegato = `TSTDEL${randomUUID().slice(0, 10).toUpperCase()}`;
      const r = await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify({
          codiceFiscale: cfDelegato,
          nome: 'Nuovo',
          cognome: 'Delegato',
          associazioneId: associazione.id,
          stagioneId,
          ruolo: 'operatore',
        }),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string; stato: string; creataDaAbilitazioneId: string | null };
      assert.equal(body.stato, 'approvata');
      assert.ok(body.creataDaAbilitazioneId, 'deve tracciare da quale abilitazione discende');

      const persona = await pool.query(`SELECT id FROM persone_fisiche WHERE codice_fiscale = $1`, [cfDelegato]);
      assert.equal(persona.rows.length, 1, 'deve aver creato la persona fisica shell');
    });

    await t.test('stesso delegato di nuovo sulla stessa associazione+stagione: 409', async () => {
      const cfDelegato = `TSTDUP${randomUUID().slice(0, 10).toUpperCase()}`;
      const dati = {
        codiceFiscale: cfDelegato,
        nome: 'Dup',
        cognome: 'Licato',
        associazioneId: associazione.id,
        stagioneId,
        ruolo: 'operatore',
      };
      await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify(dati),
      });
      const r2 = await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify(dati),
      });
      assert.equal(r2.status, 409);
    });
  },
);
