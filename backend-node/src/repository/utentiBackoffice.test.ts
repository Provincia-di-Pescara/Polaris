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

      // NOTA: target e chiamante corretti rispetto alla stesura iniziale del brief (che
      // disabilitava secondoAdmin — l'ultimo admin attivo rimasto dopo il declassamento
      // di primoAdminId — violando la protezione ultimo-admin per costruzione). Il titolo
      // del test ("disattivazione/declassamento del primo") e l'intento sono che sia
      // "primo" (ora operatore, non più admin) ad essere disattivato, chiamato da "secondo".
      const disattivato = await cambiaStatoUtente(pool, primoAdminId, 'disattivato', secondoAdmin.id);
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
