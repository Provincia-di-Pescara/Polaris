import { apiFetch } from './client.ts';

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
