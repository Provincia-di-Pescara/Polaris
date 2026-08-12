import { ErroreRichiestaApi, richiedi } from './client.ts';

export { ErroreRichiestaApi };

export interface ScaglioneCsd {
  rapportoFdFrMin: string;
  rapportoFdFrMax: string | null;
  coefficiente: string;
}

export interface VersioneParametrica {
  id: string;
  validaDal: string;
  pubblicataDa: string | null;
  note: string | null;
  moltiplicatoreMinutiPerPunto: string;
  pesoFasciaPregiata: string;
  minutiSettimanaliMax: string;
  slotMaxStessoImpianto: number;
  fascePregiateMax: number;
  giornateGaraMax: number;
  incrementoSquadreNeutro: number;
  caaNeutro: string;
  csdNeutro: string;
  tolleranzaIsfPct: string;
  sogliaMancatiUtilizziDiffida: number;
  sogliaMancatiUtilizziDecadenza: number;
  sogliaScostamentoDichiaratoPct: string;
  sogliaIsfCompensazione: string;
  retentionLogOperazioniGiorni: number;
  quotaNuoveAssociazioniPct: string;
  termineGiustificazioneGiorni: number;
  creataIl: string;
  csdScaglioni: ScaglioneCsd[];
}

export interface VersioneParametricaSintetica {
  id: string;
  validaDal: string;
  pubblicataDa: string | null;
  note: string | null;
}

// Definito esplicitamente (non via Omit<VersioneParametrica, ...>): VersioneParametrica.note
// è `string | null` (valore già salvato, può essere assente), ma lo zod schema backend
// (schemaCreaVersioneParametrico) ha `note` come `.optional()` — accetta undefined, MAI
// null esplicito. Un Omit erediterebbe `string | null` e produrrebbe un payload che il
// backend rifiuta con 400 se il form invia `note: null`.
export interface DatiCreaVersione {
  note?: string | undefined;
  moltiplicatoreMinutiPerPunto: string;
  pesoFasciaPregiata: string;
  minutiSettimanaliMax: string;
  slotMaxStessoImpianto: number;
  fascePregiateMax: number;
  giornateGaraMax: number;
  incrementoSquadreNeutro: number;
  caaNeutro: string;
  csdNeutro: string;
  tolleranzaIsfPct: string;
  sogliaMancatiUtilizziDiffida: number;
  sogliaMancatiUtilizziDecadenza: number;
  sogliaScostamentoDichiaratoPct: string;
  sogliaIsfCompensazione: string;
  retentionLogOperazioniGiorni: number;
  quotaNuoveAssociazioniPct: string;
  termineGiustificazioneGiorni: number;
  csdScaglioni: Array<{ rapportoFdFrMin: string; rapportoFdFrMax: string | null; coefficiente: string }>;
}

export function leggiVersioneAttiva(): Promise<VersioneParametrica> {
  return richiedi('/backoffice/parametrico');
}

export function listaVersioni(): Promise<VersioneParametricaSintetica[]> {
  return richiedi('/backoffice/parametrico/versioni');
}

export function leggiVersionePerId(id: string): Promise<VersioneParametrica> {
  return richiedi(`/backoffice/parametrico/versioni/${encodeURIComponent(id)}`);
}

export function creaVersione(dati: DatiCreaVersione): Promise<VersioneParametrica> {
  return richiedi('/backoffice/parametrico', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}
