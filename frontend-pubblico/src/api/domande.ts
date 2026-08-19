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
  riesameStato: 'nessuno' | 'richiesto' | 'deciso';
  motivazioneEsclusione: string | null;
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

export function listaDomandePerAssociazione(associazioneId: string, stagioneId?: string): Promise<Domanda[]> {
  const query = stagioneId ? `?stagioneId=${encodeURIComponent(stagioneId)}` : '';
  return richiedi(`/pubblico/associazioni/${encodeURIComponent(associazioneId)}/domande${query}`);
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

export interface EsitoIstruttoria {
  frCalcolatoMinuti: string;
  fdMinuti: string;
  frFinaleMinuti: string;
}

export interface EsitoCoefficienti {
  crs: string;
  caa: string;
  csd: string;
  cp: string;
}

export interface EsitoPubblicato {
  domandaId: string;
  associazioneId: string;
  associazioneDenominazione: string;
  stato: 'presentata' | 'ammessa' | 'esclusa';
  motivazioneEsclusione: string | null;
  fabbisognoRiconosciuto: EsitoIstruttoria | null;
  coefficienti: EsitoCoefficienti | null;
}

export function elencoEsitiPubblicati(stagioneId: string): Promise<EsitoPubblicato[]> {
  return richiedi(`/pubblico/stagioni/${encodeURIComponent(stagioneId)}/domande/esiti`);
}
