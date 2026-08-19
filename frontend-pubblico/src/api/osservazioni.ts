import { richiedi } from './client.ts';

export interface Osservazione {
  id: string;
  domandaId: string;
  testo: string;
  presentataIl: string;
  stato: 'in_esame' | 'accolta' | 'respinta';
  decisioneMotivazione: string | null;
  decisaIl: string | null;
}

export function listaOsservazioni(domandaId: string): Promise<Osservazione[]> {
  return richiedi(`/pubblico/domande/${encodeURIComponent(domandaId)}/osservazioni`);
}

export function presentaOsservazione(domandaId: string, testo: string): Promise<Osservazione> {
  return richiedi(`/pubblico/domande/${encodeURIComponent(domandaId)}/osservazioni`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ testo }),
  });
}
