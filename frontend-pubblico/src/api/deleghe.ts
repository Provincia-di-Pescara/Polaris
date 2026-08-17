import { richiedi } from './client.ts';

export interface EntitaRappresentata {
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

export function listaEntitaRappresentate(): Promise<EntitaRappresentata[]> {
  return richiedi('/pubblico/deleghe/mie');
}

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

export interface DatiCreaSubDelega {
  codiceFiscale: string;
  nome: string;
  cognome: string;
  associazioneId: string;
  stagioneId: string;
  ruolo: 'rappresentante' | 'operatore';
}

export function creaSubDelega(dati: DatiCreaSubDelega): Promise<Abilitazione> {
  return richiedi('/pubblico/deleghe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dati),
  });
}
