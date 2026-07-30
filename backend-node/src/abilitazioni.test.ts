import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaAssociazione } from './associazioni.ts';
import { creaPersonaFisicaShell } from './repository/personeFisiche.ts';
import {
  creaAbilitazionePrincipale,
  trovaAbilitazioneAttiva,
  creaSubDelega,
  trovaAbilitazionePerId,
} from './abilitazioni.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

const dsn = process.env.TEST_DATABASE_URL;

async function fixture(pool: Pool) {
  const associazione = await creaAssociazione(pool, {
    denominazione: 'ASD Abilitazioni Test',
    codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
  });
  const stagione = await pool.query<{ id: string }>(
    `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2031-09-01', '2032-06-30') RETURNING id`,
    [`stagione-abilitazioni-${randomUUID()}`],
  );
  const rappresentante = await creaPersonaFisicaShell(pool, {
    codiceFiscale: `TSTRPR${randomUUID().slice(0, 10).toUpperCase()}`,
    nome: 'Giulia',
    cognome: 'Neri',
  });
  return { associazioneId: associazione.id, stagioneId: stagione.rows[0]!.id, rappresentanteId: rappresentante.id };
}

test(
  'creaAbilitazionePrincipale + trovaAbilitazioneAttiva',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const f = await fixture(pool);
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: f.rappresentanteId,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
      });
      assert.equal(principale.stato, 'in_attesa');
      assert.equal(principale.titolo, 'legale_rappresentante');
      assert.equal(principale.creataDaAbilitazioneId, null);

      const nonAttiva = await trovaAbilitazioneAttiva(pool, f.rappresentanteId, f.associazioneId, f.stagioneId);
      assert.equal(nonAttiva, null, 'in_attesa non è attiva finché non approvata');

      await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [principale.id]);
      const attiva = await trovaAbilitazioneAttiva(pool, f.rappresentanteId, f.associazioneId, f.stagioneId);
      assert.equal(attiva?.id, principale.id);
    } finally {
      await pool.end();
    }
  },
);

test(
  'creaSubDelega: auto-approvata, catena tracciata, duplicato 409',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const f = await fixture(pool);
      const principale = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: f.rappresentanteId,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
      });
      await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [principale.id]);

      const delegato = await creaPersonaFisicaShell(pool, {
        codiceFiscale: `TSTDEL${randomUUID().slice(0, 10).toUpperCase()}`,
        nome: 'Marco',
        cognome: 'Blu',
      });
      const subDelega = await creaSubDelega(pool, {
        personaFisicaId: delegato.id,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
        ruolo: 'operatore',
        creataDaAbilitazioneId: principale.id,
      });
      assert.equal(subDelega.stato, 'approvata');
      assert.equal(subDelega.titolo, 'delegato');
      assert.equal(subDelega.creataDaAbilitazioneId, principale.id);

      const trovata = await trovaAbilitazionePerId(pool, subDelega.id);
      assert.equal(trovata?.id, subDelega.id);

      await assert.rejects(
        () =>
          creaSubDelega(pool, {
            personaFisicaId: delegato.id,
            associazioneId: f.associazioneId,
            stagioneId: f.stagioneId,
            ruolo: 'rappresentante',
            creataDaAbilitazioneId: principale.id,
          }),
        ErroreValoreDuplicato,
      );
    } finally {
      await pool.end();
    }
  },
);
