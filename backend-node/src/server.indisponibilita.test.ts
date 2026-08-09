import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { hashPassword } from './auth/password.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { creaDomanda } from './domande.ts';
import { creaAbilitazionePrincipale, approvaAbilitazione } from './abilitazioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

async function creaAdmin(pool: Pool): Promise<{ id: string; token: string }> {
  const email = `indisp-admin-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato) VALUES ($1, $2, 'Test', 'Admin', 'admin', 'attivo') RETURNING id`,
    [email, hash],
  );
  return { id: r.rows[0]!.id, token: generaAccessToken({ sub: r.rows[0]!.id, email, ruolo: 'admin' }) };
}

async function creaFixtureCompleta(pool: Pool, adminId: string) {
  const disciplina = await creaDisciplina(pool, { codice: `TIRO-${randomUUID().slice(0, 8)}`, denominazione: 'Tiro con l\'arco' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto indisp http ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra indisp http', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo indisp', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-indisp-http-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD indisp http ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const cf = `TSTIDH${randomUUID().slice(0, 10).toUpperCase()}`;
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Indisp', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const abilitazione = await creaAbilitazionePrincipale(pool, { personaFisicaId: persona.rows[0]!.id, associazioneId: associazione.rows[0]!.id, stagioneId });
  await approvaAbilitazione(pool, abilitazione.id, adminId);
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id, stagioneId, disciplineCodici: [disciplina.codice],
      numeroTesserati: 10, numeroAtletiPartecipanti: 8, numeroSquadre: 1, numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true, attivitaAgonistica: false, attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000', fabbisognoOttimaleMinuti: '60.000',
      preferenze: [slot.id], blocchiAllenamento: [], richiedeGiornataGara: false, richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  await pool.query(`UPDATE domande SET stato = 'ammessa' WHERE id = $1`, [domanda.id]);
  await pool.query(
    `INSERT INTO assegnazioni (slot_id, domanda_id, associazione_id, tipo, valore_minuti, stato) VALUES ($1, $2, $3, 'singola', 60, 'provvisoria')`,
    [slot.id, domanda.id, associazione.rows[0]!.id],
  );
  const tokenPubblico = generaAccessTokenPubblico({ sub: persona.rows[0]!.id, codiceFiscale: cf, nome: 'Test', cognome: 'Indisp' });
  return { stagioneId, slotId: slot.id, associazioneId: associazione.rows[0]!.id, tokenPubblico };
}

test('POST .../indisponibilita crea, GET pubblico la trova', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool, admin.id);

  const rCrea = await fetch(`${base}/backoffice/slot/${fx.slotId}/indisponibilita`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dal: '2030-10-01', al: '2030-10-07', motivo: 'manutenzione', comunicataDa: 'ente' }),
  });
  assert.equal(rCrea.status, 201);

  const rLista = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/indisponibilita?stagioneId=${fx.stagioneId}`, {
    headers: { Authorization: `Bearer ${fx.tokenPubblico}` },
  });
  assert.equal(rLista.status, 200);
  const lista = (await rLista.json()) as unknown[];
  assert.equal(lista.length, 1);
});

test('GET pubblico indisponibilita: 403 senza abilitazione attiva', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool, admin.id);
  const estraneo = generaAccessTokenPubblico({ sub: randomUUID(), codiceFiscale: 'XXXXXXXXXXX', nome: 'X', cognome: 'Y' });

  const r = await fetch(`${base}/pubblico/associazioni/${fx.associazioneId}/indisponibilita`, {
    headers: { Authorization: `Bearer ${estraneo}` },
  });
  assert.equal(r.status, 403);
});

test('POST .../indisponibilita: 400 su date incoerenti', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);
  const admin = await creaAdmin(pool);
  const fx = await creaFixtureCompleta(pool, admin.id);

  const r = await fetch(`${base}/backoffice/slot/${fx.slotId}/indisponibilita`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dal: '2030-10-07', al: '2030-10-01', motivo: 'manutenzione', comunicataDa: 'ente' }),
  });
  assert.equal(r.status, 400);
});
