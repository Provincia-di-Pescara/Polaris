import { apiFetch, ErroreRichiestaApi, richiedi } from './client.ts';

export { ErroreRichiestaApi };

// Shape base restituita dalle route PUT approva/respingi/revoca (backend-node
// src/abilitazioni.ts, interfaccia `Abilitazione`) — a differenza di
// AbilitazioneConDettagli sotto, NON include i campi arricchiti con JOIN
// (persona fisica/associazione), che solo `GET /backoffice/deleghe` restituisce.
export interface Abilitazione {
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
}

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

function corpoJsonPut(dati: unknown): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dati) };
}

export function listaDeleghe(filtri: { stato?: string } = {}): Promise<AbilitazioneConDettagli[]> {
  const query = filtri.stato ? `?stato=${encodeURIComponent(filtri.stato)}` : '';
  return richiedi(`/backoffice/deleghe${query}`);
}

export function approvaDelega(id: string): Promise<Abilitazione> {
  return richiedi(`/backoffice/deleghe/${encodeURIComponent(id)}/approva`, corpoJsonPut({}));
}

export function respingiDelega(id: string, motivazione: string): Promise<Abilitazione> {
  return richiedi(`/backoffice/deleghe/${encodeURIComponent(id)}/respingi`, corpoJsonPut({ motivazione }));
}

export function revocaDelega(id: string): Promise<Abilitazione[]> {
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
