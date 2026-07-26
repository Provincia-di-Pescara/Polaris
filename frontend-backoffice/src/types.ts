export type Role = 'admin' | 'operatore';

export interface Season {
  id: string;
  nome: string; // e.g. "Stagione Sportiva 2026/2027"
  dataInizio: string;
  dataFine: string;
  stato: 'in_preparazione' | 'accreditamento' | 'istruttoria' | 'assegnazione' | 'concertazione' | 'definitiva' | 'conclusa';
  faseCorrenteNum: number; // 1 to 16
}

export interface Facility {
  id: string;
  codice: string;
  nome: string;
  comune: string;
  indirizzo: string;
  istitutoScolastico: string;
  spaziCount: number;
}

export interface Space {
  id: string;
  impiantoId: string;
  nomeImpianto: string;
  nomeSpazio: string; // e.g. "Palestra Principale"
  omologazioni: string[]; // e.g. ["Pallavolo Serie B", "Pallacanestro Regionali"]
  copertura: 'coperto' | 'scoperto';
  fondo: string;
}

export interface Slot {
  id: string;
  spazioId: string;
  giornoSettimana: 'Lunedì' | 'Martedì' | 'Mercoledì' | 'Giovedì' | 'Venerdì' | 'Sabato' | 'Domenica';
  oraInizio: string;
  oraFine: string;
  durataMinuti: number;
  isFasciaPregiata: boolean;
  moltiplicatore: number;
  assegnatoA?: string; // Nome associazione
  tipoAssegnazione?: 'blocco_gara' | 'round_robin' | 'concertazione';
}

export interface DelegateRequest {
  id: string;
  personaFisica: string;
  codiceFiscale: string;
  email: string;
  associazioneNome: string;
  codiceFiscaleAssociazione: string;
  tipoAssociazione: 'ASD' | 'SSD' | 'Istituto Scolastico';
  ruoloRichiesto: 'Legale Rappresentante' | 'Delegato';
  documentoUrl: string;
  dataRichiesta: string;
  stato: 'in_attesa' | 'approvata' | 'respinta';
  noteOperatore?: string;
}

export interface Domanda {
  id: string;
  associazioneId: string;
  associazioneNome: string;
  classeAttivita: 'A' | 'B' | 'C' | 'D' | 'E';
  squadreFederaliCount: number;
  fdMinimoMinuti: number;
  fdOttimaleMinuti: number;
  frCalcolatoMinuti: number;
  crs: number;
  caa: number;
  csd: number;
  cp: number;
  isf: number;
  stato: 'ammessa' | 'in_revisione' | 'esclusa';
  richiedeBloccoGara: boolean;
}

export interface ParametricVersion {
  id: number;
  versione: string;
  validaDal: string;
  creataDa: string;
  moltiplicatoreMinutiPeso: number;
  pesoFascePregiate: number;
  limiteMinutiSettimanali: number;
  limiteSlotImpianto: number;
  limiteFascePregiate: number;
  limiteGiornateGara: number;
  tolleranzaIsfParita: number;
  sogliaMancatoUtilizzoDiffida: number;
  sogliaMancatoUtilizzoDecadenza: number;
  isAttiva: boolean;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  attore: string;
  ruoloAttore: string;
  tipoOperazione: string;
  descrizione: string;
  ipAddress: string;
}

export interface HMACSorteggioVerbale {
  id: string;
  proceduraId: string;
  articoloRiferimento: 'B.14' | 'B.21';
  semeHex: string;
  timestampGenerazione: string;
  algoritmo: 'hmac-sha256-rank-asc';
  vincitoreNome: string;
  hashVerbaleHex: string;
  candidati: {
    associazioneId: string;
    associazioneNome: string;
    hmacHex: string;
    rank: number;
  }[];
}
