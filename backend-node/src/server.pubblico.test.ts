import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp, type DipendenzeApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import type { ClientMotore } from './engine/client.ts';
import { ErroreMotoreIrraggiungibile } from './engine/client.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool, dipendenze: DipendenzeApp = {}): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool, dipendenze);
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

// Body minimo valido per POST /pubblico/associazioni con tutti i campi obbligatori
// introdotti dall'estensione anagrafica (Task 2/3). rappresentanteLegaleNome/Cognome
// combaciano di default con 'Mario'/'Rossi' (persona di test), dato che la validazione
// anti-frode del Task 3 richiede che il RL o il delegato dichiarato combaci con la
// persona autenticata.
function corpoAssociazioneCompleto(overrides: Record<string, unknown> = {}) {
  return {
    denominazione: 'ASD Volley Pescara',
    codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
    rappresentanteLegaleNome: 'Mario',
    rappresentanteLegaleCognome: 'Rossi',
    indirizzoVia: 'Via Milano 10',
    indirizzoCivico: '10',
    indirizzoCitta: 'Pescara',
    email: 'asd-volley@example.com',
    tipologiaSoggetto: 'associazione_sportiva',
    iscrittaRasd: false,
    haPersonaleAssunto: false,
    referenteSicurezza: referenteTest,
    referenteEmergenzeDae: referenteEmergenzeDaeTest,
    assicurazioneRct: assicurazioneTest,
    ...overrides,
  };
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
        body: JSON.stringify(corpoAssociazioneCompleto({ stagioneId })),
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
      const dati = corpoAssociazioneCompleto({ denominazione: 'ASD Duplicata', codiceFiscalePartitaIva: piva, stagioneId });
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
        body: JSON.stringify(corpoAssociazioneCompleto({ denominazione: 'ASD Fantasma', stagioneId: randomUUID() })),
      });
      assert.equal(r.status, 400);
    });

    await t.test('delegato dichiarato combacia con la persona autenticata, RL diverso: 201 (match sul delegato), titolo = delegato', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(
          corpoAssociazioneCompleto({
            stagioneId,
            rappresentanteLegaleNome: 'Giuseppe',
            rappresentanteLegaleCognome: 'Verdi',
            delegatoNome: 'Mario',
            delegatoCognome: 'Rossi',
          }),
        ),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string };
      // Finding 5 della code review finale del branch: quando il match anti-frode è
      // avvenuto sul Delegato dichiarato (non sul RL), il titolo dell'abilitazione
      // deve riflettere quella capacità — 'delegato', non 'legale_rappresentante'.
      const abilitazione = await pool.query(
        `SELECT titolo, ruolo FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2`,
        [persona.id, body.id],
      );
      assert.equal(abilitazione.rows[0]?.titolo, 'delegato');
      assert.equal(abilitazione.rows[0]?.ruolo, 'rappresentante');
    });

    await t.test('delegato dichiarato NON combacia con la persona autenticata: 400', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(
          corpoAssociazioneCompleto({
            stagioneId,
            delegatoNome: 'Altro',
            delegatoCognome: 'Delegato',
          }),
        ),
      });
      assert.equal(r.status, 400);
    });

    await t.test('nessun delegato, RL diverso dalla persona autenticata: 400', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(
          corpoAssociazioneCompleto({
            stagioneId,
            rappresentanteLegaleNome: 'Giuseppe',
            rappresentanteLegaleCognome: 'Verdi',
          }),
        ),
      });
      assert.equal(r.status, 400);
    });

    await t.test('iscrittaRasd true senza organismoSportivoCodice: 400', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(corpoAssociazioneCompleto({ stagioneId, iscrittaRasd: true })),
      });
      assert.equal(r.status, 400);
    });

    await t.test('haPersonaleAssunto true senza assicurazioneRco: 400', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(corpoAssociazioneCompleto({ stagioneId, haPersonaleAssunto: true })),
      });
      assert.equal(r.status, 400);
    });

    await t.test('haPersonaleAssunto true con assicurazioneRco: 201, riga assicurazioni_assicurazioni tipo rco creata', async () => {
      const r = await fetch(`${base}/pubblico/associazioni`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
        body: JSON.stringify(
          corpoAssociazioneCompleto({
            stagioneId,
            haPersonaleAssunto: true,
            assicurazioneRco: assicurazioneTest,
          }),
        ),
      });
      assert.equal(r.status, 201);
      const body = (await r.json()) as { id: string };

      const rco = await pool.query(
        `SELECT tipo FROM associazioni_assicurazioni WHERE associazione_id = $1 AND tipo = 'rco'`,
        [body.id],
      );
      assert.equal(rco.rows.length, 1);
    });
  },
);

test(
  'GET /organismi-sportivi',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    await t.test('200, array non vuoto, nessuna autenticazione richiesta', async () => {
      const r = await fetch(`${base}/organismi-sportivi`);
      assert.equal(r.status, 200);
      const body = (await r.json()) as Array<{ codice: string; denominazione: string }>;
      assert.ok(Array.isArray(body));
      assert.ok(body.length > 0);
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
      body: JSON.stringify(corpoAssociazioneCompleto({ denominazione: 'ASD Delega Test', stagioneId })),
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

    await t.test('delegante operatore NON può assegnare ruolo rappresentante: 403', async () => {
      const cfDelegatoOperatore = `TSTOPR${randomUUID().slice(0, 10).toUpperCase()}`;
      const rOperatore = await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rappresentante.token}` },
        body: JSON.stringify({
          codiceFiscale: cfDelegatoOperatore,
          nome: 'Delegato',
          cognome: 'Operatore',
          associazioneId: associazione.id,
          stagioneId,
          ruolo: 'operatore',
        }),
      });
      assert.equal(rOperatore.status, 201);
      const delegatoOperatore = (await rOperatore.json()) as { personaFisicaId: string };

      // login del delegato operatore per ottenere un token proprio, poi tenta di
      // creare una sub-sub-delega con ruolo='rappresentante' — deve essere rifiutata.
      const tokenOperatore = generaAccessTokenPubblico({
        sub: delegatoOperatore.personaFisicaId,
        codiceFiscale: cfDelegatoOperatore,
        nome: 'Delegato',
        cognome: 'Operatore',
      });
      const r = await fetch(`${base}/pubblico/deleghe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOperatore}` },
        body: JSON.stringify({
          codiceFiscale: `TSTESC${randomUUID().slice(0, 10).toUpperCase()}`,
          nome: 'Escalation',
          cognome: 'Test',
          associazioneId: associazione.id,
          stagioneId,
          ruolo: 'rappresentante',
        }),
      });
      assert.equal(r.status, 403);
    });
  },
);

test('GET /discipline: 200, array, nessuna autenticazione richiesta', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const r = await fetch(`${base}/discipline`);
  assert.equal(r.status, 200);
  const corpo = (await r.json()) as unknown[];
  assert.ok(Array.isArray(corpo));
});

test('GET /classi-attivita: 200, 5 elementi, nessuna autenticazione richiesta', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const r = await fetch(`${base}/classi-attivita`);
  assert.equal(r.status, 200);
  const corpo = (await r.json()) as unknown[];
  assert.equal(corpo.length, 5);
});

test('GET /pubblico/stagioni/:id/slot', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const stagioneId = await creaStagioneTest(pool);
  const persona = await creaPersonaFisicaTest(pool);

  const impianto = await pool.query<{ id: string }>(
    `INSERT INTO impianti (denominazione) VALUES ('Impianto Slot Pubblico Test') RETURNING id`,
  );
  const spazio = await pool.query<{ id: string }>(
    `INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, 'Palestra Slot Pubblico Test') RETURNING id`,
    [impianto.rows[0]!.id],
  );
  const slot = await pool.query<{ id: string }>(
    `INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine)
     VALUES ($1, $2, 2, '18:00', '19:00') RETURNING id`,
    [stagioneId, spazio.rows[0]!.id],
  );
  const disciplinaCodice = `SLOTPUB${randomUUID().slice(0, 6).toUpperCase()}`;
  await pool.query(
    `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, 'Disciplina Slot Pubblico Test')`,
    [disciplinaCodice],
  );

  await t.test('senza token: 401', async () => {
    const r = await fetch(`${base}/pubblico/stagioni/${stagioneId}/slot`);
    assert.equal(r.status, 401);
  });

  await t.test('con token, senza filtro disciplina: lo slot compare', async () => {
    const r = await fetch(`${base}/pubblico/stagioni/${stagioneId}/slot`, {
      headers: { Authorization: `Bearer ${persona.token}` },
    });
    assert.equal(r.status, 200);
    const corpo = (await r.json()) as Array<{ id: string }>;
    assert.ok(corpo.some((s) => s.id === slot.rows[0]!.id));
  });

  await t.test('con disciplinaCodice non compatibile con lo spazio: lista vuota', async () => {
    const altraDisciplina = `SLOTNOPE${randomUUID().slice(0, 6).toUpperCase()}`;
    await pool.query(
      `INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, 'Disciplina Non Compatibile Test')`,
      [altraDisciplina],
    );
    const r = await fetch(`${base}/pubblico/stagioni/${stagioneId}/slot?disciplinaCodice=${altraDisciplina}`, {
      headers: { Authorization: `Bearer ${persona.token}` },
    });
    assert.equal(r.status, 200);
    const corpo = (await r.json()) as unknown[];
    assert.equal(corpo.length, 0);
  });

  await t.test('con disciplinaCodice compatibile: lo slot compare', async () => {
    await pool.query(
      `INSERT INTO spazio_disciplina_compatibile (spazio_id, disciplina_codice) VALUES ($1, $2)`,
      [spazio.rows[0]!.id, disciplinaCodice],
    );
    const r = await fetch(`${base}/pubblico/stagioni/${stagioneId}/slot?disciplinaCodice=${disciplinaCodice}`, {
      headers: { Authorization: `Bearer ${persona.token}` },
    });
    assert.equal(r.status, 200);
    const corpo = (await r.json()) as Array<{ id: string }>;
    assert.ok(corpo.some((s) => s.id === slot.rows[0]!.id));
  });
});

// --- POST /pubblico/domande/anteprima-fabbisogno (proxy verso il motore Go, Task 3) ---
//
// Stesso pattern usato in server.motoreGo.test.ts: un ClientMotore fittizio iniettato via
// DipendenzeApp, MAI un mock di `fetch` — il proxy verso il motore reale è responsabilità di
// engine/client.ts (chiamaMotore), qui testiamo solo che la rotta lo invochi/mappi correttamente.
function clientMotoreFittizioAnteprima(overrides: Partial<ClientMotore> = {}): ClientMotore {
  return {
    eseguiIstruttoria: overrides.eseguiIstruttoria ?? (async () => ({ domandeCalcolate: 0 })),
    eseguiBlocchiGara:
      overrides.eseguiBlocchiGara ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, richiesteNonAssegnate: 0 })),
    eseguiPrimaAssegnazione:
      overrides.eseguiPrimaAssegnazione ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
    eseguiRiassegnazioneResidua:
      overrides.eseguiRiassegnazioneResidua ?? (async () => ({ elaborazioneId: randomUUID(), numeroAssegnazioni: 0, roundEseguiti: 0 })),
    anteprimaFabbisogno:
      overrides.anteprimaFabbisogno ??
      (async () => ({
        pesoBase: 1,
        incrementoSquadre: 0,
        frCalcolatoMinuti: '60.000',
        frFinaleMinuti: '60.000',
        crs: '1.000',
        caa: '1.000',
        csd: '1.000',
        cp: '1.000',
      })),
  };
}

const corpoAnteprimaFabbisognoValido = (associazioneId: string, stagioneId: string) => ({
  associazioneId,
  stagioneId,
  classeAttivitaCodice: 'C1',
  numeroSquadreFederali: 2,
  fdMinuti: '90.000',
});

test('POST /pubblico/domande/anteprima-fabbisogno: 200, corpo combacia con la risposta del motore', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, {
    clientMotore: clientMotoreFittizioAnteprima({
      anteprimaFabbisogno: async () => ({
        pesoBase: 2,
        incrementoSquadre: 1,
        frCalcolatoMinuti: '120.000',
        frFinaleMinuti: '150.000',
        crs: '1.200',
        caa: '1.100',
        csd: '1.050',
        cp: '1.386',
      }),
    }),
  });
  t.after(chiudi);

  const persona = await creaPersonaFisicaTest(pool);
  const stagioneId = await creaStagioneTest(pool);
  const associazioneId = randomUUID();

  const r = await fetch(`${base}/pubblico/domande/anteprima-fabbisogno`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(corpoAnteprimaFabbisognoValido(associazioneId, stagioneId)),
  });
  assert.equal(r.status, 200);
  const body = (await r.json()) as {
    pesoBase: number;
    incrementoSquadre: number;
    frCalcolatoMinuti: string;
    frFinaleMinuti: string;
    crs: string;
    caa: string;
    csd: string;
    cp: string;
  };
  assert.deepEqual(body, {
    pesoBase: 2,
    incrementoSquadre: 1,
    frCalcolatoMinuti: '120.000',
    frFinaleMinuti: '150.000',
    crs: '1.200',
    caa: '1.100',
    csd: '1.050',
    cp: '1.386',
  });
});

test('POST /pubblico/domande/anteprima-fabbisogno: senza autenticazione, 401', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, { clientMotore: clientMotoreFittizioAnteprima() });
  t.after(chiudi);

  const stagioneId = await creaStagioneTest(pool);
  const r = await fetch(`${base}/pubblico/domande/anteprima-fabbisogno`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpoAnteprimaFabbisognoValido(randomUUID(), stagioneId)),
  });
  assert.equal(r.status, 401);
});

test('POST /pubblico/domande/anteprima-fabbisogno: senza clientMotore configurato, 503', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  // Nessun dipendenze.clientMotore passato: DipendenzeApp() default {} → creaApp calcola
  // clientMotore da ENGINE_URL, che non è impostato nell'ambiente di test → null.
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const persona = await creaPersonaFisicaTest(pool);
  const stagioneId = await creaStagioneTest(pool);
  const r = await fetch(`${base}/pubblico/domande/anteprima-fabbisogno`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(corpoAnteprimaFabbisognoValido(randomUUID(), stagioneId)),
  });
  assert.equal(r.status, 503);
});

test('POST /pubblico/domande/anteprima-fabbisogno: body non valido (fdMinuti non numerico), 400', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, { clientMotore: clientMotoreFittizioAnteprima() });
  t.after(chiudi);

  const persona = await creaPersonaFisicaTest(pool);
  const stagioneId = await creaStagioneTest(pool);
  const corpo = { ...corpoAnteprimaFabbisognoValido(randomUUID(), stagioneId), fdMinuti: 'non-un-numero' };

  const r = await fetch(`${base}/pubblico/domande/anteprima-fabbisogno`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(corpo),
  });
  assert.equal(r.status, 400);
});

test('POST /pubblico/domande/anteprima-fabbisogno: motore irraggiungibile, 502', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool, {
    clientMotore: clientMotoreFittizioAnteprima({
      anteprimaFabbisogno: async () => {
        throw new ErroreMotoreIrraggiungibile('simulato');
      },
    }),
  });
  t.after(chiudi);

  const persona = await creaPersonaFisicaTest(pool);
  const stagioneId = await creaStagioneTest(pool);
  const r = await fetch(`${base}/pubblico/domande/anteprima-fabbisogno`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(corpoAnteprimaFabbisognoValido(randomUUID(), stagioneId)),
  });
  assert.equal(r.status, 502);
});
