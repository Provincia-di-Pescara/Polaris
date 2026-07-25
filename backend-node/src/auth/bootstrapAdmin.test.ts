import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import {
  richiediPrimoAdmin,
  verificaPrimoAdmin,
  ErroreBootstrapNonDisponibile,
  ErroreTokenVerificaNonValido,
} from './bootstrapAdmin.ts';
import { verificaPassword } from './password.ts';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';
import type { Email } from '../email/smtp.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

const DATI_VALIDI = {
  email: 'primo-admin@provincia.test',
  password: 'password-bootstrap-lunga-123',
  nome: 'Primo',
  cognome: 'Admin',
};

async function svuotaUtenti(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM log_operazioni WHERE utente_backoffice_id IS NOT NULL');
  await pool.query('DELETE FROM tentativi_login_backoffice');
  await pool.query('DELETE FROM sessioni_backoffice');
  await pool.query('DELETE FROM utenti_backoffice');
}

function estraiToken(email: Email): string {
  const m = email.testo.match(/token=([a-f0-9]{64})/);
  assert.ok(m, `nessun token nel corpo email: ${email.testo}`);
  return m[1]!;
}

// DB dedicato (vedi testutil/dbDedicato.ts): questi test richiedono il controllo
// dell'intera tabella utenti_backoffice, impossibile sul DB condiviso coi test paralleli.
test(
  'bootstrap primo admin: richiesta -> email con link -> verifica -> account attivo',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const emailInviate: Email[] = [];
    const captureEmail = async (e: Email) => {
      emailInviate.push(e);
    };

    await t.test('ciclo completo: crea in attesa, invia link, verifica attiva e registra audit', async () => {
      await svuotaUtenti(pool);
      emailInviate.length = 0;

      await richiediPrimoAdmin(pool, DATI_VALIDI, captureEmail, 'https://backoffice.test');

      const inAttesa = await pool.query(
        `SELECT id, ruolo, stato, token_verifica_hash, password_hash FROM utenti_backoffice WHERE email = $1`,
        [DATI_VALIDI.email],
      );
      assert.equal(inAttesa.rows.length, 1);
      assert.equal(inAttesa.rows[0]!.stato, 'in_attesa_verifica');
      assert.equal(inAttesa.rows[0]!.ruolo, 'admin');
      assert.ok(inAttesa.rows[0]!.token_verifica_hash);
      assert.ok(await verificaPassword(DATI_VALIDI.password, inAttesa.rows[0]!.password_hash));

      assert.equal(emailInviate.length, 1);
      assert.equal(emailInviate[0]!.a, DATI_VALIDI.email);
      assert.ok(emailInviate[0]!.testo.includes('https://backoffice.test'));
      const token = estraiToken(emailInviate[0]!);
      // il token in chiaro non deve mai essere salvato in DB
      assert.notEqual(inAttesa.rows[0]!.token_verifica_hash, token);

      await verificaPrimoAdmin(pool, token);

      const attivo = await pool.query(
        `SELECT stato, token_verifica_hash, token_verifica_scade_il FROM utenti_backoffice WHERE email = $1`,
        [DATI_VALIDI.email],
      );
      assert.equal(attivo.rows[0]!.stato, 'attivo');
      assert.equal(attivo.rows[0]!.token_verifica_hash, null);
      assert.equal(attivo.rows[0]!.token_verifica_scade_il, null);

      const log = await pool.query(
        `SELECT azione FROM log_operazioni WHERE utente_backoffice_id = $1 AND azione = 'bootstrap_primo_admin'`,
        [inAttesa.rows[0]!.id],
      );
      assert.equal(log.rows.length, 1);
    });

    await t.test('rifiuta se esiste già un utente attivo', async () => {
      // l'admin attivato dal sotto-test precedente è ancora presente
      emailInviate.length = 0;
      await assert.rejects(
        richiediPrimoAdmin(pool, { ...DATI_VALIDI, email: 'altro@provincia.test' }, captureEmail, 'https://backoffice.test'),
        ErroreBootstrapNonDisponibile,
      );
      assert.equal(emailInviate.length, 0);
    });

    await t.test('una nuova richiesta sostituisce un bootstrap pendente mai verificato (email persa)', async () => {
      await svuotaUtenti(pool);
      emailInviate.length = 0;

      await richiediPrimoAdmin(pool, DATI_VALIDI, captureEmail, 'https://backoffice.test');
      await richiediPrimoAdmin(
        pool,
        { ...DATI_VALIDI, email: 'secondo-tentativo@provincia.test' },
        captureEmail,
        'https://backoffice.test',
      );

      const righe = await pool.query(`SELECT email FROM utenti_backoffice`);
      assert.equal(righe.rows.length, 1);
      assert.equal(righe.rows[0]!.email, 'secondo-tentativo@provincia.test');

      // il token del primo tentativo non deve più funzionare
      const tokenVecchio = estraiToken(emailInviate[0]!);
      await assert.rejects(verificaPrimoAdmin(pool, tokenVecchio), ErroreTokenVerificaNonValido);
    });

    await t.test('token inesistente o scaduto rifiutati', async () => {
      await svuotaUtenti(pool);
      emailInviate.length = 0;

      await assert.rejects(verificaPrimoAdmin(pool, 'a'.repeat(64)), ErroreTokenVerificaNonValido);

      await richiediPrimoAdmin(pool, DATI_VALIDI, captureEmail, 'https://backoffice.test');
      await pool.query(`UPDATE utenti_backoffice SET token_verifica_scade_il = now() - interval '1 minute'`);
      const token = estraiToken(emailInviate[0]!);
      await assert.rejects(verificaPrimoAdmin(pool, token), ErroreTokenVerificaNonValido);
    });

    await t.test('password sotto i 12 caratteri rifiutata', async () => {
      emailInviate.length = 0;
      await assert.rejects(
        richiediPrimoAdmin(pool, { ...DATI_VALIDI, password: 'corta' }, captureEmail, 'https://x.test'),
        /password/i,
      );
      assert.equal(emailInviate.length, 0);
    });
  },
);
