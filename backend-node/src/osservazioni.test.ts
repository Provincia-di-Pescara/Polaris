import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { presentaOsservazione, trovaOsservazionePerId, accogliOsservazione, respingiOsservazione } from './osservazioni.ts';
import { creaDomanda, ammettiDomanda } from './domande.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { ErroreStatoNonValidoPerTransizione, ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaDomandaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto oss test ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra oss test', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo A', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-oss-test-${randomUUID()}`],
  );
  const stagioneId = stagione.rows[0]!.id;
  const slot = await creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD oss test ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [`TSTOSS${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: associazione.rows[0]!.id,
      stagioneId,
      disciplineCodici: [disciplina.codice],
      numeroTesserati: 0,
      numeroAtletiPartecipanti: 0,
      numeroSquadre: 0,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: false,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '30.000',
      fabbisognoOttimaleMinuti: '30.000',
      preferenze: [slot.id],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    persona.rows[0]!.id,
  );
  return { domanda, personaId: persona.rows[0]!.id };
}

// osservazioni_istruttoria.decisa_da ha FK verso utenti_backoffice: un randomUUID() nudo
// viola il vincolo 23503, serve una riga reale (stesso gotcha già documentato in CLAUDE.md
// per abilitazioni_decisa_da_fk).
async function creaUtenteBackofficeTest(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, 'scrypt:1:1:1:00:00', 'Test', 'Osservazioni', 'operatore', 'attivo') RETURNING id`,
    [`osservazioni-test-${randomUUID()}@test.local`],
  );
  return r.rows[0]!.id;
}

test('presentaOsservazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { domanda, personaId } = await creaDomandaFixture(pool);

  await assert.rejects(
    () => presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'osservazione precoce' }),
    ErroreStatoNonValidoPerTransizione,
  );

  await ammettiDomanda(pool, domanda.id);
  const osservazione = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'non concordo con FR' });
  assert.equal(osservazione.stato, 'in_esame');

  // C1: domande.stato resta invariato (il motore Go lo legge con uguaglianza esatta),
  // solo riesame_stato transita.
  const domandaAggiornata = await pool.query<{ stato: string; riesame_stato: string }>(
    `SELECT stato, riesame_stato FROM domande WHERE id = $1`,
    [domanda.id],
  );
  assert.equal(domandaAggiornata.rows[0]?.stato, 'ammessa');
  assert.equal(domandaAggiornata.rows[0]?.riesame_stato, 'richiesto');

  const seconda = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'seconda osservazione' });
  assert.equal(seconda.stato, 'in_esame');

  const trovata = await trovaOsservazionePerId(pool, osservazione.id);
  assert.equal(trovata?.id, osservazione.id);

  await assert.rejects(
    () => presentaOsservazione(pool, { domandaId: randomUUID(), personaFisicaId: personaId, testo: 'x' }),
    ErroreNonTrovato,
  );
});

test('accogliOsservazione + respingiOsservazione consolidano lo stato domanda', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { domanda, personaId } = await creaDomandaFixture(pool);
  await ammettiDomanda(pool, domanda.id);

  const oss1 = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'prima' });
  const oss2 = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'seconda' });

  const decisore = await creaUtenteBackofficeTest(pool);

  const accolta = await accogliOsservazione(pool, oss1.id, decisore);
  assert.equal(accolta.stato, 'accolta');

  let statoDomanda = await pool.query<{ stato: string; riesame_stato: string }>(
    `SELECT stato, riesame_stato FROM domande WHERE id = $1`,
    [domanda.id],
  );
  assert.equal(statoDomanda.rows[0]?.stato, 'ammessa');
  assert.equal(statoDomanda.rows[0]?.riesame_stato, 'richiesto');

  const respinta = await respingiOsservazione(pool, oss2.id, decisore, 'non fondata');
  assert.equal(respinta.stato, 'respinta');
  assert.equal(respinta.decisioneMotivazione, 'non fondata');

  statoDomanda = await pool.query<{ stato: string; riesame_stato: string }>(
    `SELECT stato, riesame_stato FROM domande WHERE id = $1`,
    [domanda.id],
  );
  assert.equal(statoDomanda.rows[0]?.stato, 'ammessa');
  assert.equal(statoDomanda.rows[0]?.riesame_stato, 'deciso');

  await assert.rejects(() => accogliOsservazione(pool, oss1.id, decisore), ErroreStatoNonValidoPerTransizione);
});

// Fix follow-up C1 (2026-08-01): il riesame non deve essere riapribile dopo
// riesame_stato='deciso' (art. B.11, "non ulteriormente contestabili"). Prima di questo fix
// STATI_DOMANDA_OSSERVABILI non controllava riesame_stato e una nuova osservazione lo
// riportava a 'richiesto' all'infinito.
test('presentaOsservazione rifiuta una nuova osservazione se riesame_stato è già deciso', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { domanda, personaId } = await creaDomandaFixture(pool);
  await ammettiDomanda(pool, domanda.id);

  const oss1 = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'unica osservazione' });
  const decisore = await creaUtenteBackofficeTest(pool);
  await accogliOsservazione(pool, oss1.id, decisore);

  const statoPreConsolidamento = await pool.query<{ riesame_stato: string }>(
    `SELECT riesame_stato FROM domande WHERE id = $1`,
    [domanda.id],
  );
  assert.equal(statoPreConsolidamento.rows[0]?.riesame_stato, 'deciso');

  await assert.rejects(
    () => presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'tentativo di riaprire' }),
    ErroreStatoNonValidoPerTransizione,
  );

  const statoDopoTentativo = await pool.query<{ riesame_stato: string }>(
    `SELECT riesame_stato FROM domande WHERE id = $1`,
    [domanda.id],
  );
  assert.equal(statoDopoTentativo.rows[0]?.riesame_stato, 'deciso', 'riesame_stato non deve tornare a richiesto');
});

// I4: due decisioni concorrenti su osservazioni DIVERSE della stessa domanda non devono
// lasciare riesame_stato bloccato a 'richiesto' per sempre. Senza il lock
// pg_advisory_xact_lock in osservazioni.ts, sotto READ COMMITTED entrambe le transazioni
// possono vedere l'altra osservazione come ancora 'in_esame' (nessuna delle due ha ancora
// committato) e nessuna consolida.
test('accogliOsservazione + respingiOsservazione concorrenti sulla stessa domanda consolidano sempre', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn, max: 5 });
  t.after(() => pool.end());
  const { domanda, personaId } = await creaDomandaFixture(pool);
  await ammettiDomanda(pool, domanda.id);

  const oss1 = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'prima' });
  const oss2 = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'seconda' });

  const decisore = await creaUtenteBackofficeTest(pool);

  // Ogni "transazione" (begin+lavoro+commit) deve completarsi in modo indipendente: se si
  // aspettasse che ENTRAMBE le chiamate a accogli/respingi ritornino prima di fare il COMMIT
  // di ciascuna, si introdurrebbe un deadlock artificiale del test stesso (la seconda resta
  // bloccata sul lock advisory finché la prima non committa, ma la prima non committa finché
  // la seconda non ritorna) — non è il comportamento che I4 vuole verificare.
  async function decidiInTransazionePropria(lavoro: (client: import('pg').PoolClient) => Promise<unknown>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lavoro(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  await Promise.all([
    decidiInTransazionePropria((client) => accogliOsservazione(client, oss1.id, decisore)),
    decidiInTransazionePropria((client) => respingiOsservazione(client, oss2.id, decisore, 'non fondata')),
  ]);

  const statoDomanda = await pool.query<{ stato: string; riesame_stato: string }>(
    `SELECT stato, riesame_stato FROM domande WHERE id = $1`,
    [domanda.id],
  );
  assert.equal(statoDomanda.rows[0]?.stato, 'ammessa');
  assert.equal(statoDomanda.rows[0]?.riesame_stato, 'deciso');
});

// C1 (review finale whole-branch, Critical): riproduce esattamente il bug originale.
// Il motore Go (engine-go/internal/postgres/istruttoria.go, gara.go, assegnazione.go)
// filtra le domande da elaborare con `WHERE stato = 'ammessa'` (uguaglianza esatta). Prima
// di questo fix, presentare un'osservazione sovrascriveva domande.stato a
// 'riesame_richiesto' e la domanda spariva silenziosamente da quella query — nessun
// errore, nessun log. Questo test simula esattamente la query del motore Go prima e dopo
// la presentazione di un'osservazione: deve continuare a vedere la domanda come ammessa.
test('C1: un\'osservazione su una domanda ammessa non la fa sparire dalla query del motore Go (WHERE stato = \'ammessa\')', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { domanda, personaId } = await creaDomandaFixture(pool);
  await ammettiDomanda(pool, domanda.id);

  const queryMotoreGo = () =>
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM domande WHERE id = $1 AND stato = 'ammessa'`, [domanda.id]);

  const primaDellOsservazione = await queryMotoreGo();
  assert.equal(primaDellOsservazione.rows[0]?.count, '1');

  await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'non concordo con FR' });

  const dopoLOsservazione = await queryMotoreGo();
  assert.equal(dopoLOsservazione.rows[0]?.count, '1', 'la domanda deve restare visibile al motore Go anche con un riesame in corso');

  // riesame_stato (asse separato, mai letto dal motore Go) è invece transitato.
  const riga = await pool.query<{ stato: string; riesame_stato: string }>(`SELECT stato, riesame_stato FROM domande WHERE id = $1`, [domanda.id]);
  assert.equal(riga.rows[0]?.stato, 'ammessa');
  assert.equal(riga.rows[0]?.riesame_stato, 'richiesto');
});
