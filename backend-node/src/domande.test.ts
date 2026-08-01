import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaDomanda, trovaDomandaPerId, listaDomandePerAssociazione } from './domande.ts';
import { creaDisciplina } from './discipline.ts';
import { creaIstituzione } from './istituzioni.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { creaSlot } from './slot.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function creaFixture(pool: Pool) {
  const disciplina = await creaDisciplina(pool, { codice: `VOLLEY-${randomUUID().slice(0, 8)}`, denominazione: 'Pallavolo' });
  const istituzione = await creaIstituzione(pool, { denominazione: `Istituto test ${randomUUID()}` });
  const impianto = await creaImpianto(pool, { denominazione: 'Palestra test', istituzioneScolasticaId: istituzione.id });
  const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo A', disciplineCompatibili: [disciplina.codice] });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2030-09-01', '2031-06-30') RETURNING id`,
    [`stagione-domanda-test-${randomUUID()}`],
  );
  const slot1 = await creaSlot(pool, { stagioneId: stagione.rows[0]!.id, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:00' });
  const slot2 = await creaSlot(pool, { stagioneId: stagione.rows[0]!.id, spazioId: spazio.id, giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:00' });
  const associazione = await pool.query<{ id: string }>(
    `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2) RETURNING id`,
    [`ASD test ${randomUUID()}`, `PIVA-${randomUUID().slice(0, 8)}`],
  );
  const persona = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
    [`TSTDOM${randomUUID().slice(0, 10).toUpperCase()}`, randomUUID()],
  );
  return {
    disciplina,
    stagioneId: stagione.rows[0]!.id,
    slot1Id: slot1.id,
    slot2Id: slot2.id,
    associazioneId: associazione.rows[0]!.id,
    personaId: persona.rows[0]!.id,
  };
}

test('creaDomanda + trovaDomandaPerId + listaDomandePerAssociazione', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const fx = await creaFixture(pool);

  const domanda = await creaDomanda(
    pool,
    {
      associazioneId: fx.associazioneId,
      stagioneId: fx.stagioneId,
      disciplineCodici: [fx.disciplina.codice],
      numeroTesserati: 20,
      numeroAtletiPartecipanti: 15,
      numeroSquadre: 1,
      numeroSquadreFederaliStagionePrecedente: 0,
      attivitaGiovanile: true,
      attivitaAgonistica: false,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '60.000',
      fabbisognoOttimaleMinuti: '120.000',
      preferenze: [fx.slot1Id, fx.slot2Id],
      blocchiAllenamento: [[fx.slot1Id, fx.slot2Id]],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    },
    fx.personaId,
  );

  assert.match(domanda.numeroProtocollo, /^DOM-\d{4}-\d{6}$/);
  assert.equal(domanda.discipline.length, 1);
  assert.equal(domanda.preferenze.length, 2);
  assert.equal(domanda.preferenze[0]?.ordinePreferenza, 1);
  assert.equal(domanda.preferenze[1]?.ordinePreferenza, 2);
  assert.equal(domanda.blocchiAllenamento.length, 1);
  assert.deepEqual(domanda.blocchiAllenamento[0]?.slotIds.sort(), [fx.slot1Id, fx.slot2Id].sort());
  assert.equal(domanda.stato, 'presentata');

  const trovata = await trovaDomandaPerId(pool, domanda.id);
  assert.equal(trovata?.id, domanda.id);

  const lista = await listaDomandePerAssociazione(pool, fx.associazioneId, fx.stagioneId);
  assert.equal(lista.length, 1);

  await assert.rejects(
    () =>
      creaDomanda(
        pool,
        {
          associazioneId: fx.associazioneId,
          stagioneId: fx.stagioneId,
          disciplineCodici: [fx.disciplina.codice],
          numeroTesserati: 0,
          numeroAtletiPartecipanti: 0,
          numeroSquadre: 0,
          numeroSquadreFederaliStagionePrecedente: 0,
          attivitaGiovanile: false,
          attivitaAgonistica: false,
          attivitaParalimpicaInclusiva: false,
          fabbisognoMinimoMinuti: '10.000',
          fabbisognoOttimaleMinuti: '10.000',
          preferenze: [fx.slot1Id],
          blocchiAllenamento: [],
          richiedeGiornataGara: false,
          richiesteGiornataGara: [],
        },
        fx.personaId,
      ),
    ErroreValoreDuplicato,
  );
});
