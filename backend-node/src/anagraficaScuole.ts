// "Once only" (art. non specifico, principio generale semplificazione PA): la
// denominazione/indirizzo di un'istituzione scolastica sono già pubblici
// nell'anagrafica open data del MIUR (dati.istruzione.it) — l'operatore digita
// solo il codice meccanografico/nome per cercarla, mai li ritrascrive a mano.
// URL del dataset configurabile da admin (impostazioni_sistema, chiave
// 'anagrafica_scuole_url'): il MIUR pubblica un file per anno scolastico con
// l'anno nel nome, va aggiornato quando cambia — mai hardcoded qui.
import type { Db } from './db.ts';
import { leggiImpostazione, scriviImpostazione } from './repository/impostazioniSistema.ts';

const CHIAVE_IMPOSTAZIONE = 'anagrafica_scuole_url';
const DURATA_CACHE_MS = 24 * 60 * 60 * 1000; // 24h, stesso TTL dello script PHP di riferimento

export async function leggiUrlAnagraficaScuole(db: Db): Promise<string | null> {
  const v = await leggiImpostazione<{ url: string }>(db, CHIAVE_IMPOSTAZIONE);
  return v?.url ?? null;
}

export async function scriviUrlAnagraficaScuole(db: Db, url: string, aggiornataDa?: string | undefined): Promise<void> {
  await scriviImpostazione(db, CHIAVE_IMPOSTAZIONE, { url }, aggiornataDa);
}

export interface ScuolaAnagrafica {
  codice: string;
  denominazione: string;
  comune: string;
  indirizzo: string;
}

interface VoceCache {
  url: string;
  scuole: ScuolaAnagrafica[];
  scadeIl: number;
}

let cache: VoceCache | null = null;

// Il dataset MIUR non ha uno schema JSON fisso da un anno all'altro: a volte le
// righe sono sotto "@graph", a volte "data", a volte è direttamente un array —
// stesso fallback già verificato funzionante nello script PHP di riferimento.
function estraiRighe(dati: unknown): unknown[] {
  if (Array.isArray(dati)) return dati;
  if (dati && typeof dati === 'object') {
    const obj = dati as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) return obj['@graph'] as unknown[];
    if (Array.isArray(obj['data'])) return obj['data'] as unknown[];
  }
  return [];
}

function pulisci(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).trim();
}

function normalizza(riga: unknown): ScuolaAnagrafica | null {
  if (!riga || typeof riga !== 'object') return null;
  const r = riga as Record<string, unknown>;
  const codice = pulisci(r['miur:CODICESCUOLA']);
  const denominazione = pulisci(r['miur:DENOMINAZIONESCUOLA']);
  if (!codice || !denominazione) return null;
  return {
    codice,
    denominazione,
    comune: pulisci(r['miur:DESCRIZIONECOMUNE']).toUpperCase(),
    indirizzo: pulisci(r['miur:INDIRIZZOSCUOLA']),
  };
}

async function scaricaScuole(url: string): Promise<ScuolaAnagrafica[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`anagrafica scuole non raggiungibile: HTTP ${res.status}`);
  }
  const dati: unknown = await res.json();
  return estraiRighe(dati)
    .map(normalizza)
    .filter((s): s is ScuolaAnagrafica => s !== null);
}

async function scuoleConCache(url: string): Promise<ScuolaAnagrafica[]> {
  if (cache && cache.url === url && cache.scadeIl > Date.now()) {
    return cache.scuole;
  }
  const scuole = await scaricaScuole(url);
  cache = { url, scuole, scadeIl: Date.now() + DURATA_CACHE_MS };
  return scuole;
}

export class ErroreAnagraficaNonConfigurata extends Error {}

const MAX_RISULTATI_RICERCA = 25;

// Cerca per sottostringa case-insensitive su denominazione O codice (stesso
// comportamento del parametro "q" dello script PHP di riferimento) — mai una
// ricerca esatta: l'operatore spesso conosce solo il nome parziale della scuola.
export async function cercaScuole(db: Db, query: string): Promise<ScuolaAnagrafica[]> {
  const url = await leggiUrlAnagraficaScuole(db);
  if (!url) {
    throw new ErroreAnagraficaNonConfigurata('URL anagrafica scuole non configurato (Impostazioni)');
  }
  const scuole = await scuoleConCache(url);
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return scuole
    .filter((s) => s.denominazione.toLowerCase().includes(q) || s.codice.toLowerCase().includes(q))
    .sort((a, b) => a.denominazione.localeCompare(b.denominazione))
    .slice(0, MAX_RISULTATI_RICERCA);
}
