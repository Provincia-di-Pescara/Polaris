import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { registraOperazione } from './logOperazioni.ts';

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
