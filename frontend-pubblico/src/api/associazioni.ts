import { richiedi } from './client.ts';

export interface Referente {
  nome: string;
  cognome: string;
  natoA: string;
  natoIl: string;
  residenteVia: string;
  residenteCitta: string;
  cellulare: string;
  cartaIdentita: string;
}

export interface ReferenteEmergenzeDae extends Referente {
  daeMarca: string;
  daeMatricola: string;
  daeScadenza: string;
}

export interface Assicurazione {
  compagnia: string;
  agenzia?: string | undefined;
  numeroPolizza: string;
  massimale: string;
  coperturaDal: string;
  coperturaAl: string;
}

export type TipologiaSoggetto =
  | 'associazione_sportiva'
  | 'cooperativa_ente_promozione_sportiva'
  | 'ente_promozione_culturale_giovanile_anziani'
  | 'ente_assistenza_handicap_volontariato'
  | 'soggetto_singolo_no_profit'
  | 'organizzazione_sindacale'
  | 'movimento_partito_politico'
  | 'gruppo_privati_circolo';

export interface Associazione {
  id: string;
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione: string | null;
  dataCostituzione: string | null;
  rappresentanteLegaleNome: string | null;
  rappresentanteLegaleCognome: string | null;
  delegatoNome: string | null;
  delegatoCognome: string | null;
  indirizzoVia: string | null;
  indirizzoCivico: string | null;
  indirizzoCitta: string | null;
  pec: string | null;
  email: string | null;
  tipologiaSoggetto: TipologiaSoggetto | null;
  iscrittaRasd: boolean;
  organismoSportivoCodice: string | null;
  codiceAffiliazione: string | null;
  haPersonaleAssunto: boolean;
}

export interface DatiCreaAssociazione {
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione?: string | undefined;
  dataCostituzione?: string | undefined;
  stagioneId: string;
  rappresentanteLegaleNome: string;
  rappresentanteLegaleCognome: string;
  delegatoNome?: string | undefined;
  delegatoCognome?: string | undefined;
  indirizzoVia: string;
  indirizzoCivico: string;
  indirizzoCitta: string;
  pec?: string | undefined;
  email: string;
  tipologiaSoggetto: TipologiaSoggetto;
  iscrittaRasd: boolean;
  organismoSportivoCodice?: string | undefined;
  codiceAffiliazione?: string | undefined;
  haPersonaleAssunto: boolean;
  referenteSicurezza: Referente;
  referenteEmergenzeDae: ReferenteEmergenzeDae;
  assicurazioneRct: Assicurazione;
  assicurazioneRco?: Assicurazione | undefined;
}

export function creaAssociazione(dati: DatiCreaAssociazione): Promise<Associazione> {
  return richiedi('/pubblico/associazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}

export interface DocumentoAssociazione {
  id: string;
  associazioneId: string;
  tipo: string;
  filePath: string;
  caricatoIl: string;
}

// multipart/form-data: niente header content-type esplicito, il browser imposta
// il boundary. Il campo file si chiama 'file' (multer(...).single('file') lato
// backend, vedi backend-node/src/documenti/storage.ts).
export function caricaDocumento(
  associazioneId: string,
  file: File,
  tipo: 'statuto' | 'atto_costitutivo' | 'altro',
): Promise<DocumentoAssociazione> {
  const form = new FormData();
  form.append('tipo', tipo);
  form.append('file', file);
  return richiedi(`/pubblico/associazioni/${encodeURIComponent(associazioneId)}/documenti`, {
    method: 'POST',
    body: form,
  });
}
