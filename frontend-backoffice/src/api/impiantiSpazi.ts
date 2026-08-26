import { apiFetch, ErroreRichiestaApi } from './client.ts';

export interface Disciplina {
  codice: string;
  denominazione: string;
}

export interface Istituzione {
  id: string;
  denominazione: string;
  codiceMeccanografico: string | null;
  indirizzo: string | null;
}

export interface Impianto {
  id: string;
  denominazione: string;
  istituzioneScolasticaId: string | null;
  indirizzo: string | null;
}

export interface SpazioSportivo {
  id: string;
  impiantoId: string;
  denominazione: string;
  omologazioni: string[];
  note: string | null;
  disciplineCompatibili: string[];
}

export interface Slot {
  id: string;
  stagioneId: string;
  spazioId: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
  indisponibilePermanente: boolean;
  note: string | null;
}

export interface DatiIstituzione {
  denominazione: string;
  codiceMeccanografico?: string;
  indirizzo?: string;
}

export interface DatiImpianto {
  denominazione: string;
  istituzioneScolasticaId?: string;
  indirizzo?: string;
}

export interface DatiCreaSpazio {
  impiantoId: string;
  denominazione: string;
  omologazioni?: string[];
  note?: string;
  disciplineCompatibili?: string[];
}

export interface DatiAggiornaSpazio {
  denominazione: string;
  omologazioni?: string[];
  note?: string;
  disciplineCompatibili?: string[];
}

export interface DatiCreaSlot {
  stagioneId: string;
  spazioId: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  pregiata?: boolean;
  indisponibilePermanente?: boolean;
  note?: string;
}

export interface DatiAggiornaSlot {
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  pregiata: boolean;
  indisponibilePermanente: boolean;
  note?: string;
}

// Errore uniforme per ogni chiamata crea*/aggiorna*: `status` distingue 400
// (validazione/riferimento non valido), 404 (non trovato), 409 (duplicato) nei
// form chiamanti, `message` è il campo `errore` del corpo JSON del backend.
// Classe unica condivisa (definita in client.ts), ri-esportata qui perché ogni
// componente di questo modulo la importa da `../../api/impiantiSpazi.ts`.
export { ErroreRichiestaApi };

async function richiedi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
  if (r.status === 204) {
    return undefined as T;
  }
  return (await r.json()) as T;
}

function corpoJson(dati: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dati) };
}

function corpoJsonPut(dati: unknown): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dati) };
}

// --- Discipline ---

export function listaDiscipline(): Promise<Disciplina[]> {
  return richiedi('/backoffice/discipline');
}

export function creaDisciplina(dati: { codice: string; denominazione: string }): Promise<Disciplina> {
  return richiedi('/backoffice/discipline', corpoJson(dati));
}

export function aggiornaDisciplina(codice: string, denominazione: string): Promise<Disciplina> {
  return richiedi(`/backoffice/discipline/${encodeURIComponent(codice)}`, corpoJsonPut({ denominazione }));
}

// --- Istituzioni ---

export function listaIstituzioni(): Promise<Istituzione[]> {
  return richiedi('/backoffice/istituzioni');
}

export function creaIstituzione(dati: DatiIstituzione): Promise<Istituzione> {
  return richiedi('/backoffice/istituzioni', corpoJson(dati));
}

export function aggiornaIstituzione(id: string, dati: DatiIstituzione): Promise<Istituzione> {
  return richiedi(`/backoffice/istituzioni/${encodeURIComponent(id)}`, corpoJsonPut(dati));
}

// "Once only": ricerca nell'anagrafica open data del MIUR (URL configurabile,
// vedi leggiUrlAnagraficaScuole/salvaUrlAnagraficaScuole sotto) invece di
// ritrascrivere a mano denominazione/indirizzo, già pubblici altrove.
export interface ScuolaAnagrafica {
  codice: string;
  denominazione: string;
  comune: string;
  indirizzo: string;
}

export function cercaAnagraficaScuole(q: string): Promise<ScuolaAnagrafica[]> {
  return richiedi(`/backoffice/istituzioni/anagrafica-ricerca?q=${encodeURIComponent(q)}`);
}

export function leggiUrlAnagraficaScuole(): Promise<{ url: string | null }> {
  return richiedi('/backoffice/impostazioni/anagrafica-scuole');
}

export function salvaUrlAnagraficaScuole(url: string): Promise<{ url: string }> {
  return richiedi('/backoffice/impostazioni/anagrafica-scuole', corpoJsonPut({ url }));
}

// --- Impianti ---

export function listaImpianti(istituzioneScolasticaId?: string): Promise<Impianto[]> {
  const query = istituzioneScolasticaId ? `?istituzioneScolasticaId=${encodeURIComponent(istituzioneScolasticaId)}` : '';
  return richiedi(`/backoffice/impianti${query}`);
}

export function creaImpianto(dati: DatiImpianto): Promise<Impianto> {
  return richiedi('/backoffice/impianti', corpoJson(dati));
}

export function aggiornaImpianto(id: string, dati: DatiImpianto): Promise<Impianto> {
  return richiedi(`/backoffice/impianti/${encodeURIComponent(id)}`, corpoJsonPut(dati));
}

// --- Spazi ---

export function listaSpaziPerImpianto(impiantoId: string): Promise<SpazioSportivo[]> {
  return richiedi(`/backoffice/impianti/${encodeURIComponent(impiantoId)}/spazi`);
}

export function creaSpazio(dati: DatiCreaSpazio): Promise<SpazioSportivo> {
  const { impiantoId, ...corpo } = dati;
  return richiedi(`/backoffice/impianti/${encodeURIComponent(impiantoId)}/spazi`, corpoJson(corpo));
}

export function aggiornaSpazio(id: string, dati: DatiAggiornaSpazio): Promise<SpazioSportivo> {
  return richiedi(`/backoffice/spazi/${encodeURIComponent(id)}`, corpoJsonPut(dati));
}

// --- Slot ---

export function listaSlot(stagioneId: string, spazioId?: string): Promise<Slot[]> {
  const query = spazioId ? `?spazioId=${encodeURIComponent(spazioId)}` : '';
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/slot${query}`);
}

export function creaSlot(dati: DatiCreaSlot): Promise<Slot> {
  const { stagioneId, ...corpo } = dati;
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/slot`, corpoJson(corpo));
}

export function aggiornaSlot(id: string, dati: DatiAggiornaSlot): Promise<Slot> {
  return richiedi(`/backoffice/slot/${encodeURIComponent(id)}`, corpoJsonPut(dati));
}
