import { richiedi } from './client.ts';

export interface Disciplina {
  codice: string;
  denominazione: string;
}

export function listaDiscipline(): Promise<Disciplina[]> {
  return richiedi('/discipline');
}
