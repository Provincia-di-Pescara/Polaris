import { richiedi } from './client.ts';

export interface Stagione {
  id: string;
  nome: string;
  dataInizio: string;
  dataFine: string;
  stato: string;
}

export function listaStagioni(): Promise<Stagione[]> {
  return richiedi('/stagioni');
}
