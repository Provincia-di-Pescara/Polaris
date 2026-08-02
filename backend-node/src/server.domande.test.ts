import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';

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
  const cf = `TSTDOM${randomUUID().slice(0, 10).toUpperCase()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessTokenPubblico({ sub: id, codiceFiscale: cf, nome: 'Mario', cognome: 'Rossi' });
  return { id, token };
}

async function creaFixtureCompleta(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto HTTP test ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra HTTP test', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo A', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-domanda-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD HTTP test ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const associazioneId = associazione.rows[0]!.id;
  return { disciplinaCodice: disciplina.codice, stagioneId, slotId: slot.id, associazioneId };
}

async function creaUtenteBackofficeTest(pool: Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `domande-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Domande', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

async function corpoDomandaValido(fx: Awaited<ReturnType<typeof creaFixtureCompleta>>) {
  return {
    associazioneId: fx.associazioneId,
    stagioneId: fx.stagioneId,
    disciplineCodici: [fx.disciplinaCodice],
    numeroTesserati: 10,
    numeroAtletiPartecipanti: 8,
    numeroSquadre: 1,
    numeroSquadreFederaliStagionePrecedente: 0,
    fabbisognoMinimoMinuti: '60.000',
    fabbisognoOttimaleMinuti: '60.000',
    preferenze: [fx.slotId],
    blocchiAllenamento: [],
    richiedeGiornataGara: false,
    richiesteGiornataGara: [],
  };
}

test('POST /pubblico/domande', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  await t.test('senza abilitazione: 403', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(await corpoDomandaValido(fx)),
    });
    assert.equal(r.status, 403);
  });

  await t.test('con abilitazione approvata: 201, log scritto', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(await corpoDomandaValido(fx)),
    });
    assert.equal(r.status, 201);
    const body = (await r.json()) as { id: string; numeroProtocollo: string };
    assert.match(body.numeroProtocollo, /^DOM-\d{4}-\d{6}$/);

    const log = await pool.query(`SELECT azione FROM log_operazioni WHERE azione = 'crea_domanda' AND entita_id = $1`, [body.id]);
    assert.equal(log.rows.length, 1);
  });

  await t.test('doppia domanda stessa associazione+stagione: 409', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const corpo = await corpoDomandaValido(fx);
    const primo = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(primo.status, 201);
    const secondo = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(secondo.status, 409);
  });

  await t.test('fabbisognoOttimale < fabbisognoMinimo: 400', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const corpo = { ...(await corpoDomandaValido(fx)), fabbisognoMinimoMinuti: '100.000', fabbisognoOttimaleMinuti: '50.000' };
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(r.status, 400);
  });

  await t.test('blocco con slot non tra le preferenze: 400', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const slot2 = await creaSlot(pool, { stagioneId: fx.stagioneId, spazioId: (await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [fx.slotId])).rows[0]!.spazio_id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });
    const corpo = { ...(await corpoDomandaValido(fx)), blocchiAllenamento: [[fx.slotId, slot2.id]] };
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(r.status, 400);
  });

  await t.test('richiedeGiornataGara=true con richiesteGiornataGara vuoto: 400', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const corpo = { ...(await corpoDomandaValido(fx)), richiedeGiornataGara: true };
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(r.status, 400);
  });

  // I5: uno slot valido (UUID esistente) ma appartenente a UN'ALTRA stagione — la sola
  // validazione FK lo accetterebbe, il motore Go a valle lo ignorerebbe silenziosamente.
  await t.test('slot in preferenze appartenente ad altra stagione: 400', async () => {
    const persona = await creaPersonaFisicaTest(pool);
    const fx = await creaFixtureCompleta(pool);
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [persona.id, fx.associazioneId, fx.stagioneId],
    );
    const altraStagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`stagione-domanda-i5-${randomUUID()}`],
    );
    const spazioId = (await pool.query<{ spazio_id: string }>(`SELECT spazio_id FROM slot_settimana_tipo WHERE id = $1`, [fx.slotId])).rows[0]!.spazio_id;
    const slotAltraStagione = await creaSlot(pool, {
      stagioneId: altraStagione.rows[0]!.id,
      spazioId,
      giornoSettimana: 3,
      orarioInizio: '18:00',
      orarioFine: '19:00',
    });
    const corpo = { ...(await corpoDomandaValido(fx)), preferenze: [slotAltraStagione.id] };
    const r = await fetch(`${base}/pubblico/domande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify(corpo),
    });
    assert.equal(r.status, 400);
  });
});

test('GET /pubblico/associazioni/:id/domande e GET /pubblico/domande/:id', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const altraPersona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };

  await t.test('lista propria: 200', async () => {
    const r = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/domande`, {
      headers: { Authorization: `Bearer ${persona.token}` },
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as unknown[];
    assert.equal(body.length, 1);
  });

  await t.test('lista di associazione altrui: 403', async () => {
    const r = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/domande`, {
      headers: { Authorization: `Bearer ${altraPersona.token}` },
    });
    assert.equal(r.status, 403);
  });

  await t.test('dettaglio proprio: 200', async () => {
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert.equal(r.status, 200);
  });

  await t.test('dettaglio di associazione altrui: 403', async () => {
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${altraPersona.token}` } });
    assert.equal(r.status, 403);
  });

  await t.test('dettaglio inesistente: 404', async () => {
    const r = await fetch(`${base}/pubblico/domande/${randomUUID()}`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert.equal(r.status, 404);
  });

  await t.test('dettaglio id malformato: 400', async () => {
    const r = await fetch(`${base}/pubblico/domande/non-un-uuid`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert.equal(r.status, 400);
  });

  // I2: la persona ha un'abilitazione approvata sulla stessa associazione ma su una
  // stagione DIVERSA da quella della domanda — non deve poter vedere il dettaglio.
  await t.test('dettaglio: abilitazione approvata su altra stagione della stessa associazione: 403', async () => {
    const personaAltraStagione = await creaPersonaFisicaTest(pool);
    const altraStagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2027-09-01', '2028-06-30') RETURNING id`,
      [`stagione-domanda-i2-${randomUUID()}`],
    );
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [personaAltraStagione.id, fx.associazioneId, altraStagione.rows[0]!.id],
    );
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${personaAltraStagione.token}` } });
    assert.equal(r.status, 403);
  });
});

test('PUT /backoffice/domande/:id/{ammetti,escludi}, GET /backoffice/domande', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };

  const operatore = await creaUtenteBackofficeTest(pool, 'operatore');

  await t.test('pubblico non può ammettere: 401', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, { method: 'PUT' });
    assert.equal(r.status, 401);
  });

  await t.test('operatore ammette: 200', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { stato: string };
    assert.equal(body.stato, 'ammessa');
  });

  await t.test('doppia ammissione: 409', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(r.status, 409);
  });

  await t.test('escludi su domanda già ammessa: 409', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}/escludi`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
      body: JSON.stringify({ motivazione: 'test' }),
    });
    assert.equal(r.status, 409);
  });

  await t.test('lista backoffice: 200, contiene la domanda', async () => {
    const r = await fetch(`${base}/backoffice/domande?stagioneId=${fx.stagioneId}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { id: string }[];
    assert.ok(body.some((d) => d.id === domanda.id));
  });

  await t.test('lista backoffice con stagioneId malformato: 400, non 500', async () => {
    const r = await fetch(`${base}/backoffice/domande?stagioneId=non-un-uuid`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    assert.equal(r.status, 400);
  });

  await t.test('dettaglio backoffice: 200, fabbisognoRiconosciuto null', async () => {
    const r = await fetch(`${base}/backoffice/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { fabbisognoRiconosciuto: unknown };
    assert.equal(body.fabbisognoRiconosciuto, null);
  });
});

test('GET /pubblico/stagioni/:id/domande/esiti', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };

  await t.test('senza token: 401', async () => {
    const r = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/domande/esiti`);
    assert.equal(r.status, 401);
  });

  await t.test('prima della decisione: lista vuota', async () => {
    const r = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/domande/esiti`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
  });

  const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
  await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, { method: 'PUT', headers: { Authorization: `Bearer ${operatore.token}` } });

  await t.test('dopo ammissione: presente, esito ammessa', async () => {
    const r = await fetch(`${base}/pubblico/stagioni/${fx.stagioneId}/domande/esiti`, { headers: { Authorization: `Bearer ${persona.token}` } });
    const body = (await r.json()) as { domandaId: string; stato: string }[];
    assert.ok(body.some((e) => e.domandaId === domanda.id && e.stato === 'ammessa'));
  });
});

test('POST /pubblico/domande/:id/osservazioni', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };

  await t.test('domanda ancora presentata: 409', async () => {
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify({ testo: 'troppo presto' }),
    });
    assert.equal(r.status, 409);
  });

  const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
  await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, { method: 'PUT', headers: { Authorization: `Bearer ${operatore.token}` } });

  await t.test('dopo ammissione: 201, domanda.stato invariato (ammessa), riesameStato passa a richiesto, audit log su domande (I6)', async () => {
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
      body: JSON.stringify({ testo: 'non concordo con FR' }),
    });
    assert.equal(r.status, 201);
    // C1: la risposta HTTP dell'osservazione non porta domandaTransitata/nuovoRiesameStato
    // (canale interno verso la route, N3) — solo i campi legittimi di Osservazione.
    const corpoOsservazione = (await r.json()) as Record<string, unknown>;
    assert.equal('domandaTransitata' in corpoOsservazione, false);
    assert.equal('nuovoRiesameStato' in corpoOsservazione, false);

    const dettaglio = await fetch(`${base}/pubblico/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${persona.token}` } });
    const body = (await dettaglio.json()) as { stato: string; riesameStato: string };
    // Il motore Go legge domande.stato con uguaglianza esatta: deve restare 'ammessa'
    // (C1) — il riesame vive solo su riesameStato.
    assert.equal(body.stato, 'ammessa');
    assert.equal(body.riesameStato, 'richiesto');

    const logDomanda = await pool.query(
      `SELECT azione FROM log_operazioni WHERE entita_tipo = 'domande' AND entita_id = $1 AND azione = 'osservazione_richiede_riesame'`,
      [domanda.id],
    );
    assert.equal(logDomanda.rows.length, 1);
    const logOsservazione = await pool.query(
      `SELECT azione FROM log_operazioni WHERE entita_tipo = 'osservazioni_istruttoria' AND azione = 'presenta_osservazione'`,
    );
    assert.ok(logOsservazione.rows.length >= 1);
  });

  await t.test('senza abilitazione su quella domanda: 403', async () => {
    const altraPersona = await creaPersonaFisicaTest(pool);
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${altraPersona.token}` },
      body: JSON.stringify({ testo: 'x' }),
    });
    assert.equal(r.status, 403);
  });

  await t.test('abilitazione approvata ma su una stagione diversa: 403', async () => {
    // Scenario: la persona è stata delegata sulla stessa associazione in una stagione
    // precedente/diversa (mai revocata) ma non ha alcuna abilitazione per la stagione a
    // cui appartiene questa domanda — non deve poter osservare (art. 53, tracciabilità).
    const personaAltraStagione = await creaPersonaFisicaTest(pool);
    const altraStagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2028-09-01', '2029-06-30') RETURNING id`,
      [`stagione-oss-altra-${randomUUID()}`],
    );
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
      [personaAltraStagione.id, fx.associazioneId, altraStagione.rows[0]!.id],
    );
    const r = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${personaAltraStagione.token}` },
      body: JSON.stringify({ testo: 'x' }),
    });
    assert.equal(r.status, 403);
  });
});

test('PUT /backoffice/osservazioni/:id/{accogli,respingi}', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    return pool.end();
  });

  const persona = await creaPersonaFisicaTest(pool);
  const fx = await creaFixtureCompleta(pool);
  await pool.query(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'approvata')`,
    [persona.id, fx.associazioneId, fx.stagioneId],
  );
  const creazione = await fetch(`${base}/pubblico/domande`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(await corpoDomandaValido(fx)),
  });
  const domanda = (await creazione.json()) as { id: string };
  const operatore = await creaUtenteBackofficeTest(pool, 'operatore');
  await fetch(`${base}/backoffice/domande/${domanda.id}/ammetti`, { method: 'PUT', headers: { Authorization: `Bearer ${operatore.token}` } });
  const osservazioneRes = await fetch(`${base}/pubblico/domande/${domanda.id}/osservazioni`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify({ testo: 'non concordo' }),
  });
  const osservazione = (await osservazioneRes.json()) as { id: string };

  await t.test('pubblico non può decidere: 401', async () => {
    const r = await fetch(`${base}/backoffice/osservazioni/${osservazione.id}/accogli`, { method: 'PUT' });
    assert.equal(r.status, 401);
  });

  await t.test('respingi senza motivazione: 400', async () => {
    const r = await fetch(`${base}/backoffice/osservazioni/${osservazione.id}/respingi`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatore.token}` },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
  });

  await t.test('accogli: 200, domanda.stato invariato (ammessa), riesameStato consolidato a deciso, audit log su domande (I6)', async () => {
    const r = await fetch(`${base}/backoffice/osservazioni/${osservazione.id}/accogli`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(r.status, 200);
    const corpoOsservazione = (await r.json()) as Record<string, unknown>;
    assert.equal('domandaTransitata' in corpoOsservazione, false);
    assert.equal('nuovoRiesameStato' in corpoOsservazione, false);

    const dettaglio = await fetch(`${base}/backoffice/domande/${domanda.id}`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    const body = (await dettaglio.json()) as { stato: string; riesameStato: string };
    assert.equal(body.stato, 'ammessa');
    assert.equal(body.riesameStato, 'deciso');

    const logDomanda = await pool.query(
      `SELECT azione FROM log_operazioni WHERE entita_tipo = 'domande' AND entita_id = $1 AND azione = 'consolida_riesame_domanda'`,
      [domanda.id],
    );
    assert.equal(logDomanda.rows.length, 1);
  });

  await t.test('doppia decisione: 409', async () => {
    const r = await fetch(`${base}/backoffice/osservazioni/${osservazione.id}/accogli`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(r.status, 409);
  });
});
