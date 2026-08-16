import { ErroreRichiestaApi, richiedi } from './client';

export { ErroreRichiestaApi };

export interface VoceDisciplina {
  disciplinaCodice: string;
  disciplinaDenominazione: string;
  minuti: string;
}

export interface VoceImpianto {
  impiantoId: string;
  impiantoDenominazione: string;
  tassoUtilizzoPct: string | null;
}

export interface StatisticheStagione {
  tassoUtilizzoImpiantiPct: string | null;
  fascePregiateAssegnatePct: string | null;
  isfMedioAssociazioni: string | null;
  sociAtletiCoinvolti: number;
  distribuzioneMinutiPerDisciplina: VoceDisciplina[];
  saturazionePerImpianto: VoceImpianto[];
}

export function leggiStatisticheStagione(stagioneId: string): Promise<StatisticheStagione> {
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/statistiche`);
}
