import { richiedi } from './client.ts';

export interface RichiestaGiornataGara {
  federazione: string;
  campionato: string;
  categoria: string;
  requisitiTecnici?: string | undefined;
  necessitaImpiantoOmologato: boolean;
}

export type LivelloCampionato = 'provinciale' | 'regionale' | 'interregionale' | 'nazionale';

export interface DatiCreaDomanda {
  associazioneId: string;
  stagioneId: string;
  disciplineCodici: string[];
  classeAttivitaCodice?: string | undefined;
  livelloCampionato?: LivelloCampionato | undefined;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  numeroSquadreFederaliStagionePrecedente: number;
  attivitaGiovanile: boolean;
  attivitaAgonistica: boolean;
  attivitaParalimpicaInclusiva: boolean;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
  preferenze: string[];
  blocchiAllenamento: string[][];
  richiedeGiornataGara: boolean;
  richiesteGiornataGara: RichiestaGiornataGara[];
}

export interface Domanda {
  id: string;
  numeroProtocollo: string;
  associazioneId: string;
  stagioneId: string;
  stato: 'presentata' | 'ammessa' | 'esclusa';
  presentataIl: string;
  numeroTesserati: number;
  numeroAtletiPartecipanti: number;
  numeroSquadre: number;
  fabbisognoMinimoMinuti: string;
  fabbisognoOttimaleMinuti: string;
}

export function creaDomanda(dati: DatiCreaDomanda): Promise<Domanda> {
  return richiedi('/pubblico/domande', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

export function listaDomandePerAssociazione(associazioneId: string): Promise<Domanda[]> {
  return richiedi(`/pubblico/associazioni/${encodeURIComponent(associazioneId)}/domande`);
}

export interface DatiAnteprimaFabbisogno {
  associazioneId: string;
  stagioneId: string;
  classeAttivitaCodice: string;
  livelloCampionato?: LivelloCampionato | undefined;
  numeroSquadreFederali: number;
  fdMinuti: string;
}

export interface AnteprimaFabbisogno {
  pesoBase: number;
  incrementoSquadre: number;
  frCalcolatoMinuti: string;
  frFinaleMinuti: string;
  crs: string;
  caa: string;
  csd: string;
  cp: string;
}

export function anteprimaFabbisogno(dati: DatiAnteprimaFabbisogno): Promise<AnteprimaFabbisogno> {
  return richiedi('/pubblico/domande/anteprima-fabbisogno', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}
