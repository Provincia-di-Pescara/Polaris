import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaSlot, listaSlotPerStagione, trovaSlotPerId, aggiornaSlot, ErroreSovrapposizioneSlot } from './slot.ts';
import { creaImpianto } from './impianti.ts';
import { creaSpazio } from './spazi.ts';
import { ErroreNonTrovato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

test(
  'slot settimana tipo CRUD contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    t.after(() => pool.end());

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2035-09-01', '2036-06-30') RETURNING id`,
      [`slot-test-${randomUUID()}`],
    );
    const stagioneId = stagione.rows[0]!.id;
    const impianto = await creaImpianto(pool, { denominazione: `Impianto Slot Test ${randomUUID()}` });
    const spazio = await creaSpazio(pool, { impiantoId: impianto.id, denominazione: 'Campo Slot Test' });
    let slotId = '';

    await t.test('crea e ritrova nella lista', async () => {
      const slot = await creaSlot(pool, {
        stagioneId,
        spazioId: spazio.id,
        giornoSettimana: 1,
        orarioInizio: '16:30',
        orarioFine: '18:00',
      });
      slotId = slot.id;
      assert.equal(slot.durataMinuti, 90);
      assert.equal(slot.pregiata, false);
      assert.equal(slot.indisponibilePermanente, false);

      const lista = await listaSlotPerStagione(pool, stagioneId);
      assert.ok(lista.some((s) => s.id === slotId));
    });

    await t.test('crea sovrapposto allo stesso spazio/giorno/stagione viene rifiutato', async () => {
      await assert.rejects(
        creaSlot(pool, { stagioneId, spazioId: spazio.id, giornoSettimana: 1, orarioInizio: '17:00', orarioFine: '19:00' }),
        ErroreSovrapposizioneSlot,
      );
    });

    await t.test('crea non sovrapposto (giorno diverso) viene accettato', async () => {
      const slot = await creaSlot(pool, {
        stagioneId,
        spazioId: spazio.id,
        giornoSettimana: 2,
        orarioInizio: '16:30',
        orarioFine: '18:00',
      });
      assert.ok(slot.id);
    });

    await t.test('trova per id', async () => {
      const trovato = await trovaSlotPerId(pool, slotId);
      assert.equal(trovato?.giornoSettimana, 1);
    });

    await t.test('lista filtrata per spazio', async () => {
      const lista = await listaSlotPerStagione(pool, stagioneId, spazio.id);
      assert.ok(lista.every((s) => s.spazioId === spazio.id));
    });

    await t.test('aggiorna marcando pregiata e indisponibile_permanente', async () => {
      const aggiornato = await aggiornaSlot(pool, slotId, {
        giornoSettimana: 1,
        orarioInizio: '16:30',
        orarioFine: '18:00',
        pregiata: true,
        indisponibilePermanente: true,
        note: 'fuori uso per lavori',
      });
      assert.equal(aggiornato.pregiata, true);
      assert.equal(aggiornato.indisponibilePermanente, true);
    });

    await t.test('aggiorna id inesistente viene rifiutato', async () => {
      await assert.rejects(
        aggiornaSlot(pool, randomUUID(), {
          giornoSettimana: 1,
          orarioInizio: '10:00',
          orarioFine: '11:00',
          pregiata: false,
          indisponibilePermanente: false,
        }),
        ErroreNonTrovato,
      );
    });
  },
);
