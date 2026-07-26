import { RepresentedEntity, ConcertazioneProposal } from './types';

export const mockRepresentedEntities: RepresentedEntity[] = [
  {
    id: 'ass-01',
    nome: 'ASD Pescara Volley',
    codiceFiscale: '92012340681',
    tipo: 'ASD',
    ruoloPersona: 'Legale Rappresentante',
    statoAccreditamento: 'approvato',
    isAttiva: true
  },
  {
    id: 'ass-02',
    nome: 'ASD Basket Pescara 1976',
    codiceFiscale: '92098760682',
    tipo: 'ASD',
    ruoloPersona: 'Delegato',
    statoAccreditamento: 'approvato',
    isAttiva: false
  }
];

export const mockConcertazioneProposals: ConcertazioneProposal[] = [
  {
    id: 'prop-101',
    associazioneProponente: 'ASD Basket Pescara 1976',
    associazioneRicevente: 'ASD Pescara Volley',
    slotOfferto: 'Martedì 17:00-19:00 @ Palestra Galilei',
    slotRichiesto: 'Lunedì 19:00-21:00 @ Palestra Galilei',
    stato: 'in_attesa',
    impattoIsfProponente: 0.045,
    impattoIsfRicevente: 0.020
  },
  {
    id: 'prop-100',
    associazioneProponente: 'SSD Montesilvano Calcio a 5',
    associazioneRicevente: 'ASD Pescara Volley',
    slotOfferto: 'Giovedì 19:00-21:00 @ Palasport Volta',
    slotRichiesto: 'Lunedì 17:00-19:00 @ Palestra Galilei',
    stato: 'accettato',
    impattoIsfProponente: 0.060,
    impattoIsfRicevente: 0.015
  }
];
