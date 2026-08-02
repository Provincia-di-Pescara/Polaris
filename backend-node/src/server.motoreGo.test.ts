import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp, type DipendenzeApp } from './server.ts';
import type { ClientMotore } from './engine/client.ts';
import { ErroreMotoreIrraggiungibile, ErroreMotoreDominio } from './engine/client.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

if (!dsn) {
  test('server.motoreGo: skippato senza TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  const pool = new Pool({ connectionString: dsn });

  async function creaStagioneDiTest(): Promise<string> {
    const suffisso = randomUUID().slice(0, 8);
    const r = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine)
       VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione motore ${suffisso}`],
    );
    return r.rows[0]!.id;
  }

  async function creaUtenteBackofficeDiTest(ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
    const suffisso = randomUUID().slice(0, 8);
    const email = `${ruolo}-motore-${suffisso}@test.local`;
    const hash = await hashPassword('password-test-123456');
    const r = await pool.query<{ id: string }>(
      `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
       VALUES ($1, $2, 'Test', 'Motore', $3, 'attivo') RETURNING id`,
      [email, hash, ruolo],
    );
    const id = r.rows[0]!.id;
    return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
  }

  const creaAdminDiTest = () => creaUtenteBackofficeDiTest('admin');
  const creaOperatoreDiTest = () => creaUtenteBackofficeDiTest('operatore');

  // Fixture minima per simulare "istruttoria già eseguita" su una stagione: una domanda
  // 'ammessa' con la sua riga fabbisogni_riconosciuti collegata. Rispetta tutte le colonne
  // NOT NULL reali di domande/fabbisogni_riconosciuti (db/migrations/000001_init.up.sql:267+
  // e :362+) — non è la creaDomanda() di produzione (quella richiede slot/preferenze/ecc.,
  // fuori scope per questo fixture), solo un INSERT diretto minimo e valido.
  async function creaIstruttoriaEseguitaDiTest(stagioneId: string): Promise<void> {
    const suffisso = randomUUID().slice(0, 8);

    const persona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
      [`MTR${suffisso.toUpperCase()}`, randomUUID()],
    );

    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
      [`Associazione motore ${suffisso}`, `PIVA-${suffisso}`],
    );

    const domanda = await pool.query<{ id: string }>(
      `INSERT INTO domande
         (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
          fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
       VALUES ($1, $2, $3, $4, 60, 60, 'ammessa') RETURNING id`,
      [`DOM-TEST-${suffisso}`, associazione.rows[0]!.id, stagioneId, persona.rows[0]!.id],
    );

    const versioneParam = await pool.query<{ id: string }>(
      `SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`,
    );

    await pool.query(
      `INSERT INTO fabbisogni_riconosciuti
         (domanda_id, parametrico_versione_id, peso_base, incremento_squadre, fr_calcolato_minuti, fd_minuti, fr_finale_minuti)
       VALUES ($1, $2, 1, 0, 60, 60, 60)`,
      [domanda.rows[0]!.id, versioneParam.rows[0]!.id],
    );
  }

  function clientMotoreFittizio(overrides: Partial<ClientMotore>): ClientMotore {
    return {
      eseguiIstruttoria: overrides.eseguiIstruttoria ?? (async () => ({ domandeCalcolate: 0 })),
      eseguiBlocchiGara:
        overrides.eseguiBlocchiGara ??
        (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, richiesteNonAssegnate: 0 })),
      eseguiPrimaAssegnazione:
        overrides.eseguiPrimaAssegnazione ??
        (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
    };
  }

  function avviaApp(dipendenze: DipendenzeApp) {
    return creaApp(pool, dipendenze);
  }

  test('POST .../istruttoria: 200 e audit log su successo', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({ eseguiIstruttoria: async () => ({ domandeCalcolate: 3 }) }) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { domandeCalcolate: number };
      assert.equal(body.domandeCalcolate, 3);

      const log = await pool.query(
        `SELECT azione FROM log_operazioni WHERE entita_tipo = 'stagioni_sportive' AND entita_id = $1 AND azione = 'esegui_istruttoria'`,
        [stagioneId],
      );
      assert.equal(log.rows.length, 1);
    } finally {
      server.close();
    }
  });

  test('POST .../istruttoria: 403 per operatore', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaOperatoreDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 403);
    } finally {
      server.close();
    }
  });

  test('POST .../blocchi-gara: 409 se istruttoria non ancora eseguita', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/blocchi-gara`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 409);

      // Finding 3 (review finale "coda motore Go"): un'esecuzione che fallisce PRIMA di
      // chiamare il motore (qui: guardia sull'ordine delle fasi) non deve lasciare traccia
      // in log_operazioni — la transazione fa ROLLBACK, l'INSERT dell'audit log non è mai
      // stato eseguito (non era stato ancora raggiunto).
      const log = await pool.query(
        `SELECT count(*)::int AS n FROM log_operazioni WHERE entita_tipo = 'stagioni_sportive' AND entita_id = $1 AND azione = 'esegui_blocchi_gara'`,
        [stagioneId],
      );
      assert.equal(log.rows[0]!.n, 0);
    } finally {
      server.close();
    }
  });

  // Finding 1 (review finale "coda motore Go"): una stagione UUID-valida ma inesistente
  // deve dare 404, non un 200/409/502/500 come prima del fix.
  test('POST .../istruttoria: 404 su stagione inesistente, motore mai chiamato', async () => {
    const stagioneInesistente = randomUUID();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({
      clientMotore: clientMotoreFittizio({
        eseguiIstruttoria: async () => {
          throw new Error('eseguiIstruttoria NON deve essere chiamato per una stagione inesistente');
        },
      }),
    });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneInesistente}/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 404);

      const log = await pool.query(
        `SELECT count(*)::int AS n FROM log_operazioni WHERE entita_tipo = 'stagioni_sportive' AND entita_id = $1`,
        [stagioneInesistente],
      );
      assert.equal(log.rows[0]!.n, 0);
    } finally {
      server.close();
    }
  });

  test('GET .../elaborazioni: 404 su stagione inesistente', async () => {
    const stagioneInesistente = randomUUID();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneInesistente}/elaborazioni`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 404);
    } finally {
      server.close();
    }
  });

  test('POST .../prima-assegnazione: 200 quando istruttoria già eseguita (fabbisogni_riconosciuti presenti)', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    await creaIstruttoriaEseguitaDiTest(stagioneId);

    const app = avviaApp({
      clientMotore: clientMotoreFittizio({
        eseguiPrimaAssegnazione: async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 5, roundEseguiti: 2 }),
      }),
    });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/prima-assegnazione`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { elaborazioneId: string; numeroAssegnazioni: number; roundEseguiti: number };
      assert.equal(body.numeroAssegnazioni, 5);
      assert.equal(body.roundEseguiti, 2);
      assert.equal(typeof body.elaborazioneId, 'string');
    } finally {
      server.close();
    }
  });

  test('POST .../blocchi-gara: 502 se il motore è irraggiungibile', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    await creaIstruttoriaEseguitaDiTest(stagioneId);

    const app = avviaApp({
      clientMotore: clientMotoreFittizio({
        eseguiBlocchiGara: async () => {
          throw new ErroreMotoreIrraggiungibile('simulato');
        },
      }),
    });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/blocchi-gara`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 502);

      // Finding 3: il motore ha fallito PRIMA del registraOperazione (fuori transazione
      // riuscita) — ROLLBACK, nessuna riga di audit per questa esecuzione.
      const log = await pool.query(
        `SELECT count(*)::int AS n FROM log_operazioni WHERE entita_tipo = 'stagioni_sportive' AND entita_id = $1 AND azione = 'esegui_blocchi_gara'`,
        [stagioneId],
      );
      assert.equal(log.rows[0]!.n, 0);
    } finally {
      server.close();
    }
  });

  test('POST .../istruttoria: 500 con messaggio del motore su ErroreMotoreDominio', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({
      clientMotore: clientMotoreFittizio({
        eseguiIstruttoria: async () => {
          throw new ErroreMotoreDominio('stagione priva di domande ammesse');
        },
      }),
    });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 500);
      const body = (await res.json()) as { errore: string };
      assert.equal(body.errore, 'stagione priva di domande ammesse');

      // Finding 3: stesso motivo del test 502 sopra.
      const log = await pool.query(
        `SELECT count(*)::int AS n FROM log_operazioni WHERE entita_tipo = 'stagioni_sportive' AND entita_id = $1 AND azione = 'esegui_istruttoria'`,
        [stagioneId],
      );
      assert.equal(log.rows[0]!.n, 0);
    } finally {
      server.close();
    }
  });

  test('POST .../istruttoria: 400 su stagioneId malformato', async () => {
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/non-un-uuid/istruttoria`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 400);
    } finally {
      server.close();
    }
  });

  // Regressione del finding Important (review Task 3): stagioneId malformato deve essere
  // rifiutato PRIMA di chiamare il motore Go, su tutte e tre le route — non solo su
  // istruttoria (dove nessuna query DB intermedia lo avrebbe intercettato). Il client
  // fittizio qui lancia se invocato: se la fix regredisse, il test fallirebbe con l'errore
  // del fittizio propagato (o comunque non con 400), non silenziosamente.
  function clientMotoreCheAssertaSeInvocato(): ClientMotore {
    return {
      eseguiIstruttoria: async () => {
        throw new Error('eseguiIstruttoria NON deve essere chiamato con uno stagioneId malformato');
      },
      eseguiBlocchiGara: async () => {
        throw new Error('eseguiBlocchiGara NON deve essere chiamato con uno stagioneId malformato');
      },
      eseguiPrimaAssegnazione: async () => {
        throw new Error('eseguiPrimaAssegnazione NON deve essere chiamato con uno stagioneId malformato');
      },
    };
  }

  for (const rotta of ['istruttoria', 'blocchi-gara', 'prima-assegnazione'] as const) {
    test(`POST .../${rotta}: 400 su stagioneId malformato, il motore non viene MAI chiamato`, async () => {
      const { token } = await creaAdminDiTest();
      const app = avviaApp({ clientMotore: clientMotoreCheAssertaSeInvocato() });
      const server = app.listen(0);
      try {
        const porta = (server.address() as { port: number }).port;
        const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/non-un-uuid/${rotta}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(res.status, 400);
      } finally {
        server.close();
      }
    });
  }

  test('GET .../elaborazioni: lista vuota per una stagione senza elaborazioni', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/elaborazioni`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as unknown[];
      assert.deepEqual(body, []);
    } finally {
      server.close();
    }
  });

  test('GET .../elaborazioni: righe ordinate per data decrescente, accessibile a operatore', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token: tokenAdmin } = await creaAdminDiTest();
    const { token: tokenOperatore } = await creaOperatoreDiTest();

    const versioneParam = await pool.query<{ id: string }>(
      `SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`,
    );
    const parametricoVersioneId = versioneParam.rows[0]!.id;

    await pool.query(
      `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato, numero_round_eseguiti)
       VALUES ($1, 'prima_assegnazione', $2, 'completata', 3)`,
      [stagioneId, parametricoVersioneId],
    );
    await pool.query(
      `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato)
       VALUES ($1, 'blocchi_gara', $2, 'completata')`,
      [stagioneId, parametricoVersioneId],
    );

    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/elaborazioni`, {
        headers: { authorization: `Bearer ${tokenOperatore}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as Array<{ tipo: string }>;
      assert.equal(body.length, 2);
      // iniziata_il DESC: l'ultima INSERT (blocchi_gara) viene prima.
      assert.equal(body[0]!.tipo, 'blocchi_gara');
      assert.equal(body[1]!.tipo, 'prima_assegnazione');

      const resAdmin = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/elaborazioni`, {
        headers: { authorization: `Bearer ${tokenAdmin}` },
      });
      assert.equal(resAdmin.status, 200);
    } finally {
      server.close();
    }
  });

  test('GET .../elaborazioni: 400 su stagioneId malformato', async () => {
    const { token } = await creaAdminDiTest();
    const app = avviaApp({ clientMotore: clientMotoreFittizio({}) });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${porta}/backoffice/stagioni/non-un-uuid/elaborazioni`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 400);
    } finally {
      server.close();
    }
  });

  // Finding 4 (review finale "coda motore Go"): due esecuzioni concorrenti sulla STESSA
  // stagione devono serializzarsi tramite il lock non-bloccante (Finding 2) — la seconda
  // che arriva mentre la prima tiene ancora il lock advisory deve ricevere 409 "in corso"
  // immediatamente, non accodarsi. Il client motore fittizio ritarda la risposta della
  // PRIMA chiamata (tramite un flag condiviso: la prima invocazione attende un segnale,
  // dando tempo alla seconda richiesta HTTP di arrivare ed essere respinta dal lock prima
  // che la prima transazione faccia COMMIT). Stile Promise.all su due richieste in corsa,
  // come repository/utentiBackoffice.test.ts (righe ~284) e osservazioni.test.ts (riga
  // ~177), qui applicato a HTTP end-to-end invece che a due chiamate dirette a repository.
  test('POST .../istruttoria: due esecuzioni concorrenti sulla stessa stagione si serializzano (409 sulla seconda)', async () => {
    const stagioneId = await creaStagioneDiTest();
    const { token } = await creaAdminDiTest();

    let chiamateInCorso = 0;
    const app = avviaApp({
      clientMotore: clientMotoreFittizio({
        eseguiIstruttoria: async () => {
          chiamateInCorso += 1;
          // Ritarda la risposta abbastanza da lasciare la transazione (e quindi il lock
          // advisory) aperta mentre la seconda richiesta HTTP viene inviata e valutata.
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { domandeCalcolate: chiamateInCorso };
        },
      }),
    });
    const server = app.listen(0);
    try {
      const porta = (server.address() as { port: number }).port;
      const url = `http://127.0.0.1:${porta}/backoffice/stagioni/${stagioneId}/istruttoria`;

      const primaRichiesta = fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      // Piccolo ritardo per garantire che la prima richiesta abbia già preso il lock
      // (BEGIN + pg_try_advisory_xact_lock) prima che parta la seconda.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const secondaRichiesta = fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` } });

      const [resPrima, resSeconda] = await Promise.all([primaRichiesta, secondaRichiesta]);
      const stati = [resPrima.status, resSeconda.status].sort();
      assert.deepEqual(stati, [200, 409]);

      const corpoSeconda = resSeconda.status === 409 ? await resSeconda.json() : await resPrima.json();
      if (resSeconda.status === 409) {
        assert.match((corpoSeconda as { errore: string }).errore, /in corso/);
      }

      // Solo l'esecuzione andata a buon fine ha scritto l'audit log: mai due righe per
      // due esecuzioni "concorrenti" quando una delle due è stata respinta dal lock.
      const log = await pool.query(
        `SELECT count(*)::int AS n FROM log_operazioni WHERE entita_tipo = 'stagioni_sportive' AND entita_id = $1 AND azione = 'esegui_istruttoria'`,
        [stagioneId],
      );
      assert.equal(log.rows[0]!.n, 1);
    } finally {
      server.close();
    }
  });
}
