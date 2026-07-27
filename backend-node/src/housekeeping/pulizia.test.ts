import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  pulisciPkceScaduto,
  pulisciSessioniScadute,
  pulisciLogOperazioniOltreRetention,
  eseguiHousekeeping,
} from './pulizia.ts';

const dsn = process.env.TEST_DATABASE_URL;

// Retention legale fissa (mai derogabile): verbali di sorteggio, assegnazioni e settimana
// tipo NON sono mai toccati da housekeeping — quella retention è intera stagione +
// termine di impugnazione, non i 30gg di log_operazioni. Nessuna funzione qui ha
// accesso a quelle tabelle, per costruzione (non solo per test).

test(
  'housekeeping / retention GDPR contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    await t.test('pulisciPkceScaduto rimuove solo lo state scaduto, non quello valido', async () => {
      const scaduto = `state-scaduto-${randomUUID()}`;
      const valido = `state-valido-${randomUUID()}`;
      await pool.query(
        `INSERT INTO oidc_stato_pkce (state, code_verifier, creato_il, scade_il) VALUES ($1, 'v', now() - interval '10 minutes', now() - interval '1 minute')`,
        [scaduto],
      );
      await pool.query(
        `INSERT INTO oidc_stato_pkce (state, code_verifier, scade_il) VALUES ($1, 'v', now() + interval '5 minutes')`,
        [valido],
      );

      const rimossi = await pulisciPkceScaduto(pool);
      assert.ok(rimossi >= 1);

      const restano = await pool.query(`SELECT state FROM oidc_stato_pkce WHERE state = ANY($1)`, [[scaduto, valido]]);
      assert.deepEqual(
        restano.rows.map((r) => r.state),
        [valido],
      );
    });

    await t.test('pulisciSessioniScadute rimuove sessioni backoffice/pubblico scadute o revocate da tempo, non quelle attive', async () => {
      const email = `housekeeping-${randomUUID()}@test.local`;
      const utente = await pool.query<{ id: string }>(
        `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
         VALUES ($1, 'x', 'Housekeeping', 'Test', 'operatore', 'attivo') RETURNING id`,
        [email],
      );
      const utenteId = utente.rows[0]!.id;

      const scadutaId = randomUUID();
      const revocataVecchiaId = randomUUID();
      const attivaId = randomUUID();
      await pool.query(
        `INSERT INTO sessioni_backoffice (id, utente_backoffice_id, refresh_token_hash, creata_il, scade_il)
         VALUES ($1, $2, $3, now() - interval '2 hours', now() - interval '1 hour')`,
        [scadutaId, utenteId, `hash-scaduta-${scadutaId}`],
      );
      await pool.query(
        `INSERT INTO sessioni_backoffice (id, utente_backoffice_id, refresh_token_hash, scade_il, revocata_il)
         VALUES ($1, $2, $3, now() + interval '1 day', now() - interval '31 days')`,
        [revocataVecchiaId, utenteId, `hash-revocata-${revocataVecchiaId}`],
      );
      await pool.query(
        `INSERT INTO sessioni_backoffice (id, utente_backoffice_id, refresh_token_hash, scade_il)
         VALUES ($1, $2, $3, now() + interval '1 day')`,
        [attivaId, utenteId, `hash-attiva-${attivaId}`],
      );

      const risultato = await pulisciSessioniScadute(pool, 30);
      assert.ok(risultato.backoffice >= 2);

      const restano = await pool.query(`SELECT id FROM sessioni_backoffice WHERE id = ANY($1)`, [
        [scadutaId, revocataVecchiaId, attivaId],
      ]);
      assert.deepEqual(
        restano.rows.map((r) => r.id),
        [attivaId],
      );
    });

    await t.test('pulisciLogOperazioniOltreRetention usa retention_log_operazioni_giorni dal parametrico attivo', async () => {
      const email = `housekeeping-log-${randomUUID()}@test.local`;
      const utente = await pool.query<{ id: string }>(
        `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
         VALUES ($1, 'x', 'Log', 'Test', 'operatore', 'attivo') RETURNING id`,
        [email],
      );
      const utenteId = utente.rows[0]!.id;

      const vecchioId = randomUUID();
      const recenteId = randomUUID();
      await pool.query(
        `INSERT INTO log_operazioni (id, utente_backoffice_id, ruolo, azione, entita_tipo, avvenuta_il)
         VALUES ($1, $2, 'operatore', 'test', 'test', now() - interval '31 days')`,
        [vecchioId, utenteId],
      );
      await pool.query(
        `INSERT INTO log_operazioni (id, utente_backoffice_id, ruolo, azione, entita_tipo, avvenuta_il)
         VALUES ($1, $2, 'operatore', 'test', 'test', now() - interval '1 day')`,
        [recenteId, utenteId],
      );

      const rimossi = await pulisciLogOperazioniOltreRetention(pool);
      assert.ok(rimossi >= 1);

      const restano = await pool.query(`SELECT id FROM log_operazioni WHERE id = ANY($1)`, [[vecchioId, recenteId]]);
      assert.deepEqual(
        restano.rows.map((r) => r.id),
        [recenteId],
      );
    });

    await t.test('eseguiHousekeeping esegue tutte e tre le pulizie e riassume i conteggi', async () => {
      const state = `state-riepilogo-${randomUUID()}`;
      await pool.query(
        `INSERT INTO oidc_stato_pkce (state, code_verifier, creato_il, scade_il) VALUES ($1, 'v', now() - interval '10 minutes', now() - interval '1 minute')`,
        [state],
      );

      const riepilogo = await eseguiHousekeeping(pool);
      assert.ok(riepilogo.pkceRimossi >= 1);
      assert.ok(typeof riepilogo.sessioniRimosse.backoffice === 'number');
      assert.ok(typeof riepilogo.sessioniRimosse.pubblico === 'number');
      assert.ok(typeof riepilogo.logOperazioniRimossi === 'number');
    });
  },
);
