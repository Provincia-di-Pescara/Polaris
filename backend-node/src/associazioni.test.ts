import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseError } from 'pg';
import {
  creaAssociazione,
  trovaAssociazionePerId,
  creaDocumentoAssociazione,
  listaDocumentiPerAssociazione,
  trovaDocumentoPerId,
  creaReferenteAssociazione,
  creaAssicurazioneAssociazione,
  type DatiCreaAssociazione,
} from './associazioni.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';

const dsn = process.env.TEST_DATABASE_URL;

// Fixture minima ma completa per DatiCreaAssociazione: la maggior parte dei campi
// anagrafici sono obbligatori a livello di tipo (Task 2), non solo denominazione/piva.
function datiAssociazioneBase(piva: string): DatiCreaAssociazione {
  return {
    denominazione: 'ASD Test Calcio',
    codiceFiscalePartitaIva: piva,
    rappresentanteLegaleNome: 'Mario',
    rappresentanteLegaleCognome: 'Rossi',
    indirizzoVia: 'Via Roma',
    indirizzoCivico: '10',
    indirizzoCitta: 'Pescara',
    email: `associazione-${randomUUID()}@test.local`,
    tipologiaSoggetto: 'associazione_sportiva',
    iscrittaRasd: false,
    haPersonaleAssunto: false,
  };
}

test(
  'creaAssociazione contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const piva = `PIVA-${randomUUID().slice(0, 8)}`;
      const associazione = await creaAssociazione(pool, datiAssociazioneBase(piva));
      assert.equal(associazione.denominazione, 'ASD Test Calcio');
      assert.equal(associazione.codiceFiscalePartitaIva, piva);
      assert.equal(associazione.rnaNumeroIscrizione, null);

      const trovata = await trovaAssociazionePerId(pool, associazione.id);
      assert.equal(trovata?.id, associazione.id);

      await assert.rejects(
        () => creaAssociazione(pool, { ...datiAssociazioneBase(piva), denominazione: 'Altra' }),
        ErroreValoreDuplicato,
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'trovaAssociazionePerId su id inesistente ritorna null',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const risultato = await trovaAssociazionePerId(pool, randomUUID());
      assert.equal(risultato, null);
    } finally {
      await pool.end();
    }
  },
);

test(
  'creaDocumentoAssociazione contro Postgres reale',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async () => {
    const pool = new Pool({ connectionString: dsn });
    try {
      const piva = `PIVA-${randomUUID().slice(0, 8)}`;
      const associazione = await creaAssociazione(pool, { ...datiAssociazioneBase(piva), denominazione: 'ASD Doc Test' });

      const documento = await creaDocumentoAssociazione(pool, {
        associazioneId: associazione.id,
        tipo: 'statuto',
        filePath: `${randomUUID()}.pdf`,
      });
      assert.equal(documento.associazioneId, associazione.id);
      assert.equal(documento.tipo, 'statuto');

      await assert.rejects(
        () => creaDocumentoAssociazione(pool, { associazioneId: randomUUID(), tipo: 'statuto', filePath: 'x.pdf' }),
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  'listaDocumentiPerAssociazione e trovaDocumentoPerId',
  { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(process.env.TEST_DATABASE_URL!);
    t.after(distruggi);

    const associazione = await creaAssociazione(pool, {
      ...datiAssociazioneBase(randomUUID()),
      denominazione: 'ASD Documenti Test',
    });
    const doc = await creaDocumentoAssociazione(pool, {
      associazioneId: associazione.id,
      tipo: 'statuto',
      filePath: 'file-di-test.pdf',
    });

    const lista = await listaDocumentiPerAssociazione(pool, associazione.id);
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.tipo, 'statuto');
    assert.ok(!('filePath' in lista[0]!));

    const trovato = await trovaDocumentoPerId(pool, doc.id);
    assert.equal(trovato?.filePath, 'file-di-test.pdf');

    const inesistente = await trovaDocumentoPerId(pool, randomUUID());
    assert.equal(inesistente, null);
  },
);

test(
  'creaAssociazione con tutti i nuovi campi anagrafici: round-trip completo',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const piva = `PIVA-${randomUUID().slice(0, 8)}`;
    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Anagrafica Completa',
      codiceFiscalePartitaIva: piva,
      rnaNumeroIscrizione: 'RNA-12345',
      dataCostituzione: '2010-05-15',
      rappresentanteLegaleNome: 'Luca',
      rappresentanteLegaleCognome: 'Verdi',
      delegatoNome: 'Anna',
      delegatoCognome: 'Bianchi',
      indirizzoVia: 'Via Milano',
      indirizzoCivico: '42',
      indirizzoCitta: 'Chieti',
      pec: `pec-${randomUUID()}@pec.test`,
      email: `email-${randomUUID()}@test.local`,
      tipologiaSoggetto: 'cooperativa_ente_promozione_sportiva',
      iscrittaRasd: true,
      organismoSportivoCodice: 'UISP',
      codiceAffiliazione: 'AFF-001',
      haPersonaleAssunto: true,
    });

    assert.equal(associazione.rnaNumeroIscrizione, 'RNA-12345');
    assert.equal(associazione.dataCostituzione, '2010-05-15');
    assert.equal(associazione.rappresentanteLegaleNome, 'Luca');
    assert.equal(associazione.rappresentanteLegaleCognome, 'Verdi');
    assert.equal(associazione.delegatoNome, 'Anna');
    assert.equal(associazione.delegatoCognome, 'Bianchi');
    assert.equal(associazione.indirizzoVia, 'Via Milano');
    assert.equal(associazione.indirizzoCivico, '42');
    assert.equal(associazione.indirizzoCitta, 'Chieti');
    assert.ok(associazione.pec?.startsWith('pec-'));
    assert.ok(associazione.email?.startsWith('email-'));
    assert.equal(associazione.tipologiaSoggetto, 'cooperativa_ente_promozione_sportiva');
    assert.equal(associazione.iscrittaRasd, true);
    assert.equal(associazione.organismoSportivoCodice, 'UISP');
    assert.equal(associazione.codiceAffiliazione, 'AFF-001');
    assert.equal(associazione.haPersonaleAssunto, true);

    const rilette = await trovaAssociazionePerId(pool, associazione.id);
    assert.deepEqual(rilette, associazione);
  },
);

test(
  'creaAssociazione con delegatoNome presente ma delegatoCognome assente viola il CHECK associazioni_delegato_coerente',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const piva = `PIVA-${randomUUID().slice(0, 8)}`;
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO associazioni (
             denominazione, codice_fiscale_partita_iva, rappresentante_legale_nome, rappresentante_legale_cognome,
             delegato_nome, indirizzo_via, indirizzo_civico, indirizzo_citta, email, tipologia_soggetto,
             iscritta_rasd, ha_personale_assunto
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            'ASD Delegato Incoerente', piva, 'Mario', 'Rossi', 'Anna',
            'Via Test', '1', 'Pescara', `x-${randomUUID()}@test.local`, 'associazione_sportiva', false, false,
          ],
        ),
      (err: unknown) => err instanceof DatabaseError && err.code === '23514',
      'atteso CHECK violation (23514) su associazioni_delegato_coerente',
    );
  },
);

test(
  'creaAssociazione con organismoSportivoCodice inesistente in organismi_sportivi viola il FK (Finding 4 code review finale)',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const piva = `PIVA-${randomUUID().slice(0, 8)}`;
    await assert.rejects(
      () =>
        creaAssociazione(pool, {
          ...datiAssociazioneBase(piva),
          denominazione: 'ASD Organismo Sportivo Inesistente',
          iscrittaRasd: true,
          organismoSportivoCodice: 'CODICE-INESISTENTE',
          codiceAffiliazione: 'AFF-999',
        }),
      (err: unknown) => err instanceof DatabaseError && err.code === '23503',
      'atteso FK violation (23503) su associazioni_organismo_sportivo_fk',
    );
  },
);

test(
  'creaReferenteAssociazione: sicurezza e emergenze_dae (con DAE valorizzato), round-trip',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const associazione = await creaAssociazione(pool, {
      ...datiAssociazioneBase(`PIVA-${randomUUID().slice(0, 8)}`),
      denominazione: 'ASD Referenti Test',
    });

    const sicurezza = await creaReferenteAssociazione(pool, {
      associazioneId: associazione.id,
      tipo: 'sicurezza',
      nome: 'Paolo',
      cognome: 'Neri',
      natoA: 'Pescara',
      natoIl: '1980-01-01',
      residenteVia: 'Via Sicurezza',
      residenteCitta: 'Pescara',
      cellulare: '3331234567',
      cartaIdentita: 'CI12345',
    });
    assert.equal(sicurezza.tipo, 'sicurezza');
    assert.equal(sicurezza.nome, 'Paolo');
    assert.equal(sicurezza.daeMarca, null);

    const emergenzeDae = await creaReferenteAssociazione(pool, {
      associazioneId: associazione.id,
      tipo: 'emergenze_dae',
      nome: 'Giulia',
      cognome: 'Bianchi',
      natoA: 'Chieti',
      natoIl: '1985-06-15',
      residenteVia: 'Via Emergenze',
      residenteCitta: 'Chieti',
      cellulare: '3339876543',
      cartaIdentita: 'CI67890',
      daeMarca: 'Philips',
      daeMatricola: 'MAT-001',
      daeScadenza: '2028-12-31',
    });
    assert.equal(emergenzeDae.tipo, 'emergenze_dae');
    assert.equal(emergenzeDae.daeMarca, 'Philips');
    assert.equal(emergenzeDae.daeMatricola, 'MAT-001');
    assert.equal(emergenzeDae.daeScadenza, '2028-12-31');

    await assert.rejects(
      () =>
        creaReferenteAssociazione(pool, {
          associazioneId: associazione.id,
          tipo: 'sicurezza',
          nome: 'Secondo',
          cognome: 'Sicurezza',
          natoA: 'Pescara',
          natoIl: '1990-01-01',
          residenteVia: 'Via Duplicato',
          residenteCitta: 'Pescara',
          cellulare: '3330000000',
          cartaIdentita: 'CI00000',
        }),
      (err: unknown) => err instanceof DatabaseError && err.code === '23505',
      'un secondo referente con lo stesso tipo per la stessa associazione deve violare lo UNIQUE',
    );
  },
);

test(
  'creaAssicurazioneAssociazione: rct e rco, massimale torna come stringa, duplicato per tipo rigettato',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    const associazione = await creaAssociazione(pool, {
      ...datiAssociazioneBase(`PIVA-${randomUUID().slice(0, 8)}`),
      denominazione: 'ASD Assicurazioni Test',
    });

    const rct = await creaAssicurazioneAssociazione(pool, {
      associazioneId: associazione.id,
      tipo: 'rct',
      compagnia: 'Generali',
      numeroPolizza: 'POL-RCT-001',
      massimale: '1000000.00',
      coperturaDal: '2026-01-01',
      coperturaAl: '2026-12-31',
    });
    assert.equal(rct.tipo, 'rct');
    assert.equal(typeof rct.massimale, 'string');
    assert.equal(rct.massimale, '1000000.00');

    const rco = await creaAssicurazioneAssociazione(pool, {
      associazioneId: associazione.id,
      tipo: 'rco',
      compagnia: 'Unipol',
      agenzia: 'Agenzia Pescara',
      numeroPolizza: 'POL-RCO-001',
      massimale: '500000.50',
      coperturaDal: '2026-01-01',
      coperturaAl: '2026-12-31',
    });
    assert.equal(rco.tipo, 'rco');
    assert.equal(typeof rco.massimale, 'string');
    assert.equal(rco.massimale, '500000.50');
    assert.equal(rco.agenzia, 'Agenzia Pescara');

    await assert.rejects(
      () =>
        creaAssicurazioneAssociazione(pool, {
          associazioneId: associazione.id,
          tipo: 'rct',
          compagnia: 'Altra Compagnia',
          numeroPolizza: 'POL-RCT-002',
          massimale: '200000.00',
          coperturaDal: '2027-01-01',
          coperturaAl: '2027-12-31',
        }),
      (err: unknown) => err instanceof DatabaseError && err.code === '23505',
      'una seconda polizza con lo stesso tipo per la stessa associazione deve violare lo UNIQUE',
    );
  },
);
