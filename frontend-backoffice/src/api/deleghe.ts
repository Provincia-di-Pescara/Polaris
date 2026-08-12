import { apiFetch } from './client.ts';

export interface AbilitazioneConDettagli {
  id: string;
  personaFisicaId: string;
  associazioneId: string | null;
  istituzioneScolasticaId: string | null;
  stagioneId: string;
  titolo: 'legale_rappresentante' | 'delegato';
  ruolo: 'rappresentante' | 'operatore';
  stato: 'in_attesa' | 'approvata' | 'respinta' | 'revocata';
  motivazione: string | null;
  creataDaAbilitazioneId: string | null;
  personaFisicaNome: string;
  personaFisicaCognome: string;
  personaFisicaCodiceFiscale: string;
  associazioneDenominazione: string | null;
  associazioneCodiceFiscalePartitaIva: string | null;
}

export interface DocumentoAssociazioneMeta {
  id: string;
  associazioneId: string;
  tipo: string;
  caricatoIl: string;
}

export class ErroreRichiestaApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function richiedi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
  return (await r.json()) as T;
}

function corpoJsonPut(dati: unknown): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dati) };
}

export function listaDeleghe(filtri: { stato?: string } = {}): Promise<AbilitazioneConDettagli[]> {
  const query = filtri.stato ? `?stato=${encodeURIComponent(filtri.stato)}` : '';
  return richiedi(`/backoffice/deleghe${query}`);
}

export function approvaDelega(id: string): Promise<AbilitazioneConDettagli> {
  return richiedi(`/backoffice/deleghe/${encodeURIComponent(id)}/approva`, corpoJsonPut({}));
}

export function respingiDelega(id: string, motivazione: string): Promise<AbilitazioneConDettagli> {
  return richiedi(`/backoffice/deleghe/${encodeURIComponent(id)}/respingi`, corpoJsonPut({ motivazione }));
}

export function revocaDelega(id: string): Promise<AbilitazioneConDettagli[]> {
  return richiedi(`/backoffice/deleghe/${encodeURIComponent(id)}/revoca`, corpoJsonPut({}));
}

export function listaDocumenti(associazioneId: string): Promise<DocumentoAssociazioneMeta[]> {
  return richiedi(`/backoffice/associazioni/${encodeURIComponent(associazioneId)}/documenti`);
}

// Non passa dal semplice URL diretto in un <iframe src=...>: richiedeAutenticazione
// (backend) legge il token SOLO dall'header Authorization, che un iframe non invia.
// Scarica il PDF via fetch autenticato (apiFetch) e lo trasforma in un Blob URL
// consumabile lato client (es. da un <iframe src={blobUrl}>).
export async function scaricaDocumentoBlob(id: string): Promise<string> {
  const r = await apiFetch(`/backoffice/documenti/${encodeURIComponent(id)}/scarica`);
  if (!r.ok) {
    throw new ErroreRichiestaApi(r.status, 'impossibile scaricare il documento');
  }
  const blob = await r.blob();
  return URL.createObjectURL(blob);
}
