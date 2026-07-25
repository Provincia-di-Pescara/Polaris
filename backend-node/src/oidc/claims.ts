// Estrazione claim persona dal payload id_token di pa-sso-proxy (SATOSA), che fa da
// bridge SPID/CIE/eIDAS -> OIDC. Nomi claim non uniformi tra i tre casi (SPID puro,
// eIDAS, generico): si prova più chiavi in ordine di priorità, mai una sola per certa.
// Riferimento diretto: Comune-di-Montesilvano/ComunicaPA, stesso proxy in produzione
// (vedi CLAUDE.md sezione "OIDC SPID/CIE").

export interface ClaimPersona {
  codiceFiscale: string;
  nome: string;
  cognome: string;
}

function primoValore(val: unknown): string {
  if (Array.isArray(val)) {
    return val.length > 0 ? String(val[0]) : '';
  }
  return val !== null && val !== undefined ? String(val) : '';
}

function primoNonVuoto(payload: Record<string, unknown>, chiavi: string[]): string {
  for (const chiave of chiavi) {
    const v = primoValore(payload[chiave]);
    if (v) {
      return v;
    }
  }
  return '';
}

export function estraiClaimPersona(payload: Record<string, unknown>): ClaimPersona {
  const fiscalGrezzo = primoNonVuoto(payload, [
    'fiscal_number',
    'https://attributes.eid.gov.it/fiscal_number',
    'https://attributes.spid.gov.it/fiscalNumber',
    'codice_fiscale',
    'cf',
    'codiceFiscale',
    'fiscalNumber',
    'fiscalCode',
  ]).toUpperCase();

  if (!fiscalGrezzo) {
    throw new Error('nessun claim codice fiscale trovato nel token OIDC (fiscal_number/codice_fiscale/...)');
  }

  // "TIN" + codice paese ISO a 2 lettere + "-" (es. TINIT- per l'Italia)
  const codiceFiscale = fiscalGrezzo.replace(/^TIN[A-Z]{2}-/, '');

  const givenName = primoNonVuoto(payload, ['given_name', 'first_name', 'givenName']);
  const familyName = primoNonVuoto(payload, ['family_name', 'last_name', 'sn', 'surname', 'familyName']);

  if (givenName || familyName) {
    return { codiceFiscale, nome: givenName, cognome: familyName };
  }

  const nomeCompleto = primoNonVuoto(payload, ['name']);
  const [nome = '', ...resto] = nomeCompleto.split(' ').filter(Boolean);
  return { codiceFiscale, nome, cognome: resto.join(' ') };
}
