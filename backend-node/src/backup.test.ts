import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseElencoToc,
  filtraToc,
  percorsoBackupValido,
  ErrorePercorsoNonValido,
  ErroreBackupNonTrovato,
  listaBackup,
} from './backup.ts';

// Output reale catturato da un bring-up Docker (postgres:18-alpine +
// prodrigestivill/postgres-backup-local con POSTGRES_EXTRA_OPTS=-Fc, poi
// `pg_restore --list` sul dump) — due tabelle con una FK, non fabbricato a mano.
const TOC_REALE = `;
; Archive created at 2026-08-24 07:35:10 UTC
;     dbname: polaris_db
;     TOC Entries: 10
;     Compression: gzip
;     Dump Version: 1.16-0
;     Format: CUSTOM
;     Integer: 4 bytes
;     Offset: 8 bytes
;     Dumped from database version: 18.4
;     Dumped by pg_dump version: 18.0
;
;
; Selected TOC Entries:
;
220; 1259 16410 TABLE public figlio polaris
219; 1259 16404 TABLE public genitore polaris
3477; 0 16410 TABLE DATA public figlio polaris
3476; 0 16404 TABLE DATA public genitore polaris
3327; 2606 16409 CONSTRAINT public genitore genitore_pkey polaris
3328; 2606 16413 FK CONSTRAINT public figlio figlio_genitore_id_fkey polaris
`;

test('parseElencoToc: ignora righe di intestazione/commento, estrae solo le voci dati', () => {
  const voci = parseElencoToc(TOC_REALE);
  assert.equal(voci.length, 6);
  assert.deepEqual(
    voci.map((v) => v.tipo),
    ['TABLE', 'TABLE', 'TABLE DATA', 'TABLE DATA', 'CONSTRAINT', 'FK CONSTRAINT'],
  );
});

test('parseElencoToc: la tabella proprietaria è corretta sia per TABLE/TABLE DATA sia per CONSTRAINT/FK CONSTRAINT', () => {
  const voci = parseElencoToc(TOC_REALE);
  const figlioTable = voci.find((v) => v.tipo === 'TABLE' && v.nomeOggetto === 'figlio');
  const fk = voci.find((v) => v.tipo === 'FK CONSTRAINT');
  assert.equal(figlioTable?.tabellaProprietaria, 'figlio');
  // La FK è definita SU figlio (anche se referenzia genitore) — pg_restore --list
  // la elenca sotto la tabella che possiede il vincolo, non quella referenziata.
  assert.equal(fk?.tabellaProprietaria, 'figlio');
});

test('filtraToc: esclude TABLE/TABLE DATA della tabella indicata', () => {
  const voci = parseElencoToc(TOC_REALE);
  const risultato = filtraToc(voci, ['genitore']);
  const righe = risultato.split('\n');
  assert.ok(righe.some((r) => r === ';219; 1259 16404 TABLE public genitore polaris'));
  assert.ok(righe.some((r) => r === ';3476; 0 16404 TABLE DATA public genitore polaris'));
  assert.ok(righe.some((r) => r === '220; 1259 16410 TABLE public figlio polaris'));
});

test('filtraToc: esclude anche i vincoli (CONSTRAINT/FK CONSTRAINT) che insistono sulla tabella esclusa', () => {
  const voci = parseElencoToc(TOC_REALE);
  // Escludo "figlio": la sua FK verso genitore deve sparire, il pkey su genitore no
  // (genitore resta incluso in questo scenario).
  const risultato = filtraToc(voci, ['figlio']);
  const righe = risultato.split('\n');
  assert.ok(righe.some((r) => r === ';3328; 2606 16413 FK CONSTRAINT public figlio figlio_genitore_id_fkey polaris'));
  assert.ok(righe.some((r) => r === '3327; 2606 16409 CONSTRAINT public genitore genitore_pkey polaris'));
});

test('filtraToc: nessuna esclusione lascia tutte le righe invariate', () => {
  const voci = parseElencoToc(TOC_REALE);
  const risultato = filtraToc(voci, []);
  for (const v of voci) {
    assert.ok(risultato.includes(v.rigaOriginale));
  }
});

test('percorsoBackupValido: rifiuta un path traversal (../ fuori da BACKUP_DIR)', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-backup-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const originale = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = dir;
  t.after(() => {
    if (originale === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = originale;
  });

  await assert.rejects(() => percorsoBackupValido('../../etc/passwd'), ErrorePercorsoNonValido);
  await assert.rejects(() => percorsoBackupValido('/etc/passwd'), ErrorePercorsoNonValido);
});

test('percorsoBackupValido: 404 su un file inesistente dentro BACKUP_DIR', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-backup-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const originale = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = dir;
  t.after(() => {
    if (originale === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = originale;
  });

  await assert.rejects(() => percorsoBackupValido('daily/inesistente.dump'), ErroreBackupNonTrovato);
});

test('percorsoBackupValido: accetta un file reale dentro BACKUP_DIR e ritorna il path assoluto', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-backup-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'daily'), { recursive: true });
  await writeFile(path.join(dir, 'daily', 'esempio.dump'), 'PGDMPxxx');
  const originale = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = dir;
  t.after(() => {
    if (originale === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = originale;
  });

  const percorso = await percorsoBackupValido('daily/esempio.dump');
  assert.equal(percorso, path.join(dir, 'daily', 'esempio.dump'));
});

test('listaBackup: rileva il formato valido dai magic byte PGDMP, non dall\'estensione del file', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-backup-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'daily'), { recursive: true });
  // Nome .sql.gz (come li nomina il container schedulato) ma contenuto binario
  // PGDMP -- lo scenario reale verificato col bring-up Docker.
  await writeFile(path.join(dir, 'daily', 'polaris_db-20260824.sql.gz'), Buffer.concat([Buffer.from('PGDMP'), Buffer.from([1, 2, 3])]));
  await writeFile(path.join(dir, 'daily', 'polaris_db-latest.sql.gz'), 'symlink placeholder, escluso dal nome');
  const originale = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = dir;
  t.after(() => {
    if (originale === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = originale;
  });

  const voci = await listaBackup();
  assert.equal(voci.length, 1); // "latest" escluso
  assert.equal(voci[0]!.origine, 'schedulato');
  assert.equal(voci[0]!.formatoValido, true);
});
