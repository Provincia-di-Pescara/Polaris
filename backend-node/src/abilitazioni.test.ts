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
  approvaAbilitazione,
  respingiAbilitazione,
  revocaAbilitazioneConCascata,
  listaAbilitazioni,
} from './abilitazioni.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';

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

// abilitazioni.decisa_da referenzia utenti_backoffice (FK reale, vedi db/migrations/000001):
// approvaAbilitazione/respingiAbilitazione richiedono un id di operatore esistente davvero,
// non un randomUUID() qualsiasi (violerebbe abilitazioni_decisa_da_fk).
async function creaOperatoreTest(pool: Pool): Promise<string> {
  const email = `operatore-abilitazioni-${randomUUID()}@test.local`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, 'scrypt:test:test:test:test:test', 'Test', 'Operatore', 'operatore', 'attivo') RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
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

test(
  'approvaAbilitazione: solo prime abilitazioni in_attesa, sub-deleghe escluse',
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
      const operatoreId = await creaOperatoreTest(pool);

      const approvata = await approvaAbilitazione(pool, principale.id, operatoreId);
      assert.equal(approvata.stato, 'approvata');

      await assert.rejects(() => approvaAbilitazione(pool, principale.id, operatoreId), ErroreNonTrovato, 'non ri-approvabile');

      await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [principale.id]);
      const delegato = await creaPersonaFisicaShell(pool, {
        codiceFiscale: `TSTAPR${randomUUID().slice(0, 10).toUpperCase()}`,
        nome: 'Sara',
        cognome: 'Gialli',
      });
      const subDelega = await creaSubDelega(pool, {
        personaFisicaId: delegato.id,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
        ruolo: 'operatore',
        creataDaAbilitazioneId: principale.id,
      });
      await assert.rejects(
        () => approvaAbilitazione(pool, subDelega.id, operatoreId),
        ErroreNonTrovato,
        'le sub-deleghe non passano da qui, sono già approvata',
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'respingiAbilitazione richiede motivazione',
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
      const operatoreId = await creaOperatoreTest(pool);
      const respinta = await respingiAbilitazione(pool, principale.id, operatoreId, 'documentazione incompleta');
      assert.equal(respinta.stato, 'respinta');
      assert.equal(respinta.motivazione, 'documentazione incompleta');
    } finally {
      await pool.end();
    }
  },
);

test(
  'revocaAbilitazioneConCascata: cascata su 3 livelli, idempotente, 404 su id inesistente',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const f = await fixture(pool);
      const livello1 = await creaAbilitazionePrincipale(pool, {
        personaFisicaId: f.rappresentanteId,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
      });
      await pool.query(`UPDATE abilitazioni SET stato = 'approvata' WHERE id = $1`, [livello1.id]);

      const personaA = await creaPersonaFisicaShell(pool, {
        codiceFiscale: `TSTCSC1${randomUUID().slice(0, 9).toUpperCase()}`,
        nome: 'A',
        cognome: 'Livello2',
      });
      const livello2 = await creaSubDelega(pool, {
        personaFisicaId: personaA.id,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
        ruolo: 'operatore',
        creataDaAbilitazioneId: livello1.id,
      });

      const personaB = await creaPersonaFisicaShell(pool, {
        codiceFiscale: `TSTCSC2${randomUUID().slice(0, 9).toUpperCase()}`,
        nome: 'B',
        cognome: 'Livello3',
      });
      const livello3 = await creaSubDelega(pool, {
        personaFisicaId: personaB.id,
        associazioneId: f.associazioneId,
        stagioneId: f.stagioneId,
        ruolo: 'operatore',
        creataDaAbilitazioneId: livello2.id,
      });

      const revocate = await revocaAbilitazioneConCascata(pool, livello1.id);
      assert.equal(revocate.length, 3, 'deve revocare padre + entrambi i discendenti');
      assert.ok(revocate.every((a) => a.stato === 'revocata'));

      const rilette = await pool.query(`SELECT id, stato FROM abilitazioni WHERE id IN ($1, $2, $3)`, [
        livello1.id,
        livello2.id,
        livello3.id,
      ]);
      assert.ok(rilette.rows.every((r) => r.stato === 'revocata'));

      const secondaVolta = await revocaAbilitazioneConCascata(pool, livello1.id);
      assert.equal(secondaVolta.length, 0, 'idempotente: già tutto revocato, nessuna riga da aggiornare');

      await assert.rejects(() => revocaAbilitazioneConCascata(pool, randomUUID()), ErroreNonTrovato);
    } finally {
      await pool.end();
    }
  },
);

test(
  'listaAbilitazioni filtra per stato e include dati persona/associazione',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const persona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Mario', 'Rossi', $2, 'spid') RETURNING id`,
      [`RSSMRA80A01H501U-${randomUUID()}`, randomUUID()],
    );
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione test deleghe ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Test', $1) RETURNING id`,
      [randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: persona.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    const tutte = await listaAbilitazioni(pool, {});
    assert.ok(tutte.some((a) => a.personaFisicaCognome === 'Rossi' && a.associazioneDenominazione === 'ASD Test'));

    const inAttesa = await listaAbilitazioni(pool, { stato: 'in_attesa' });
    assert.ok(inAttesa.every((a) => a.stato === 'in_attesa'));

    const approvate = await listaAbilitazioni(pool, { stato: 'approvata' });
    assert.ok(!approvate.some((a) => a.associazioneDenominazione === 'ASD Test'));
  },
);

test(
  'listaAbilitazioni filtra per personaFisicaId, escludendo le abilitazioni di altre persone',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione filtro persona ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Filtro Persona', $1) RETURNING id`,
      [randomUUID()],
    );
    const personaA = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Anna', 'Uno', $2, 'spid') RETURNING id`,
      [`AAAUNO80A01H501U-${randomUUID()}`, randomUUID()],
    );
    const personaB = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Bruno', 'Due', $2, 'spid') RETURNING id`,
      [`BBBDUE80A01H501U-${randomUUID()}`, randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: personaA.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: personaB.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    const soloA = await listaAbilitazioni(pool, { personaFisicaId: personaA.rows[0]!.id });
    assert.equal(soloA.length, 1);
    assert.equal(soloA[0]!.personaFisicaCognome, 'Uno');
  },
);

test(
  'listaAbilitazioni con personaFisicaId stringa vuota non restituisce le abilitazioni di altre persone',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    // Regressione: il guard usava `if (filtri.personaFisicaId)`, una verifica di
    // truthiness. Con personaFisicaId === '' la condizione era falsa, la clausola
    // WHERE veniva silenziosamente omessa e la query tornava TUTTE le
    // abilitazioni — un confine di autorizzazione, non un dettaglio cosmetico
    // (GET /pubblico/deleghe/mie). Il guard corretto verifica `!== undefined`.
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione filtro vuoto ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Filtro Vuoto', $1) RETURNING id`,
      [randomUUID()],
    );
    const personaC = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Carla', 'Tre', $2, 'spid') RETURNING id`,
      [`CCCTRE80A01H501U-${randomUUID()}`, randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: personaC.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    // La colonna persona_fisica_id è uuid: con il guard corretto (!== undefined)
    // il filtro viene applicato davvero e Postgres rifiuta '' come uuid non
    // valido, invece di degradare silenziosamente a "nessun filtro" e tornare
    // tutte le righe (il comportamento pre-fix, con `if (filtri.personaFisicaId)`
    // falso su stringa vuota).
    await assert.rejects(
      () => listaAbilitazioni(pool, { personaFisicaId: '' }),
      /invalid input syntax for type uuid/,
      'il guard deve applicare il filtro anche con stringa vuota, non ometterlo silenziosamente',
    );
  },
);
