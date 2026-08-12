import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { registraOperazione } from './repository/logOperazioni.ts';

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
  const email = `logop-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'LogOp', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/log-operazioni',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const admin = await creaUtenteTest(pool, 'admin');
    const entitaId = randomUUID();
    await registraOperazione(pool, {
      attore: { tipo: 'backoffice', utenteBackofficeId: admin.id, ruolo: 'admin' },
      azione: 'azione_http_test',
      entitaTipo: 'entita_http_test',
      entitaId,
    });

    const r = await fetch(`${base}/backoffice/log-operazioni?entitaTipo=entita_http_test`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as Array<{ entitaId: string; attoreNome: string }>;
    assert.ok(body.some((o) => o.entitaId === entitaId));

    const conLimite = await fetch(`${base}/backoffice/log-operazioni?limit=1`, { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(conLimite.status, 200);
    assert.equal(((await conLimite.json()) as unknown[]).length, 1);

    const dataInvalida = await fetch(`${base}/backoffice/log-operazioni?dataDa=non-una-data`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(dataInvalida.status, 400);

    const senzaAuth = await fetch(`${base}/backoffice/log-operazioni`);
    assert.equal(senzaAuth.status, 401);
  },
);
