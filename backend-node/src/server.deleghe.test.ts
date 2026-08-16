import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaAbilitazionePrincipale } from './abilitazioni.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: import('pg').Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaUtenteTest(pool: import('pg').Pool, ruolo: 'admin' | 'operatore'): Promise<{ id: string; token: string }> {
  const email = `deleghe-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Deleghe', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/deleghe',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const operatore = await creaUtenteTest(pool, 'operatore');

    const persona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Anna', 'Verdi', $2, 'spid') RETURNING id`,
      [`VRDNNA80A01H501U-${randomUUID()}`, randomUUID()],
    );
    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione deleghe HTTP ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD HTTP Test', $1) RETURNING id`,
      [randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: persona.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    const r = await fetch(`${base}/backoffice/deleghe`, { headers: { Authorization: `Bearer ${operatore.token}` } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as Array<{ associazioneDenominazione: string; personaFisicaCognome: string }>;
    assert.ok(body.some((a) => a.associazioneDenominazione === 'ASD HTTP Test' && a.personaFisicaCognome === 'Verdi'));

    const filtrata = await fetch(`${base}/backoffice/deleghe?stato=in_attesa`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(filtrata.status, 200);

    const senzaAuth = await fetch(`${base}/backoffice/deleghe`);
    assert.equal(senzaAuth.status, 401);

    const statoInvalido = await fetch(`${base}/backoffice/deleghe?stato=non_esiste`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(statoInvalido.status, 400);
  },
);

test(
  'GET /pubblico/deleghe/mie',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const stagione = await pool.query<{ id: string }>(
      `INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2026-09-01', '2027-06-30') RETURNING id`,
      [`Stagione mie deleghe HTTP ${randomUUID()}`],
    );
    const associazione = await pool.query<{ id: string }>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ('ASD Mie Deleghe HTTP', $1) RETURNING id`,
      [randomUUID()],
    );
    const cfMia = `MIEDLG80A01H501U-${randomUUID()}`;
    const persona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Mia', 'Delega', $2, 'spid') RETURNING id`,
      [cfMia, randomUUID()],
    );
    const altraPersona = await pool.query<{ id: string }>(
      `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
       VALUES ($1, 'Altra', 'Persona', $2, 'spid') RETURNING id`,
      [`ALTPRS80A01H501U-${randomUUID()}`, randomUUID()],
    );
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: persona.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });
    await creaAbilitazionePrincipale(pool, {
      personaFisicaId: altraPersona.rows[0]!.id,
      associazioneId: associazione.rows[0]!.id,
      stagioneId: stagione.rows[0]!.id,
    });

    const token = generaAccessTokenPubblico({
      sub: persona.rows[0]!.id,
      codiceFiscale: cfMia,
      nome: 'Mia',
      cognome: 'Delega',
    });

    const r = await fetch(`${base}/pubblico/deleghe/mie`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as Array<{ personaFisicaCognome: string }>;
    assert.equal(body.length, 1);
    assert.equal(body[0]!.personaFisicaCognome, 'Delega');

    const senzaAuth = await fetch(`${base}/pubblico/deleghe/mie`);
    assert.equal(senzaAuth.status, 401);
  },
);
