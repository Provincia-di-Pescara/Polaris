import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estraiClaimPersona } from './claims.ts';

test('SPID: fiscal_number con prefisso TINIT-, given_name/family_name senza name', () => {
  const claims = estraiClaimPersona({
    sub: 'abc123',
    fiscal_number: 'TINIT-RSSMRA80A01H501U',
    given_name: 'Mario',
    family_name: 'Rossi',
  });
  assert.equal(claims.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(claims.nome, 'Mario');
  assert.equal(claims.cognome, 'Rossi');
});

test('eIDAS: claim URI completo per fiscal_number', () => {
  const claims = estraiClaimPersona({
    sub: 'xyz',
    'https://attributes.eid.gov.it/fiscal_number': 'TINIT-VRDLGU75B02H501Z',
    given_name: 'Luigi',
    family_name: 'Verdi',
  });
  assert.equal(claims.codiceFiscale, 'VRDLGU75B02H501Z');
});

test('claim URI SPID alternativo per fiscal_number', () => {
  const claims = estraiClaimPersona({
    sub: 'xyz',
    'https://attributes.spid.gov.it/fiscalNumber': 'TINIT-BNCLRA85C03H501X',
    given_name: 'Laura',
    family_name: 'Bianchi',
  });
  assert.equal(claims.codiceFiscale, 'BNCLRA85C03H501X');
});

test('prefisso paese diverso da IT viene comunque strippato (TIN + 2 lettere)', () => {
  const claims = estraiClaimPersona({
    sub: 'xyz',
    fiscal_number: 'TINDE-ABCDEF12G34H567I',
    given_name: 'Foo',
    family_name: 'Bar',
  });
  assert.equal(claims.codiceFiscale, 'ABCDEF12G34H567I');
});

test('codice fiscale senza prefisso TIN resta invariato', () => {
  const claims = estraiClaimPersona({
    sub: 'xyz',
    codice_fiscale: 'rssmra80a01h501u',
    given_name: 'Mario',
    family_name: 'Rossi',
  });
  assert.equal(claims.codiceFiscale, 'RSSMRA80A01H501U'); // normalizzato maiuscolo
});

test('claim name già combinato viene usato se presente', () => {
  const claims = estraiClaimPersona({
    sub: 'xyz',
    fiscal_number: 'TINIT-RSSMRA80A01H501U',
    name: 'Mario Rossi',
  });
  assert.equal(claims.nome, 'Mario');
  assert.equal(claims.cognome, 'Rossi');
});

test('claim name con un solo token: nome pieno, cognome vuoto', () => {
  const claims = estraiClaimPersona({
    sub: 'xyz',
    fiscal_number: 'TINIT-RSSMRA80A01H501U',
    name: 'Madonna',
  });
  assert.equal(claims.nome, 'Madonna');
  assert.equal(claims.cognome, '');
});

test('nessun claim fiscal_number in nessuna forma: errore esplicito, elenca i NOMI dei claim presenti (mai i valori, PII)', () => {
  assert.throws(
    () => estraiClaimPersona({ sub: 'xyz', given_name: 'Foo', family_name: 'Bar' }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      // I nomi dei claim aiutano a diagnosticare un IdP reale con nomi diversi
      // da quelli tentati (trovato in produzione 2026-08-24) -- il valore
      // "Foo"/"Bar" non deve mai comparire nel messaggio.
      assert.match(err.message, /sub, given_name, family_name/);
      assert.doesNotMatch(err.message, /Foo|Bar/);
      return true;
    },
  );
});

test('claim array (a volte i provider OIDC restituiscono array): usa il primo valore', () => {
  const claims = estraiClaimPersona({
    sub: 'xyz',
    fiscal_number: ['TINIT-RSSMRA80A01H501U'],
    given_name: ['Mario'],
    family_name: ['Rossi'],
  });
  assert.equal(claims.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(claims.nome, 'Mario');
});
