import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { listaSorteggiPerStagione, trovaSorteggioConCandidati } from './sorteggi.ts';

test(
  'listaSorteggiPerStagione e trovaSorteggioConCandidati',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione sorteggi test ${randomUUID()}`],
    );
    const versione = await pool.query<{ id: string }>(`SELECT id FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`);
    const elaborazione = await pool.query<{ id: string }>(
      `INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, stato) VALUES ($1, 'prima_assegnazione', $2, 'completata') RETURNING id`,
      [stagione.rows[0]!.id, versione.rows[0]!.id],
    );
    const ass1 = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Sorteggio Uno', $1) RETURNING id`,
      [randomUUID()],
    );
    const ass2 = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Sorteggio Due', $1) RETURNING id`,
      [randomUUID()],
    );
    const sorteggio = await pool.query<{ id: string }>(
      `INSERT INTO sorteggi (elaborazione_id, articolo_riferimento, contesto, seme_hex, vincitore_associazione_id, hash_verbale)
       VALUES ($1, 'B.21', 'contesto di test', 'ab12', $2, 'hashdiverbale')
       RETURNING id`,
      [elaborazione.rows[0]!.id, ass1.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO sorteggio_candidati (sorteggio_id, associazione_id, ordine_canonico, hmac_hex, rank) VALUES
       ($1, $2, 1, 'hmac-vincitore', 1),
       ($1, $3, 2, 'hmac-secondo', 2)`,
      [sorteggio.rows[0]!.id, ass1.rows[0]!.id, ass2.rows[0]!.id],
    );

    const lista = await listaSorteggiPerStagione(pool, stagione.rows[0]!.id);
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.id, sorteggio.rows[0]!.id);
    assert.equal(lista[0]!.vincitoreAssociazioneId, ass1.rows[0]!.id);

    const dettaglio = await trovaSorteggioConCandidati(pool, sorteggio.rows[0]!.id);
    assert.equal(dettaglio?.candidati.length, 2);
    assert.equal(dettaglio?.candidati[0]!.rank, 1);
    assert.equal(dettaglio?.hashVerbale, 'hashdiverbale');

    const inesistente = await trovaSorteggioConCandidati(pool, randomUUID());
    assert.equal(inesistente, null);
  },
);
