import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { registraTentativoLogin, contaTentativiFallitiRecenti } from './tentativiLogin.ts';

const dsn = process.env.TEST_DATABASE_URL;

test('contaTentativiFallitiRecenti: conta solo password_errata dentro la finestra', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const email = `conta-tentativi-${randomUUID()}@test.local`;

  await registraTentativoLogin(pool, { emailTentata: email, esito: 'password_errata' });
  await registraTentativoLogin(pool, { emailTentata: email, esito: 'password_errata' });
  await registraTentativoLogin(pool, { emailTentata: email, esito: 'successo' });

  const conteggio = await contaTentativiFallitiRecenti(pool, email, 15 * 60 * 1000);
  assert.equal(conteggio, 2);
});

test('contaTentativiFallitiRecenti: ignora tentativi più vecchi della finestra', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const email = `conta-vecchi-${randomUUID()}@test.local`;

  await registraTentativoLogin(pool, { emailTentata: email, esito: 'password_errata' });
  await pool.query(
    `UPDATE tentativi_login_backoffice SET avvenuto_il = now() - interval '20 minutes' WHERE email_tentata = $1`,
    [email],
  );

  const conteggio = await contaTentativiFallitiRecenti(pool, email, 15 * 60 * 1000);
  assert.equal(conteggio, 0);
});

test('contaTentativiFallitiRecenti: ignora esiti diversi da password_errata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const email = `conta-altri-esiti-${randomUUID()}@test.local`;

  await registraTentativoLogin(pool, { emailTentata: email, esito: 'utente_non_trovato' });
  await registraTentativoLogin(pool, { emailTentata: email, esito: 'utente_disattivato' });

  const conteggio = await contaTentativiFallitiRecenti(pool, email, 15 * 60 * 1000);
  assert.equal(conteggio, 0);
});

test('contaTentativiFallitiRecenti: email diversa non viene contata', { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' }, async (t) => {
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const emailA = `conta-a-${randomUUID()}@test.local`;
  const emailB = `conta-b-${randomUUID()}@test.local`;

  await registraTentativoLogin(pool, { emailTentata: emailA, esito: 'password_errata' });

  const conteggio = await contaTentativiFallitiRecenti(pool, emailB, 15 * 60 * 1000);
  assert.equal(conteggio, 0);
});
