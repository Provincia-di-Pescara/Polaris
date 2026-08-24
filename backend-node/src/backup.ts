// Backup/ripristino manuale da UI backoffice (art. nessuno — funzionalità
// operativa, non normativa). Il backup schedulato giornaliero resta il
// container "backup" in docker-compose.yml (prodrigestivill/postgres-backup-local,
// stesso volume postgres_backups montato qui in lettura/scrittura) — questo
// modulo aggiunge: trigger manuale (sempre un dump FULL, mai parziale — la
// parzializzazione avviene solo in fase di ripristino, mai al backup) e
// ripristino selettivo per tabella.
//
// Formato dump: SEMPRE custom (`pg_dump -Fc`), mai plain SQL — è l'unico
// formato che pg_restore sa filtrare per tabella (via TOC, non esiste
// "pg_restore --exclude-table": quell'opzione esiste solo su pg_dump, e
// qui il dump deve restare full per costruzione). Il container "backup"
// schedulato usa la stessa opzione (POSTGRES_EXTRA_OPTS=-Fc in
// docker-compose.yml) pur mantenendo il nome file storico *.sql.gz
// dell'immagine upstream (non è un file gzip vero nonostante l'estensione:
// verificato con un bring-up reale, `pg_restore --list` legge il contenuto
// binario PGDMP direttamente) — qui rilevata via magic bytes, non fidandosi
// mai dell'estensione, e presentata con un nome corretto (.dump) verso la UI.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat, open, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

const MAGIC_PGDMP = Buffer.from('PGDMP');

export interface VoceBackup {
  // Nome file sul disco (usato per riferirsi al file in scarica/tabelle/ripristina
  // — mai un path assoluto lato client, solo il basename, validato server-side).
  nome: string;
  origine: 'schedulato' | 'manuale';
  dimensioneByte: number;
  creatoIl: string;
  formatoValido: boolean;
}

function dirBackup(): string {
  const dir = process.env.BACKUP_DIR;
  if (!dir) {
    throw new Error('BACKUP_DIR non impostata');
  }
  return dir;
}

function dirManuale(): string {
  return path.join(dirBackup(), 'manual');
}

// Legge solo i primi 5 byte: mai fidarsi dell'estensione del file (il container
// schedulato nomina tutto *.sql.gz anche quando il contenuto è già binario
// PGDMP, vedi commento in testa al file).
async function eFormatoCustomValido(percorsoAssoluto: string): Promise<boolean> {
  const fd = await open(percorsoAssoluto, 'r');
  try {
    const buf = Buffer.alloc(5);
    const { bytesRead } = await fd.read(buf, 0, 5, 0);
    return bytesRead === 5 && buf.equals(MAGIC_PGDMP);
  } finally {
    await fd.close();
  }
}

// Solo daily/weekly/monthly/last (origine "schedulato", scritti dal container
// backup) e manual (origine "manuale", scritti da eseguiBackupManuale sotto).
// Il container backup crea anche symlink *-latest.sql.gz dentro ogni cartella
// — esclusi qui (stat su un symlink rotto/duplicato non aggiunge informazione,
// lo stesso contenuto è già elencato col nome datato).
export async function listaBackup(): Promise<VoceBackup[]> {
  const radice = dirBackup();
  const sottocartelle: Array<{ nome: string; origine: VoceBackup['origine'] }> = [
    { nome: 'daily', origine: 'schedulato' },
    { nome: 'weekly', origine: 'schedulato' },
    { nome: 'monthly', origine: 'schedulato' },
    { nome: 'manual', origine: 'manuale' },
  ];

  const voci: VoceBackup[] = [];
  for (const { nome: sottocartella, origine } of sottocartelle) {
    const dirCompleta = path.join(radice, sottocartella);
    let file: string[];
    try {
      file = await readdir(dirCompleta);
    } catch {
      continue; // cartella non ancora creata (es. "manual" prima del primo backup manuale)
    }
    for (const nomeFile of file) {
      if (nomeFile.includes('latest')) continue; // symlink verso l'ultimo, duplicato
      const percorsoAssoluto = path.join(dirCompleta, nomeFile);
      const info = await stat(percorsoAssoluto);
      if (!info.isFile()) continue;
      voci.push({
        nome: path.posix.join(sottocartella, nomeFile),
        origine,
        dimensioneByte: info.size,
        creatoIl: info.mtime.toISOString(),
        formatoValido: await eFormatoCustomValido(percorsoAssoluto),
      });
    }
  }
  voci.sort((a, b) => b.creatoIl.localeCompare(a.creatoIl));
  return voci;
}

// L'unico punto che scrive nella cartella "manual" — nome sempre generato qui
// (timestamp + UUID corto), mai passato dal chiamante.
export async function eseguiBackupManuale(): Promise<VoceBackup> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL non impostata');
  }
  await mkdir(dirManuale(), { recursive: true });
  const nomeFile = `polaris-manuale-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.dump`;
  const percorsoAssoluto = path.join(dirManuale(), nomeFile);

  await execFileAsync('pg_dump', ['-Fc', '-f', percorsoAssoluto, databaseUrl]);

  const info = await stat(percorsoAssoluto);
  return {
    nome: path.posix.join('manual', nomeFile),
    origine: 'manuale',
    dimensioneByte: info.size,
    creatoIl: info.mtime.toISOString(),
    formatoValido: true,
  };
}

// Valida che `nome` (arrivato dal client) resti dentro dirBackup() — mai un
// path assoluto o ".." che sfugga dalla cartella dei backup. Ritorna il path
// assoluto solo se valido, altrimenti lancia.
function risolviPercorsoBackup(nome: string): string {
  const radice = dirBackup();
  const risolto = path.resolve(radice, nome);
  if (risolto !== radice && !risolto.startsWith(radice + path.sep)) {
    throw new ErrorePercorsoNonValido(`percorso non valido: ${nome}`);
  }
  return risolto;
}

export class ErrorePercorsoNonValido extends Error {}
export class ErroreBackupNonTrovato extends Error {}

export async function percorsoBackupValido(nome: string): Promise<string> {
  const percorso = risolviPercorsoBackup(nome);
  try {
    const info = await stat(percorso);
    if (!info.isFile()) throw new ErroreBackupNonTrovato(`backup non trovato: ${nome}`);
  } catch (err) {
    if (err instanceof ErroreBackupNonTrovato) throw err;
    throw new ErroreBackupNonTrovato(`backup non trovato: ${nome}`);
  }
  return percorso;
}

interface VoceToc {
  id: string;
  tipo: 'TABLE' | 'TABLE DATA' | 'CONSTRAINT' | 'FK CONSTRAINT' | 'ALTRO';
  schema: string | null;
  nomeOggetto: string;
  // Per CONSTRAINT/FK CONSTRAINT il "proprietario" è la tabella su cui insiste
  // il vincolo (nomeOggetto lì è il nome del vincolo, non della tabella) — per
  // le FK serve anche sapere quale tabella referenziano, non deducibile dalla
  // sola riga del TOC (serve interrogare pg_restore --list con dettaglio o il
  // nome del vincolo per convenzione — vedi parseRigaToc).
  tabellaProprietaria: string | null;
  rigaOriginale: string;
}

// Il formato di una riga dati (non-commento) di `pg_restore --list`:
// "<id>; <catalogId> <subId> <TIPO> <schema> <nome> <owner>" per TABLE/TABLE DATA,
// "<id>; <catalogId> <subId> CONSTRAINT <schema> <tabella> <nomeVincolo> <owner>"
// per CONSTRAINT/FK CONSTRAINT (qui il campo dopo lo schema è la tabella
// proprietaria, non il nome del vincolo — verificato contro output reale).
function parseRigaToc(riga: string): VoceToc | null {
  if (riga.startsWith(';') || riga.trim() === '') return null;
  // Cattura solo id/tipo/schema/secondoCampo: il resto della riga (owner, e per
  // CONSTRAINT anche il nome del vincolo) non serve qui e ha un numero di parole
  // diverso tra TABLE/TABLE DATA (3 parole dopo il tipo) e CONSTRAINT/FK CONSTRAINT
  // (4 parole) — un pattern che pretendesse di catturarle tutte con lo stesso
  // numero fisso di gruppi falliva su una delle due forme (bug reale, trovato
  // dal test contro l'output vero di pg_restore --list, non un TOC fabbricato).
  const m = /^(\d+);\s+\d+\s+\d+\s+(TABLE DATA|TABLE|FK CONSTRAINT|CONSTRAINT)\s+(\S+)\s+(\S+)/.exec(riga);
  if (!m) return null;
  const [, id, tipoRaw, schema, secondoCampo] = m;
  const tipo = tipoRaw as VoceToc['tipo'];
  if (tipo === 'CONSTRAINT' || tipo === 'FK CONSTRAINT') {
    // "<schema> <tabella> <nomeVincolo> <owner>" — secondoCampo è la tabella.
    return { id: id!, tipo, schema: schema!, nomeOggetto: secondoCampo!, tabellaProprietaria: secondoCampo!, rigaOriginale: riga };
  }
  // TABLE/TABLE DATA: "<schema> <nomeTabella> <owner>" — secondoCampo è la tabella.
  return { id: id!, tipo, schema: schema!, nomeOggetto: secondoCampo!, tabellaProprietaria: secondoCampo!, rigaOriginale: riga };
}

export function parseElencoToc(output: string): VoceToc[] {
  return output
    .split('\n')
    .map(parseRigaToc)
    .filter((v): v is VoceToc => v !== null);
}

// Elenco distinto delle tabelle presenti nel dump — usato dalla UI per popolare
// il checklist "escludi tabelle" prima del ripristino.
export async function elencoTabelle(nomeFile: string): Promise<string[]> {
  const percorso = await percorsoBackupValido(nomeFile);
  const { stdout } = await execFileAsync('pg_restore', ['--list', percorso]);
  const voci = parseElencoToc(stdout);
  const tabelle = new Set(voci.filter((v) => v.tipo === 'TABLE').map((v) => v.nomeOggetto));
  return Array.from(tabelle).sort();
}

// Commenta (prefisso ";") le righe TABLE/TABLE DATA delle tabelle escluse E le
// righe CONSTRAINT/FK CONSTRAINT che insistono su quelle tabelle (altrimenti
// pg_restore prova comunque ad applicare un vincolo su una tabella non
// ripristinata — non abortisce, ma logga un errore per ogni vincolo orfano,
// verificato con un bring-up reale: warning innocuo ma evitabile). Non tocca
// l'ordine delle righe: la lista resta valida per pg_restore -L.
export function filtraToc(toc: VoceToc[], tabelleEscluse: string[]): string {
  const escluse = new Set(tabelleEscluse);
  const righe = toc.map((v) => {
    const daEscludere = v.tabellaProprietaria !== null && escluse.has(v.tabellaProprietaria);
    return daEscludere ? `;${v.rigaOriginale}` : v.rigaOriginale;
  });
  return righe.join('\n') + '\n';
}

export interface EsitoRipristino {
  tabelleRipristinate: string[];
  tabelleEscluse: string[];
}

// DISTRUTTIVO: sovrascrive le tabelle NON escluse col contenuto del dump
// (--clean --if-exists: droppa prima di ricreare, idempotente se l'oggetto
// non esiste già). Le tabelle escluse restano intatte (mai toccate, né lette
// né scritte) — questo è il meccanismo di "ripristino parziale" richiesto:
// il backup è sempre full, l'esclusione avviene solo qui, in fase di
// ripristino, mai al momento del dump.
export async function eseguiRipristino(nomeFile: string, tabelleEscluse: string[]): Promise<EsitoRipristino> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL non impostata');
  }
  const percorso = await percorsoBackupValido(nomeFile);
  const { stdout } = await execFileAsync('pg_restore', ['--list', percorso]);
  const toc = parseElencoToc(stdout);
  const tutteLeTabelle = Array.from(new Set(toc.filter((v) => v.tipo === 'TABLE').map((v) => v.nomeOggetto)));
  const tocFiltrato = filtraToc(toc, tabelleEscluse);

  // In dirManuale(), non nella radice di dirBackup(): quella è di proprietà
  // root (fissata dal container di backup schedulato all'avvio), scrivibile
  // solo dentro le sottocartelle che il backend possiede — verificato con un
  // bring-up reale (EACCES altrimenti).
  await mkdir(dirManuale(), { recursive: true });
  const percorsoToc = path.join(dirManuale(), `.toc-${randomUUID()}.txt`);
  const fd = await open(percorsoToc, 'w');
  try {
    await fd.writeFile(tocFiltrato);
  } finally {
    await fd.close();
  }
  try {
    await execFileAsync('pg_restore', ['-L', percorsoToc, '-d', databaseUrl, '--no-owner', '--clean', '--if-exists', percorso]);
  } finally {
    await unlink(percorsoToc).catch(() => {});
  }

  return {
    tabelleRipristinate: tutteLeTabelle.filter((t) => !tabelleEscluse.includes(t)),
    tabelleEscluse: tabelleEscluse.filter((t) => tutteLeTabelle.includes(t)),
  };
}
