import { apiFetch, richiedi, ErroreRichiestaApi } from './client.ts';

export { ErroreRichiestaApi };

export interface Stagione {
  id: string;
  nome: string;
  dataInizio: string;
  dataFine: string;
  stato: string;
}

export async function listaStagioni(): Promise<Stagione[]> {
  const r = await apiFetch('/stagioni');
  if (!r.ok) {
    throw new Error('impossibile caricare le stagioni');
  }
  return (await r.json()) as Stagione[];
}

export interface DatiCreaStagione {
  nome: string;
  dataInizio: string;
  dataFine: string;
}

// Solo admin (richiedeRuolo('admin') lato backend) — lo stato iniziale è sempre
// il default di schema (nessun campo "attiva": lo stato avanza attraverso il
// flusso procedurale in ControlRoomView, non è un flag impostabile qui).
export function creaStagione(dati: DatiCreaStagione): Promise<Stagione> {
  return richiedi('/backoffice/stagioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

export type DatiAggiornaStagione = DatiCreaStagione;

// Ammessa solo se stato='censimento' e senza dati collegati (409 altrimenti,
// messaggio del backend mostrato verbatim) -- vedi
// docs/superpowers/specs/2026-08-24-gestione-stagioni-design.md.
export function aggiornaStagione(id: string, dati: DatiAggiornaStagione): Promise<Stagione> {
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

// 204 No Content sul successo -- richiedi() farebbe sempre .json(), stesso
// bypass già usato per /auth/logout e /auth/bootstrap/primo-admin.
export async function eliminaStagione(id: string): Promise<void> {
  const r = await apiFetch(`/backoffice/stagioni/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') messaggio = corpo.errore;
    } catch {
      // body non JSON
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
}
