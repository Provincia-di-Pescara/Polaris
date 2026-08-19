import { richiedi } from './client.ts';

export interface AssegnazioneLettura {
  id: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  stato: 'provvisoria' | 'validata' | 'decaduta' | 'sostituita';
  valoreMinuti: string;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

export function listaAssegnazioni(associazioneId: string, stagioneId: string): Promise<AssegnazioneLettura[]> {
  return richiedi(
    `/pubblico/associazioni/${encodeURIComponent(associazioneId)}/assegnazioni?stagioneId=${encodeURIComponent(stagioneId)}`,
  );
}
