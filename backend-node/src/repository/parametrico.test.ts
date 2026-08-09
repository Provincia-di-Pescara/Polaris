import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiVersioneAttiva, leggiVersionePerId, listaVersioni, creaVersione, type DatiCreaVersione } from './parametrico.ts';
import { creaDatabaseDedicato } from '../testutil/dbDedicato.ts';

const dsn = process.env.TEST_DATABASE_URL;

const DATI_BASE: DatiCreaVersione = {
  moltiplicatoreMinutiPerPunto: '60.000',
  pesoFasciaPregiata: '1.250',
  minutiSettimanaliMax: '600.000',
  slotMaxStessoImpianto: 4,
  fascePregiateMax: 2,
  giornateGaraMax: 1,
  incrementoSquadreNeutro: 0,
  caaNeutro: '1.000',
  csdNeutro: '1.000',
  tolleranzaIsfPct: '0.0050',
  sogliaMancatiUtilizziDiffida: 2,
  sogliaMancatiUtilizziDecadenza: 3,
  sogliaScostamentoDichiaratoPct: '0.2000',
  sogliaIsfCompensazione: '0.2000',
  retentionLogOperazioniGiorni: 30,
  quotaNuoveAssociazioniPct: '0.0000',
  termineGiustificazioneGiorni: 7,
  csdScaglioni: [
    { rapportoFdFrMin: '0.000', rapportoFdFrMax: '1.000', coefficiente: '1.000' },
    { rapportoFdFrMin: '1.000', rapportoFdFrMax: null, coefficiente: '0.850' },
  ],
};

test(
  'lettura versione attiva/storico + creazione nuova versione con scaglioni CSD',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    t.after(distruggi);

    // Il DB dedicato ha già la migration 000002/000006 applicata (seed iniziale) —
    // leggiVersioneAttiva deve trovare quella riga prima di qualunque creaVersione.
    await t.test('leggiVersioneAttiva sul seed iniziale', async () => {
      const attiva = await leggiVersioneAttiva(pool);
      assert.ok(attiva);
      assert.equal(attiva!.quotaNuoveAssociazioniPct, '0.0000');
    });

    let nuovaVersioneId = '';

    await t.test('creaVersione: nuova riga, scaglioni collegati correttamente', async () => {
      const versione = await creaVersione(pool, { ...DATI_BASE, note: 'test versione 2' }, null);
      assert.equal(versione.note, 'test versione 2');
      assert.equal(versione.csdScaglioni.length, 2);
      assert.equal(versione.csdScaglioni[0]!.coefficiente, '1.000');
      assert.equal(versione.csdScaglioni[1]!.rapportoFdFrMax, null);
      nuovaVersioneId = versione.id;
    });

    await t.test('leggiVersioneAttiva ora ritorna la nuova versione', async () => {
      const attiva = await leggiVersioneAttiva(pool);
      assert.equal(attiva!.id, nuovaVersioneId);
    });

    await t.test('listaVersioni include entrambe, ordinate per valida_dal desc', async () => {
      const lista = await listaVersioni(pool);
      assert.ok(lista.length >= 2);
      assert.equal(lista[0]!.id, nuovaVersioneId);
    });

    await t.test('leggiVersionePerId sulla versione storica (seed iniziale) ritorna i valori congelati', async () => {
      const lista = await listaVersioni(pool);
      const idSeed = lista[lista.length - 1]!.id;
      const storica = await leggiVersionePerId(pool, idSeed);
      assert.ok(storica);
      assert.notEqual(storica!.id, nuovaVersioneId);
    });

    await t.test('leggiVersionePerId su id inesistente ritorna null', async () => {
      const risultato = await leggiVersionePerId(pool, '00000000-0000-0000-0000-000000000000');
      assert.equal(risultato, null);
    });
  },
);
