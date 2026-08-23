import { apiFetch, richiedi } from './client.ts';

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
