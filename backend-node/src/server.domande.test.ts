import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
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
});
