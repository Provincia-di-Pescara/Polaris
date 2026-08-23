import { richiedi } from './client.ts';

export interface VocePropostaProvvisoria {
  slotId: string;
  associazioneId: string;
  associazioneDenominazione: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  valoreMinutiAssegnato: string;
  fabbisognoRiconosciutoMinuti: string | null;
  isf: string | null;
  sorteggioRiferimento: { sorteggioId: string; articoloRiferimento: string } | null;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

export function propostaProvvisoria(stagioneId: string): Promise<VocePropostaProvvisoria[]> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/proposta`);
}

export type TipoProposta =
  | 'scambio_bilaterale'
  | 'scambio_multilaterale'
  | 'cessione'
  | 'utilizzo_slot_libero'
  | 'accorpamento'
  | 'ampliamento';

export type StatoProposta = 'in_attesa_accettazione' | 'accettata_da_tutti' | 'validata' | 'rigettata' | 'annullata';

export interface ParteProposta {
  associazioneId: string;
  accettatoIl: string | null;
  accettatoDaPersonaFisicaId: string | null;
}

export interface SlotProposta {
  slotId: string;
  associazioneCedenteId: string | null;
  associazioneRiceventeId: string;
}

export interface Proposta {
  id: string;
  stagioneId: string;
  tipo: TipoProposta;
  proponentePersonaFisicaId: string;
  proponenteAssociazioneId: string;
  stato: StatoProposta;
  versione: number;
  motivazioneRigetto: string | null;
  creataIl: string;
  validataIl: string | null;
  validataDa: string | null;
  parti: ParteProposta[];
  slot: SlotProposta[];
}

export interface DatiCreaProposta {
  stagioneId: string;
  proponenteAssociazioneId: string;
  tipo: TipoProposta;
  slot: { slotId: string; associazioneCedenteId?: string | undefined; associazioneRiceventeId: string }[];
}

export function creaProposta(dati: DatiCreaProposta): Promise<Proposta> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(dati.stagioneId)}/concertazione/proposte`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

export function listaProposteConcertazione(stagioneId: string): Promise<Proposta[]> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/concertazione/proposte`);
}

export function trovaPropostaConcertazione(id: string): Promise<Proposta> {
  return richiedi(`/pubblico/concertazione/proposte/${encodeURIComponent(id)}`);
}

export function accettaProposta(id: string, associazioneId: string): Promise<Proposta> {
  return richiedi(`/pubblico/concertazione/proposte/${encodeURIComponent(id)}/accetta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ associazioneId }),
  });
}

export function annullaProposta(id: string): Promise<Proposta> {
  return richiedi(`/pubblico/concertazione/proposte/${encodeURIComponent(id)}/annulla`, { method: 'POST' });
}
