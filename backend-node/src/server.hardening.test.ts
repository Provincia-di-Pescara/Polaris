import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { creaApp } from './server.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool) {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, chiudi: () => server.close() };
}

test('helmet: risposta include header di sicurezza standard', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(chiudi);

  const r = await fetch(`${base}/healthz`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('cors: origine in allowlist riceve Access-Control-Allow-Origin', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://esempio-consentito.test';
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente === undefined) { delete process.env.CORS_ALLOWED_ORIGINS; } else { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://esempio-consentito.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://esempio-consentito.test');
});

test('cors: origine NON in allowlist non riceve Access-Control-Allow-Origin', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://esempio-consentito.test';
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente === undefined) { delete process.env.CORS_ALLOWED_ORIGINS; } else { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://non-consentito.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('cors: nessuna CORS_ALLOWED_ORIGINS configurata, nessuna origine riceve il header', async (t) => {
  if (!dsn) { t.skip('TEST_DATABASE_URL non impostata'); return; }
  const precedente = process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.CORS_ALLOWED_ORIGINS;
  const pool = new Pool({ connectionString: dsn });
  t.after(() => pool.end());
  const { base, chiudi } = await avviaServerTest(pool);
  t.after(() => {
    chiudi();
    if (precedente !== undefined) { process.env.CORS_ALLOWED_ORIGINS = precedente; }
  });

  const r = await fetch(`${base}/healthz`, { headers: { Origin: 'https://qualsiasi.test' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});
