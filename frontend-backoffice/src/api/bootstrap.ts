import { richiedi, apiFetch, ErroreRichiestaApi } from './client.ts';

export interface StatoBootstrap {
  disponibile: boolean;
}

// Pubblici, mai autenticati: richiedi() allega comunque un Bearer se presente in
// storage, innocuo qui (il backend non lo richiede per queste route).
export function statoBootstrap(): Promise<StatoBootstrap> {
  return richiedi('/auth/bootstrap/stato');
}

export interface DatiPrimoAdmin {
  email: string;
  password: string;
  nome: string;
  cognome: string;
}

// 204 senza corpo in caso di successo: richiedi() farebbe .json() su un body
// vuoto e lancerebbe — stesso motivo per cui AuthContext.logout() bypassa
// richiedi() per lo stesso endpoint-shape (204).
export async function richiediPrimoAdmin(dati: DatiPrimoAdmin): Promise<void> {
  const r = await apiFetch('/auth/bootstrap/primo-admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') messaggio = corpo.errore;
    } catch {
      // body non JSON: resta lo status text
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
}

export interface EsitoVericaBootstrap {
  email: string;
}

export function verificaBootstrap(token: string): Promise<EsitoVericaBootstrap> {
  return richiedi('/auth/bootstrap/verifica', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}
