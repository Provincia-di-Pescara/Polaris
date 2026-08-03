import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseError } from 'pg';
import { comeErroreRiferimentoNonValido, ErroreConflittoFifoConcertazione } from './erroriDominio.ts';

// Unit test puro (nessun Postgres richiesto): verifica il mapping SQLSTATE->classe di
// dominio senza dover riprodurre una query reale che fallisca con ciascun codice.
function erroreConCodice(code: string): DatabaseError {
  const err = new DatabaseError('errore postgres simulato', 0, 'error');
  err.code = code;
  return err;
}

test('comeErroreRiferimentoNonValido mappa 22P02 (uuid malformato)', () => {
  assert.ok(comeErroreRiferimentoNonValido(erroreConCodice('22P02')));
});

test('comeErroreRiferimentoNonValido mappa 23503 (FK violation)', () => {
  assert.ok(comeErroreRiferimentoNonValido(erroreConCodice('23503')));
});

test('comeErroreRiferimentoNonValido mappa 22003 (numeric_field_overflow) - Finding 4', () => {
  assert.ok(comeErroreRiferimentoNonValido(erroreConCodice('22003')));
});

test('comeErroreRiferimentoNonValido ignora altri codici Postgres', () => {
  assert.equal(comeErroreRiferimentoNonValido(erroreConCodice('23505')), null);
});

test('comeErroreRiferimentoNonValido ignora errori non-Postgres', () => {
  assert.equal(comeErroreRiferimentoNonValido(new Error('boh')), null);
});

test('ErroreConflittoFifoConcertazione è un\'istanza di Error con messaggio', () => {
  const err = new ErroreConflittoFifoConcertazione('conflitto');
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'conflitto');
});
