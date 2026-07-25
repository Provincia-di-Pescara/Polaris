import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creaTrasportoSmtp, inviaEmail } from './smtp.ts';

// Test contro un SMTP catcher reale (Mailpit: SMTP su 1025, API HTTP su 8025).
// TEST_SMTP_URL es. smtp://localhost:1025 — skip pulito se non impostata, come
// TEST_DATABASE_URL per Postgres.
const smtpUrl = process.env.TEST_SMTP_URL;
const mailpitApi = process.env.TEST_MAILPIT_API ?? 'http://localhost:8025';

test('invio email via SMTP reale (Mailpit)', { skip: smtpUrl ? false : 'TEST_SMTP_URL non impostata' }, async () => {
  const trasporto = creaTrasportoSmtp({
    host: new URL(smtpUrl!).hostname,
    port: Number(new URL(smtpUrl!).port),
    secure: false,
    from: 'polaris@provincia.test',
  });

  const oggetto = `POLARIS test ${Date.now()}`;
  await inviaEmail(trasporto, {
    a: 'destinatario@test.local',
    oggetto,
    testo: 'Corpo del messaggio di prova con link https://esempio.test/verifica?token=abc123',
  });

  const risposta = await fetch(`${mailpitApi}/api/v1/search?query=${encodeURIComponent(oggetto)}`);
  assert.equal(risposta.status, 200);
  const corpo = (await risposta.json()) as { messages: { To: { Address: string }[]; Subject: string }[] };
  // la search di Mailpit matcha per sottostringa e il catcher accumula tra i run:
  // si filtra per oggetto esatto (univoco, contiene Date.now())
  const trovati = corpo.messages.filter((m) => m.Subject === oggetto);
  assert.equal(trovati.length, 1);
  assert.equal(trovati[0]!.To[0]!.Address, 'destinatario@test.local');
});
