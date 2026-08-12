import { apiFetch } from './client.ts';

export interface OperazioneConAttore {
  id: string;
  attoreNome: string;
  attoreTipo: 'backoffice' | 'pubblico';
  ruolo: string | null;
  azione: string;
  entitaTipo: string;
  entitaId: string | null;
  dettaglio: Record<string, unknown> | null;
  ipAddress: string | null;
  avvenutaIl: string;
}

export interface SorteggioSintetico {
  id: string;
  elaborazioneId: string | null;
  articoloRiferimento: string;
  contesto: string;
  semeHex: string;
  semeGeneratoIl: string;
  vincitoreAssociazioneId: string;
}

export interface CandidatoSorteggio {
  associazioneId: string;
  ordineCanonico: number;
  hmacHex: string;
  rank: number;
}

export interface SorteggioDettaglio extends SorteggioSintetico {
  algoritmo: string;
  algoritmoVersione: string;
  hashVerbale: string;
  candidati: CandidatoSorteggio[];
}

export class ErroreRichiestaApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function richiedi<T>(path: string): Promise<T> {
  const r = await apiFetch(path);
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

export interface FiltriLogOperazioni {
  entitaTipo?: string;
  azione?: string;
  dataDa?: string;
  dataA?: string;
  limit?: number;
  offset?: number;
}

export function listaLogOperazioni(filtri: FiltriLogOperazioni = {}): Promise<OperazioneConAttore[]> {
  const params = new URLSearchParams();
  if (filtri.entitaTipo) params.set('entitaTipo', filtri.entitaTipo);
  if (filtri.azione) params.set('azione', filtri.azione);
  if (filtri.dataDa) params.set('dataDa', filtri.dataDa);
  if (filtri.dataA) params.set('dataA', filtri.dataA);
  if (filtri.limit) params.set('limit', String(filtri.limit));
  if (filtri.offset) params.set('offset', String(filtri.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return richiedi(`/backoffice/log-operazioni${query}`);
}

export function listaSorteggiPerStagione(stagioneId: string): Promise<SorteggioSintetico[]> {
  return richiedi(`/backoffice/stagioni/${encodeURIComponent(stagioneId)}/sorteggi`);
}

export function trovaSorteggio(id: string): Promise<SorteggioDettaglio> {
  return richiedi(`/backoffice/sorteggi/${encodeURIComponent(id)}`);
}

// Ricalcolo REALE dell'HMAC lato browser (art. B.38: "riproducibile da terzi con solo
// seme + lista candidati + HMAC-SHA256 standard", vedi CLAUDE.md). Stesso algoritmo del
// motore Go: HMAC-SHA256(key = decode_hex(seme), message = UTF8(associazione_id)), hex
// lowercase.
function hexABytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesAHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verificaHmac(semeHex: string, associazioneId: string): Promise<string> {
  const chiave = await crypto.subtle.importKey('raw', hexABytes(semeHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', chiave, new TextEncoder().encode(associazioneId));
  return bytesAHex(new Uint8Array(firma));
}
