import { ErroreRichiestaApi, richiedi } from './client.ts';

export { ErroreRichiestaApi };

export interface Elaborazione {
  id: string;
  stagioneId: string;
  tipo: string;
  parametricoVersioneId: string | null;
  iniziataIl: string;
  conclusaIl: string | null;
  stato: 'in_corso' | 'completata' | 'fallita';
  numeroRoundEseguiti: number | null;
  logDettaglio: unknown;
}

export interface RisultatoIstruttoria {
  domandeCalcolate: number;
}

export interface RisultatoBlocchiGara {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  richiesteNonAssegnate: number;
}

export interface RisultatoPrimaAssegnazione {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  roundEseguiti: number;
}

export interface RisultatoRiassegnazioneResidua {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  roundEseguiti: number;
}

export interface RisultatoApprovaDefinitiva {
  convenzioniCreate: number;
  assegnazioniSenzaIstituzioneSaltate: number;
}

function post(path: string): Promise<unknown> {
  return richiedi(path, { method: 'POST' });
}

export function eseguiIstruttoria(stagioneId: string): Promise<RisultatoIstruttoria> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/istruttoria`) as Promise<RisultatoIstruttoria>;
}

export function eseguiBlocchiGara(stagioneId: string): Promise<RisultatoBlocchiGara> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/blocchi-gara`) as Promise<RisultatoBlocchiGara>;
}

export function eseguiPrimaAssegnazione(stagioneId: string): Promise<RisultatoPrimaAssegnazione> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/prima-assegnazione`) as Promise<RisultatoPrimaAssegnazione>;
}

export function eseguiRiassegnazioneResidua(stagioneId: string): Promise<RisultatoRiassegnazioneResidua> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/riassegnazione-residua`) as Promise<RisultatoRiassegnazioneResidua>;
}

export function approvaDefinitiva(stagioneId: string): Promise<RisultatoApprovaDefinitiva> {
  return post(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/approva-definitiva`) as Promise<RisultatoApprovaDefinitiva>;
}

export function listaElaborazioni(stagioneId: string): Promise<Elaborazione[]> {
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/elaborazioni`);
}
