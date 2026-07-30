import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DOCUMENTI_STORAGE_PATH = mkdtempSync(path.join(tmpdir(), 'polaris-documenti-test-'));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { creaApp } from './server.ts';
import { generaAccessTokenPubblico } from './auth/jwtPubblico.ts';
import { creaAssociazione } from './associazioni.ts';

const dsn = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'segreto-di-test-non-usare-in-produzione';

async function avviaServerTest(pool: Pool): Promise<{ base: string; chiudi: () => void }> {
  const app = creaApp(pool);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { base, chiudi: () => server.close() };
}

async function creaPersonaFisicaTest(pool: Pool): Promise<{ id: string; token: string }> {
  const cf = `TSTDOC${randomUUID().slice(0, 10).toUpperCase()}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider)
     VALUES ($1, 'Anna', 'Verdi', $2, 'spid') RETURNING id`,
    [cf, randomUUID()],
  );
  const id = r.rows[0]!.id;
  const token = generaAccessTokenPubblico({ sub: id, codiceFiscale: cf, nome: 'Anna', cognome: 'Verdi' });
  return { id, token };
}

test(
  'POST /pubblico/associazioni/:id/documenti',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const pool = new Pool({ connectionString: dsn });
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return pool.end();
    });

    const persona = await creaPersonaFisicaTest(pool);
    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Documenti Test',
      codiceFiscalePartitaIva: `PIVA-${randomUUID().slice(0, 8)}`,
    });
    await pool.query(
      `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
       SELECT $1, $2, id, 'legale_rappresentante', 'rappresentante', 'in_attesa' FROM stagioni_sportive LIMIT 1`,
      [persona.id, associazione.id],
    );

    const pdfValido = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenuto finto')]);
    const pathPdf = path.join(process.env.DOCUMENTI_STORAGE_PATH!, `sorgente-${randomUUID()}.pdf`);
    writeFileSync(pathPdf, pdfValido);

    await t.test('upload PDF valido: 201, riga in associazioni_documenti', async () => {
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([pdfValido], { type: 'application/pdf' }), 'statuto.pdf');
      const r = await fetch(`${base}/pubblico/associazioni/${associazione.id}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${persona.token}` },
        body: form,
      });
      assert.equal(r.status, 201);

      const doc = await pool.query(`SELECT tipo FROM associazioni_documenti WHERE associazione_id = $1`, [associazione.id]);
      assert.equal(doc.rows[0]?.tipo, 'statuto');
    });

    await t.test('mimetype non PDF: 415', async () => {
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([Buffer.from('non un pdf')], { type: 'text/plain' }), 'file.txt');
      const r = await fetch(`${base}/pubblico/associazioni/${associazione.id}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${persona.token}` },
        body: form,
      });
      assert.equal(r.status, 415);
    });

    await t.test('utente senza abilitazione su quell\'associazione: 403', async () => {
      const estraneo = await creaPersonaFisicaTest(pool);
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([pdfValido], { type: 'application/pdf' }), 'statuto.pdf');
      const r = await fetch(`${base}/pubblico/associazioni/${associazione.id}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${estraneo.token}` },
        body: form,
      });
      assert.equal(r.status, 403);
    });

    await t.test('associazione inesistente: 404', async () => {
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([pdfValido], { type: 'application/pdf' }), 'statuto.pdf');
      const r = await fetch(`${base}/pubblico/associazioni/${randomUUID()}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${persona.token}` },
        body: form,
      });
      assert.equal(r.status, 404);
    });

    await t.test('id associazione malformato (non uuid): 400 JSON pulito, non 500 grezzo', async () => {
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([pdfValido], { type: 'application/pdf' }), 'statuto.pdf');
      const r = await fetch(`${base}/pubblico/associazioni/NON-UN-UUID/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${persona.token}` },
        body: form,
      });
      assert.equal(r.status, 400);
      const corpo = (await r.json()) as { errore: string };
      assert.ok(typeof corpo.errore === 'string');
      assert.ok(!corpo.errore.includes('invalid input syntax'), 'non deve esporre il messaggio Postgres grezzo');
    });

    await t.test('file oltre il limite dimensione: 413 JSON pulito, non pagina HTML di default Express', async () => {
      const fileTroppoGrande = Buffer.alloc(11 * 1024 * 1024, 0x41); // 11MB > limite 10MB
      const form = new FormData();
      form.append('tipo', 'statuto');
      form.append('file', new Blob([fileTroppoGrande], { type: 'application/pdf' }), 'grande.pdf');
      const r = await fetch(`${base}/pubblico/associazioni/${associazione.id}/documenti`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${persona.token}` },
        body: form,
      });
      assert.equal(r.status, 413);
      const contentType = r.headers.get('content-type') ?? '';
      assert.ok(contentType.includes('application/json'), `content-type doveva essere JSON, era: ${contentType}`);
      const corpo = (await r.json()) as { errore: string };
      assert.ok(typeof corpo.errore === 'string');
    });
  },
);
