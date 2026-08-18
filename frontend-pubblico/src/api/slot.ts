import { richiedi } from './client.ts';

export interface SlotDisponibile {
  id: string;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

export function listaSlot(stagioneId: string, disciplinaCodice?: string): Promise<SlotDisponibile[]> {
  const query = disciplinaCodice ? `?disciplinaCodice=${encodeURIComponent(disciplinaCodice)}` : '';
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/slot${query}`);
}
