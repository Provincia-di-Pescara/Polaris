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
