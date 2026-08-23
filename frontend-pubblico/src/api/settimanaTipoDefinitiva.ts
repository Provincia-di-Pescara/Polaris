import { richiedi } from './client.ts';

export interface VoceSettimanaTipoDefinitiva {
  slotId: string;
  associazioneId: string;
  associazioneDenominazione: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
  concertazioneProposaId: string | null;
  efficace: boolean;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
}

export interface SettimanaTipoDefinitiva {
  fasce: VoceSettimanaTipoDefinitiva[];
  slotLiberi: string[];
}

export function settimanaTipoDefinitiva(stagioneId: string): Promise<SettimanaTipoDefinitiva> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/settimana-tipo-definitiva`);
}
