import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richiedeRuolo, type RequestAutenticata } from './middleware.ts';

interface RispostaFinta {
  statusCode: number | null;
  body: unknown;
  status: (code: number) => RispostaFinta;
  json: (body: unknown) => RispostaFinta;
}

function creaRispostaFinta(): RispostaFinta {
  const res: RispostaFinta = {
    statusCode: null,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

test('richiedeRuolo lascia passare un ruolo consentito', () => {
  const req = { utente: { sub: 'u1', email: 'a@b.it', ruolo: 'admin' } } as RequestAutenticata;
  const res = creaRispostaFinta();
  let chiamatoNext = false;

  richiedeRuolo('admin')(req, res as never, () => {
    chiamatoNext = true;
  });

  assert.equal(chiamatoNext, true);
  assert.equal(res.statusCode, null);
});

test('richiedeRuolo rifiuta un ruolo non consentito con 403', () => {
  const req = { utente: { sub: 'u1', email: 'a@b.it', ruolo: 'operatore' } } as RequestAutenticata;
  const res = creaRispostaFinta();
  let chiamatoNext = false;

  richiedeRuolo('admin')(req, res as never, () => {
    chiamatoNext = true;
  });

  assert.equal(chiamatoNext, false);
  assert.equal(res.statusCode, 403);
});

test('richiedeRuolo rifiuta senza utente autenticato con 401', () => {
  const req = {} as RequestAutenticata;
  const res = creaRispostaFinta();
  let chiamatoNext = false;

  richiedeRuolo('admin')(req, res as never, () => {
    chiamatoNext = true;
  });

  assert.equal(chiamatoNext, false);
  assert.equal(res.statusCode, 401);
});

test('richiedeRuolo con più ruoli consente operatore quando ammesso', () => {
  const req = { utente: { sub: 'u1', email: 'a@b.it', ruolo: 'operatore' } } as RequestAutenticata;
  const res = creaRispostaFinta();
  let chiamatoNext = false;

  richiedeRuolo('admin', 'operatore')(req, res as never, () => {
    chiamatoNext = true;
  });

  assert.equal(chiamatoNext, true);
});
