import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { registraOperazione, listaOperazioni } from './logOperazioni.ts';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'audit log (art. B.39) su log_operazioni contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    await t.test('operazione di un utente backoffice registrata con ruolo, azione, entità e ip', async () => {
      const utente = await pool.query<{ id: string }>(
        `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
         VALUES ($1, 'x', 'Audit', 'Test', 'admin', 'attivo') RETURNING id`,
        [`audit-bo-${randomUUID()}@test.local`],
      );
      const utenteId = utente.rows[0]!.id;

      await registraOperazione(pool, {
        attore: { tipo: 'backoffice', utenteBackofficeId: utenteId, ruolo: 'admin' },
        azione: 'login',
        entitaTipo: 'utenti_backoffice',
        entitaId: utenteId,
        ipAddress: '10.1.2.3',
      });

      const riga = await pool.query(
        `SELECT persona_fisica_id, utente_backoffice_id, associazione_id, ruolo, azione,
                entita_tipo, entita_id, dettaglio, host(ip_address) AS ip
         FROM log_operazioni WHERE utente_backoffice_id = $1`,
        [utenteId],
      );
      assert.equal(riga.rows.length, 1);
      const r = riga.rows[0]!;
      assert.equal(r.persona_fisica_id, null);
      assert.equal(r.ruolo, 'admin');
      assert.equal(r.azione, 'login');
      assert.equal(r.entita_tipo, 'utenti_backoffice');
      assert.equal(r.entita_id, utenteId);
      assert.equal(r.ip, '10.1.2.3');
    });

    await t.test('operazione di una persona fisica registrata con associazione rappresentata e dettaglio', async () => {
      const cf = `AUDIT${randomUUID().replaceAll('-', '').slice(0, 11).toUpperCase()}`;
      const persona = await pool.query<{ id: string }>(
        `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_provider, oidc_subject)
         VALUES ($1, 'Audit', 'Pubblico', 'spid', $2) RETURNING id`,
        [cf, `audit-sub-${randomUUID()}`],
      );
      const personaId = persona.rows[0]!.id;
      const associazione = await pool.query<{ id: string }>(
        `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva)
         VALUES ('ASD Audit Test', $1) RETURNING id`,
        [`9${randomUUID().replaceAll(/\D/g, '').slice(0, 10)}`],
      );
      const associazioneId = associazione.rows[0]!.id;

      await registraOperazione(pool, {
        attore: { tipo: 'pubblico', personaFisicaId: personaId, associazioneId, ruolo: 'delegato' },
        azione: 'login',
        entitaTipo: 'persone_fisiche',
        entitaId: personaId,
        dettaglio: { provider: 'spid' },
        ipAddress: null,
      });

      const riga = await pool.query(
        `SELECT utente_backoffice_id, associazione_id, ruolo, dettaglio, ip_address
         FROM log_operazioni WHERE persona_fisica_id = $1`,
        [personaId],
      );
      assert.equal(riga.rows.length, 1);
      const r = riga.rows[0]!;
      assert.equal(r.utente_backoffice_id, null);
      assert.equal(r.associazione_id, associazioneId);
      assert.equal(r.ruolo, 'delegato');
      assert.deepEqual(r.dettaglio, { provider: 'spid' });
      assert.equal(r.ip_address, null);
    });
  },
);

test(
  'listaOperazioni filtra per entitaTipo/azione/data e pagina',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const utente = await pool.query<{ id: string }>(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, 'hash', 'Log', 'Test', 'admin', 'attivo') RETURNING id`,
      [`log-test-${randomUUID()}@test.local`],
    );
    const entitaId = randomUUID();

    await registraOperazione(pool, {
      attore: { tipo: 'backoffice', utenteBackofficeId: utente.rows[0]!.id, ruolo: 'admin' },
      azione: 'azione_di_test_log',
      entitaTipo: 'entita_di_test',
      entitaId,
      dettaglio: { chiave: 'valore' },
    });

    const tutte = await listaOperazioni(pool, { limit: 50, offset: 0 });
    assert.ok(tutte.some((o) => o.entitaId === entitaId && o.attoreNome.includes('Log Test')));

    const filtrate = await listaOperazioni(pool, { entitaTipo: 'entita_di_test', azione: 'azione_di_test_log', limit: 50, offset: 0 });
    assert.ok(filtrate.some((o) => o.entitaId === entitaId));

    const nessunMatch = await listaOperazioni(pool, { azione: 'azione_che_non_esiste_mai', limit: 50, offset: 0 });
    assert.ok(!nessunMatch.some((o) => o.entitaId === entitaId));

    const paginaVuota = await listaOperazioni(pool, { entitaTipo: 'entita_di_test', limit: 1, offset: 1000 });
    assert.equal(paginaVuota.length, 0);

    // Test date range filtering: insert a row with explicit date in the past
    // and verify dataDa/dataA filtering works correctly
    const testDate = '2026-08-10'; // Known date in the past (relative to now)
    const tomorrow = '2026-08-11';
    const yesterday = '2026-08-09';
    const utente2 = await pool.query<{ id: string }>(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, 'hash', 'Date', 'Test', 'admin', 'attivo') RETURNING id`,
      [`date-test-${randomUUID()}@test.local`],
    );
    const utenteId2 = utente2.rows[0]!.id;

    // Insert a log entry with explicit date
    await pool.query(
      `INSERT INTO log_operazioni
       (utente_backoffice_id, ruolo, azione, entita_tipo, avvenuta_il)
       VALUES ($1, $2, $3, $4, $5::date)`,
      [utenteId2, 'admin', 'azione_data_test', 'entita_data_test', testDate],
    );

    // Test dataDa filter: row should be included when dataDa <= row date
    const conDataDaUgualeOAntecedente = await listaOperazioni(pool, {
      entitaTipo: 'entita_data_test',
      dataDa: testDate,
      limit: 50,
      offset: 0
    });
    assert.ok(
      conDataDaUgualeOAntecedente.some((o) => o.azione === 'azione_data_test'),
      'Row should be included when dataDa equals row date'
    );

    // Test dataDa filter: row should be excluded when dataDa > row date
    const conDataDaSuccessiva = await listaOperazioni(pool, {
      entitaTipo: 'entita_data_test',
      dataDa: tomorrow,
      limit: 50,
      offset: 0
    });
    assert.ok(
      !conDataDaSuccessiva.some((o) => o.azione === 'azione_data_test'),
      'Row should be excluded when dataDa is after row date'
    );

    // Test dataA filter: row should be included when dataA >= row date
    const conDataAUgualeOSuccessiva = await listaOperazioni(pool, {
      entitaTipo: 'entita_data_test',
      dataA: testDate,
      limit: 50,
      offset: 0
    });
    assert.ok(
      conDataAUgualeOSuccessiva.some((o) => o.azione === 'azione_data_test'),
      'Row should be included when dataA equals row date'
    );

    // Test dataA filter: row should be excluded when dataA < row date
    const conDataAAntecedente = await listaOperazioni(pool, {
      entitaTipo: 'entita_data_test',
      dataA: yesterday,
      limit: 50,
      offset: 0
    });
    assert.ok(
      !conDataAAntecedente.some((o) => o.azione === 'azione_data_test'),
      'Row should be excluded when dataA is before row date'
    );

    // Test both dataDa and dataA together: row included when within range
    const conRangeInclusivo = await listaOperazioni(pool, {
      entitaTipo: 'entita_data_test',
      dataDa: yesterday,
      dataA: tomorrow,
      limit: 50,
      offset: 0
    });
    assert.ok(
      conRangeInclusivo.some((o) => o.azione === 'azione_data_test'),
      'Row should be included when within date range'
    );

    // Test both dataDa and dataA: row excluded when before range
    const conRangeDopoData = await listaOperazioni(pool, {
      entitaTipo: 'entita_data_test',
      dataDa: tomorrow,
      dataA: tomorrow,
      limit: 50,
      offset: 0
    });
    assert.ok(
      !conRangeDopoData.some((o) => o.azione === 'azione_data_test'),
      'Row should be excluded when outside date range'
    );
  },
);
