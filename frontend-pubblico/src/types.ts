export interface ApplicationWizardState {
  classeAttivita: 'A' | 'B' | 'C' | 'D' | 'E';
  squadreFederaliCount: number;
  fdMinimoMinuti: number;
  fdOttimaleMinuti: number;
  richiedeBloccoGara: boolean;
  bloccoGaraImpiantoId: string;
  bloccoGaraGiorno: 'Sabato' | 'Domenica';
  preferenzeImpianti: string[];
}

export interface ConcertazioneProposal {
  id: string;
  associazioneProponente: string;
  associazioneRicevente: string;
  slotOfferto: string;
  slotRichiesto: string;
  stato: 'in_attesa' | 'accettato' | 'rifiutato' | 'validato';
  impattoIsfProponente: number; // e.g. +0.05
  impattoIsfRicevente: number;  // e.g. +0.03
}
