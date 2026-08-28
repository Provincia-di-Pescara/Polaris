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
  richiediResetPasswordAutonomo,
  completaResetAutonomo,
  trovaUtentePerId,
  ErroreUltimoAdmin,
  ErroreTokenInvitoNonValido,
} from './utentiBackoffice.ts';
import { revocaSessioniUtente, creaSessione } from './sessioni.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from '../erroriDominio.ts';
import { ErroreUtenteDisattivato } from '../auth/errori.ts';
import { verificaPassword } from '../auth/password.ts';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';
import { bootstrapDisponibile } from '../auth/bootstrapAdmin.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function svuota(pool: import('pg').Pool): Promise<void> {
  await pool.query('DELETE FROM sessioni_backoffice');
  await pool.query('DELETE FROM log_operazioni WHERE utente_backoffice_id IS NOT NULL');
  await pool.query('DELETE FROM utenti_backoffice');
}

// Replica minimale di eseguiInTransazione (server.ts): pg_advisory_xact_lock ha effetto
// solo dentro una vera transazione client-scoped, non su chiamate pool.query() sciolte
// (che sono ciascuna un auto-commit separato). Serve per il test di concorrenza del
// Finding 2, che deve esercitare lo stesso ambito transazionale del codice reale.
async function eseguiInTransazione<T>(
  pool: import('pg').Pool,
  azione: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const risultato = await azione(client);
    await client.query('COMMIT');
    return risultato;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

    let secondoAdminIdPerReset = '';

    await t.test('impostaNuovoInvito: rigenera token, stato torna in_attesa_verifica, sessioni revocate', async () => {
      // secondoAdmin è stato creato+attivato nel test precedente ed è l'unico admin
      // attivo rimasto (primoAdminId è ora operatore disattivato). Lo usiamo come
      // chiamante per rispettare la firma aggiornata (chiamanteId != target).
      const admins = await listaUtenti(pool);
      const secondoAdmin = admins.find((u) => u.ruolo === 'admin' && u.stato === 'attivo');
      assert.ok(secondoAdmin, 'precondizione: deve esistere un admin attivo diverso da invitatoId');
      secondoAdminIdPerReset = secondoAdmin!.id;

      const { id: sessioneId } = { id: await creaSessione(pool, { utenteBackofficeId: invitatoId, refreshTokenHash: 'hash-finto', scadeIl: new Date(Date.now() + 3600_000) }) };
      const reset = await impostaNuovoInvito(pool, invitatoId, secondoAdminIdPerReset);
      assert.ok(reset);
      assert.equal(reset!.utente.stato, 'in_attesa_verifica');
      assert.match(reset!.token, /^[a-f0-9]{64}$/);

      await revocaSessioniUtente(pool, invitatoId);
      const sessione = await pool.query<{ revocata_il: string | null }>('SELECT revocata_il FROM sessioni_backoffice WHERE id = $1', [sessioneId]);
      assert.ok(sessione.rows[0]!.revocata_il, 'la sessione precedente deve risultare revocata');

      const idInesistente = await impostaNuovoInvito(pool, '00000000-0000-0000-0000-000000000000', secondoAdminIdPerReset);
      assert.equal(idInesistente, null);

      // Riporta invitatoId ad 'attivo' per non alterare le precondizioni dei test seguenti
      // (rimane un dato del test, non deve inquinare gli scenari successivi).
      await completaInvito(pool, reset!.token, 'password-nuova-di-nuovo-123456');
    });

    await t.test('impostaNuovoInvito: auto-reset vietato', async () => {
      await assert.rejects(
        () => impostaNuovoInvito(pool, secondoAdminIdPerReset, secondoAdminIdPerReset),
        ErroreUltimoAdmin,
      );
    });

    await t.test('impostaNuovoInvito: ultimo admin attivo non resettabile da altri', async () => {
      // secondoAdminIdPerReset è l'unico admin attivo: nessun altro admin può resettarlo.
      await assert.rejects(
        () => impostaNuovoInvito(pool, secondoAdminIdPerReset, invitatoId),
        ErroreUltimoAdmin,
      );
    });

    await t.test('impostaNuovoInvito: utente disattivato non resettabile', async () => {
      // primoAdminId è stato disattivato in un test precedente.
      await assert.rejects(
        () => impostaNuovoInvito(pool, primoAdminId, secondoAdminIdPerReset),
        ErroreUtenteDisattivato,
      );
    });

    await t.test(
      "Finding 1 (regressione, aggiornato): un reset-password sull'invitato (che resta 'attivo') " +
        'non deve mai riaprire il bootstrap pubblico finché esiste un altro utente attivo',
      async () => {
        // A questo punto sia secondoAdminIdPerReset (admin) sia invitatoId (operatore) sono
        // 'attivo'. bootstrapDisponibile() dipende SOLO da stato = 'attivo' (ultimo_accesso_il
        // è stata rimossa: colonna mai scritta da nessun percorso di produzione, era codice
        // morto — vedi commento in auth/bootstrapAdmin.ts). Resettare secondoAdminIdPerReset
        // (stato -> in_attesa_verifica) non deve riaprire il bootstrap finché invitatoId
        // resta attivo: questo è il comportamento reale che l'admin si aspetta durante un
        // reset-password ordinario, e non dipende in alcun modo da ultimo_accesso_il.
        assert.equal(
          await bootstrapDisponibile(pool),
          false,
          'precondizione: bootstrap non disponibile con almeno un utente attivo',
        );

        // Reset diretto via SQL (stato + token con scopo 'invito_utente', migration 000008)
        // per isolare il test sul comportamento di bootstrapDisponibile, bypassando il
        // check self/last-admin/disattivato di impostaNuovoInvito che altrimenti
        // impedirebbe comunque il reset su questo specifico utente.
        await pool.query(
          `UPDATE utenti_backoffice
           SET stato = 'in_attesa_verifica', token_verifica_hash = 'x', token_verifica_scade_il = now() + interval '1 day',
               token_verifica_scopo = 'invito_utente'
           WHERE id = $1`,
          [secondoAdminIdPerReset],
        );

        const riga = await pool.query<{ stato: string }>('SELECT stato FROM utenti_backoffice WHERE id = $1', [
          secondoAdminIdPerReset,
        ]);
        assert.equal(riga.rows[0]!.stato, 'in_attesa_verifica');

        assert.equal(
          await bootstrapDisponibile(pool),
          false,
          "bootstrap NON deve riaprirsi: invitatoId resta 'attivo', indipendentemente da ultimo_accesso_il",
        );

        // Ripristina lo stato per non alterare le precondizioni dei test seguenti.
        await pool.query(
          `UPDATE utenti_backoffice
           SET stato = 'attivo', token_verifica_hash = NULL, token_verifica_scade_il = NULL, token_verifica_scopo = NULL
           WHERE id = $1`,
          [secondoAdminIdPerReset],
        );
      },
    );

    await t.test('Finding 2 (concorrenza): due disattivazioni concorrenti non devono azzerare gli admin attivi', async () => {
      // Due admin attivi indipendenti, ciascuno disattiva l'altro in parallelo. Sotto
      // READ COMMITTED senza advisory lock entrambe le transazioni potrebbero vedere
      // l'altro admin come "ancora attivo" e committare entrambe -> zero admin attivi.
      const { utente: adminA, token: tokenA } = await creaUtenteInvitato(
        pool,
        { email: `concorrenza-a-${randomUUID()}@test.local`, nome: 'Concorrenza', cognome: 'A', ruolo: 'admin' },
        secondoAdminIdPerReset,
      );
      await completaInvito(pool, tokenA, 'password-concorrenza-a-123');

      const { utente: adminB, token: tokenB } = await creaUtenteInvitato(
        pool,
        { email: `concorrenza-b-${randomUUID()}@test.local`, nome: 'Concorrenza', cognome: 'B', ruolo: 'admin' },
        secondoAdminIdPerReset,
      );
      await completaInvito(pool, tokenB, 'password-concorrenza-b-123');

      // A questo punto ci sono 3 admin attivi: secondoAdminIdPerReset, adminA, adminB.
      // Disattiviamo prima secondoAdminIdPerReset per isolare lo scenario a soli 2
      // admin attivi concorrenti (adminA e adminB), poi lanciamo le due disattivazioni
      // reciproche in parallelo.
      await cambiaStatoUtente(pool, secondoAdminIdPerReset, 'disattivato', adminA.id);

      const risultati = await Promise.allSettled([
        eseguiInTransazione(pool, (client) => cambiaStatoUtente(client, adminA.id, 'disattivato', adminB.id)),
        eseguiInTransazione(pool, (client) => cambiaStatoUtente(client, adminB.id, 'disattivato', adminA.id)),
      ]);

      const falliti = risultati.filter((r) => r.status === 'rejected');
      const riusciti = risultati.filter((r) => r.status === 'fulfilled');
      assert.equal(falliti.length, 1, 'esattamente una delle due disattivazioni concorrenti deve fallire');
      assert.equal(riusciti.length, 1, 'esattamente una delle due disattivazioni concorrenti deve riuscire');
      const fallito = falliti[0] as PromiseRejectedResult;
      assert.ok(fallito.reason instanceof ErroreUltimoAdmin, 'il fallimento deve essere ErroreUltimoAdmin, non un errore generico');

      const attivi = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM utenti_backoffice WHERE ruolo = 'admin' AND stato = 'attivo'`,
      );
      assert.equal(Number(attivi.rows[0]!.count), 1, 'deve restare esattamente 1 admin attivo, mai zero');
    });

    await t.test('trovaUtentePerId legge i nuovi campi', async () => {
      const t2 = await trovaUtentePerId(pool, invitatoId);
      assert.equal(t2?.nome, 'Rinominato');
      assert.equal(t2?.creatoDa, primoAdminId);
    });

    await t.test('cambiaStatoUtente su un utente in_attesa_verifica ripulisce il token invito pendente (CHECK utenti_backoffice_token_verifica_coerente)', async () => {
      const email = `pendente-${randomUUID()}@test.local`;
      const { utente: pendente } = await creaUtenteInvitato(
        pool,
        { email, nome: 'Pendente', cognome: 'Invito', ruolo: 'operatore' },
        primoAdminId,
      );
      assert.equal(pendente.stato, 'in_attesa_verifica');

      const prima = await pool.query<{ token_verifica_hash: string | null }>(
        'SELECT token_verifica_hash FROM utenti_backoffice WHERE id = $1',
        [pendente.id],
      );
      assert.ok(prima.rows[0]!.token_verifica_hash, 'precondizione: token invito presente prima del cambio stato');

      const disattivato = await cambiaStatoUtente(pool, pendente.id, 'disattivato', primoAdminId);
      assert.equal(disattivato.stato, 'disattivato');

      const dopo = await pool.query<{ token_verifica_hash: string | null; token_verifica_scade_il: string | null }>(
        'SELECT token_verifica_hash, token_verifica_scade_il FROM utenti_backoffice WHERE id = $1',
        [pendente.id],
      );
      assert.equal(dopo.rows[0]!.token_verifica_hash, null);
      assert.equal(dopo.rows[0]!.token_verifica_scade_il, null);
    });
  },
);

test(
  'reset password self-service: account resta attivo durante la richiesta, sessioni revocate solo al completamento, token invalido rigettato',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);
    await svuota(pool);

    const email = `self-service-${randomUUID()}@test.local`;
    const inserito = await pool.query<{ id: string }>(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, 'scrypt:1:1:1:aa:bb', 'Auto', 'Servizio', 'operatore', 'attivo') RETURNING id`,
      [email],
    );
    const utenteId = inserito.rows[0]!.id;

    await creaSessione(pool, {
      utenteBackofficeId: utenteId,
      refreshTokenHash: 'hash-sessione-preesistente',
      scadeIl: new Date(Date.now() + 60_000),
    });

    let token = '';
    await t.test('richiediResetPasswordAutonomo: token generato, account resta attivo (a differenza di impostaNuovoInvito)', async () => {
      const esito = await richiediResetPasswordAutonomo(pool, email);
      assert.ok(esito);
      token = esito!.token;

      const dopoRichiesta = await trovaUtentePerId(pool, utenteId);
      assert.equal(dopoRichiesta?.stato, 'attivo', 'un attaccante che conosce solo l\'email non deve poter bloccare il login');
    });

    await t.test('email inesistente: nessun errore, nessuna riga toccata (no enumeration)', async () => {
      const esito = await richiediResetPasswordAutonomo(pool, `inesistente-${randomUUID()}@test.local`);
      assert.equal(esito, null);
    });

    await t.test('completaResetAutonomo con token sbagliato: rigettato, sessione preesistente ancora attiva', async () => {
      await assert.rejects(() => completaResetAutonomo(pool, 'token-inventato-non-valido-0000000000000000000000000000000000000000000000000000000000000', 'nuova-password-lunga-1'), ErroreTokenInvitoNonValido);
      const sessioni = await pool.query(
        'SELECT 1 FROM sessioni_backoffice WHERE utente_backoffice_id = $1 AND revocata_il IS NULL',
        [utenteId],
      );
      assert.equal(sessioni.rowCount, 1);
    });

    await t.test('completaResetAutonomo con token corretto: password aggiornata, token consumato one-shot', async () => {
      await eseguiInTransazione(pool, async (client) => {
        const aggiornato = await completaResetAutonomo(client, token, 'nuova-password-lunga-1');
        assert.equal(aggiornato.stato, 'attivo');
        assert.ok(await verificaPassword('nuova-password-lunga-1', aggiornato.passwordHash));
        await revocaSessioniUtente(client, aggiornato.id);
      });

      // revocaSessioniUtente marca revocata_il (soft-revoke), non cancella la riga —
      // la sessione va cercata tra quelle ancora attive, non tra tutte le righe.
      const sessioniDopo = await pool.query(
        'SELECT 1 FROM sessioni_backoffice WHERE utente_backoffice_id = $1 AND revocata_il IS NULL',
        [utenteId],
      );
      assert.equal(sessioniDopo.rowCount, 0);

      await assert.rejects(() => completaResetAutonomo(pool, token, 'altra-password-lunga-2'), ErroreTokenInvitoNonValido);
    });
  },
);
