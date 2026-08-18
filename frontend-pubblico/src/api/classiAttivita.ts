import { richiedi } from './client.ts';

export interface ClasseAttivita {
  codice: string;
  descrizione: string;
  pesoBase: number;
}

export function listaClassiAttivita(): Promise<ClasseAttivita[]> {
  return richiedi('/classi-attivita');
}
