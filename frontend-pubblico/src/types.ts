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
