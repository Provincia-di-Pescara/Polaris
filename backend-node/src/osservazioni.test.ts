import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { presentaOsservazione, trovaOsservazionePerId } from './osservazioni.ts';
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

  const domandaAggiornata = await pool.query<{ stato: string }>(`SELECT stato FROM domande WHERE id = $1`, [domanda.id]);
  assert.equal(domandaAggiornata.rows[0]?.stato, 'riesame_richiesto');

  const seconda = await presentaOsservazione(pool, { domandaId: domanda.id, personaFisicaId: personaId, testo: 'seconda osservazione' });
  assert.equal(seconda.stato, 'in_esame');

  const trovata = await trovaOsservazionePerId(pool, osservazione.id);
  assert.equal(trovata?.id, osservazione.id);

  await assert.rejects(
    () => presentaOsservazione(pool, { domandaId: randomUUID(), personaFisicaId: personaId, testo: 'x' }),
    ErroreNonTrovato,
  );
});
