import { richiedi, apiFetch, ErroreRichiestaApi } from './client.ts';

export { ErroreRichiestaApi };

export interface VoceBackup {
  nome: string;
  origine: 'schedulato' | 'manuale';
  dimensioneByte: number;
  creatoIl: string;
  formatoValido: boolean;
}

export function listaBackup(): Promise<VoceBackup[]> {
  return richiedi('/backoffice/backup');
}

export function eseguiBackupManuale(): Promise<VoceBackup> {
  return richiedi('/backoffice/backup/esegui', { method: 'POST' });
}

export function elencoTabelle(nome: string): Promise<string[]> {
  return richiedi(`/backoffice/backup/${encodeURIComponent(nome)}/tabelle`);
}

export interface EsitoRipristino {
  tabelleRipristinate: string[];
  tabelleEscluse: string[];
}

export function eseguiRipristino(nome: string, tabelleEscluse: string[]): Promise<EsitoRipristino> {
  return richiedi(`/backoffice/backup/${encodeURIComponent(nome)}/ripristina`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tabelleEscluse }),
  });
}

// Streaming binario -> niente richiedi() (che fa sempre .json()): scarica il
// blob via apiFetch, ricava il nome file dal Content-Disposition e lo salva
// con un click <a> sintetico (nessun endpoint di download nativo del browser).
export async function scaricaBackup(nome: string): Promise<void> {
  const r = await apiFetch(`/backoffice/backup/${encodeURIComponent(nome)}/scarica`);
  if (!r.ok) {
    let messaggio = r.statusText || `HTTP ${r.status}`;
    try {
      const corpo = (await r.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') messaggio = corpo.errore;
    } catch {
      // body non JSON
    }
    throw new ErroreRichiestaApi(r.status, messaggio);
  }
  const intestazione = r.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(intestazione);
  const nomeFile = match?.[1] ?? nome.split('/').pop() ?? 'backup.dump';

  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
