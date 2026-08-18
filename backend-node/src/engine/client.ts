export interface RisultatoIstruttoria {
  domandeCalcolate: number;
}

export interface RisultatoBlocchiGara {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  richiesteNonAssegnate: number;
}

export interface RisultatoPrimaAssegnazione {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  roundEseguiti: number;
}

export interface RisultatoRiassegnazioneResidua {
  elaborazioneId: string;
  numeroAssegnazioni: number;
  roundEseguiti: number;
}

// Il motore non è raggiungibile: connessione rifiutata, DNS, o il nostro
// timeout (AbortSignal.timeout) è scaduto prima di ricevere una risposta.
// Non sappiamo se il motore ha effettivamente eseguito qualcosa lato suo.
export class ErroreMotoreIrraggiungibile extends Error {}

// Il motore ha risposto ma con uno status non-2xx: httpapi.go restituisce
// sempre {"errore": "..."} per qualunque condizione di errore (dominio o
// interna), nessuna differenziazione di status — vedi engine-go/internal/httpapi.
export class ErroreMotoreDominio extends Error {}

export interface DatiAnteprimaFabbisogno {
  associazioneId: string;
  stagioneId: string;
  classeAttivitaCodice: string;
  livelloCampionato?: string | undefined;
  numeroSquadreFederali: number;
  fdMinuti: string;
}

export interface RisultatoAnteprimaFabbisogno {
  pesoBase: number;
  incrementoSquadre: number;
  frCalcolatoMinuti: string;
  frFinaleMinuti: string;
  crs: string;
  caa: string;
  csd: string;
  cp: string;
}

export interface ClientMotore {
  eseguiIstruttoria(stagioneId: string): Promise<RisultatoIstruttoria>;
  eseguiBlocchiGara(stagioneId: string): Promise<RisultatoBlocchiGara>;
  eseguiPrimaAssegnazione(stagioneId: string): Promise<RisultatoPrimaAssegnazione>;
  eseguiRiassegnazioneResidua(stagioneId: string): Promise<RisultatoRiassegnazioneResidua>;
  anteprimaFabbisogno(dati: DatiAnteprimaFabbisogno): Promise<RisultatoAnteprimaFabbisogno>;
}

async function chiamaMotore(baseUrl: string, timeoutMs: number, path: string, corpo?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      ...(corpo !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // fetch rigetta per connessione rifiutata, DNS, o abort da timeout: non
    // distinguiamo la causa, sono tutti "il motore non è raggiungibile ora".
    throw new ErroreMotoreIrraggiungibile(`motore non raggiungibile: ${baseUrl}${path}`);
  }

  if (!res.ok) {
    let messaggio = res.statusText || `HTTP ${res.status}`;
    try {
      const corpo = (await res.json()) as { errore?: unknown };
      if (typeof corpo.errore === 'string') {
        messaggio = corpo.errore;
      }
    } catch {
      // body non JSON: resta lo status text.
    }
    throw new ErroreMotoreDominio(messaggio);
  }

  return res.json();
}

export function creaClientMotore(baseUrl: string, timeoutMs: number): ClientMotore {
  return {
    async eseguiIstruttoria(stagioneId) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, `/stagioni/${stagioneId}/istruttoria`)) as {
        domande_calcolate: number;
      };
      return { domandeCalcolate: body.domande_calcolate };
    },
    async eseguiBlocchiGara(stagioneId) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, `/stagioni/${stagioneId}/blocchi-gara`)) as {
        elaborazione_id: string;
        numero_assegnazioni: number;
        richieste_non_assegnate: number;
      };
      return {
        elaborazioneId: body.elaborazione_id,
        numeroAssegnazioni: body.numero_assegnazioni,
        richiesteNonAssegnate: body.richieste_non_assegnate,
      };
    },
    async eseguiPrimaAssegnazione(stagioneId) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, `/stagioni/${stagioneId}/prima-assegnazione`)) as {
        elaborazione_id: string;
        numero_assegnazioni: number;
        round_eseguiti: number;
      };
      return {
        elaborazioneId: body.elaborazione_id,
        numeroAssegnazioni: body.numero_assegnazioni,
        roundEseguiti: body.round_eseguiti,
      };
    },
    async eseguiRiassegnazioneResidua(stagioneId) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, `/stagioni/${stagioneId}/riassegnazione-residua`)) as {
        elaborazione_id: string;
        numero_assegnazioni: number;
        round_eseguiti: number;
      };
      return {
        elaborazioneId: body.elaborazione_id,
        numeroAssegnazioni: body.numero_assegnazioni,
        roundEseguiti: body.round_eseguiti,
      };
    },
    async anteprimaFabbisogno(dati) {
      const body = (await chiamaMotore(baseUrl, timeoutMs, '/anteprima-fabbisogno', {
        associazione_id: dati.associazioneId,
        stagione_id: dati.stagioneId,
        classe_attivita_codice: dati.classeAttivitaCodice,
        livello_campionato: dati.livelloCampionato ?? null,
        numero_squadre_federali: dati.numeroSquadreFederali,
        fd_minuti: dati.fdMinuti,
      })) as {
        peso_base: number;
        incremento_squadre: number;
        fr_calcolato_minuti: string;
        fr_finale_minuti: string;
        crs: string;
        caa: string;
        csd: string;
        cp: string;
      };
      return {
        pesoBase: body.peso_base,
        incrementoSquadre: body.incremento_squadre,
        frCalcolatoMinuti: body.fr_calcolato_minuti,
        frFinaleMinuti: body.fr_finale_minuti,
        crs: body.crs,
        caa: body.caa,
        csd: body.csd,
        cp: body.cp,
      };
    },
  };
}
