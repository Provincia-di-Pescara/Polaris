import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { creaApp } from './server.ts';
import { creaDatabaseDedicato } from './testutil/dbDedicato.ts';
import { generaAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { creaAssociazione, creaDocumentoAssociazione } from './associazioni.ts';
import { percorsoStorageDocumenti } from './documenti/storage.ts';

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
  const email = `documenti-test-${randomUUID()}@test.local`;
  const hash = await hashPassword('password-test-123456');
  const r = await pool.query<{ id: string }>(
    `INSERT INTO utenti_backoffice (email, password_hash, nome, cognome, ruolo, stato)
     VALUES ($1, $2, 'Test', 'Documenti', $3, 'attivo') RETURNING id`,
    [email, hash, ruolo],
  );
  const id = r.rows[0]!.id;
  return { id, token: generaAccessToken({ sub: id, email, ruolo }) };
}

test(
  'GET /backoffice/associazioni/:id/documenti e /backoffice/documenti/:id/scarica',
  { skip: dsn ? false : 'TEST_DATABASE_URL non impostata' },
  async (t) => {
    const { pool, distruggi } = await creaDatabaseDedicato(dsn!);
    const { base, chiudi } = await avviaServerTest(pool);
    t.after(() => {
      chiudi();
      return distruggi();
    });

    const operatore = await creaUtenteTest(pool, 'operatore');
    const associazione = await creaAssociazione(pool, {
      denominazione: 'ASD Scarica Test',
      codiceFiscalePartitaIva: randomUUID(),
      rappresentanteLegaleNome: 'Test',
      rappresentanteLegaleCognome: 'Rappresentante',
      indirizzoVia: 'Via Test',
      indirizzoCivico: '1',
      indirizzoCitta: 'Pescara',
      email: `associazione-${randomUUID()}@test.local`,
      tipologiaSoggetto: 'associazione_sportiva',
      iscrittaRasd: false,
      haPersonaleAssunto: false,
    });

    const nomeFile = `${randomUUID()}.pdf`;
    await mkdir(percorsoStorageDocumenti(), { recursive: true });
    await writeFile(path.join(percorsoStorageDocumenti(), nomeFile), '%PDF-1.4 contenuto di test');
    const documento = await creaDocumentoAssociazione(pool, { associazioneId: associazione.id, tipo: 'statuto', filePath: nomeFile });

    const rLista = await fetch(`${base}/backoffice/associazioni/${associazione.id}/documenti`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rLista.status, 200);
    const lista = (await rLista.json()) as Array<{ id: string; tipo: string }>;
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.id, documento.id);

    const rScarica = await fetch(`${base}/backoffice/documenti/${documento.id}/scarica`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rScarica.status, 200);
    assert.equal(rScarica.headers.get('content-type'), 'application/pdf');
    const corpo = await rScarica.text();
    assert.ok(corpo.startsWith('%PDF-'));

    const rInesistente = await fetch(`${base}/backoffice/documenti/${randomUUID()}/scarica`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rInesistente.status, 404);

    const rAssociazioneInesistente = await fetch(`${base}/backoffice/associazioni/${randomUUID()}/documenti`, {
      headers: { Authorization: `Bearer ${operatore.token}` },
    });
    assert.equal(rAssociazioneInesistente.status, 404);
  },
);
