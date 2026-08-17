import { richiedi } from './client.ts';

export interface Associazione {
  id: string;
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione: string | null;
  dataCostituzione: string | null;
}

export interface DatiCreaAssociazione {
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione?: string | undefined;
  dataCostituzione?: string | undefined;
  stagioneId: string;
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
