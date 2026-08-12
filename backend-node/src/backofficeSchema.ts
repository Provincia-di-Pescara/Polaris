import { z } from 'zod';
import { zDataIso } from './schemaComune.ts';

export const schemaCreaDisciplina = z.object({
  codice: z.string().min(1),
  denominazione: z.string().min(1),
});
export type CreaDisciplinaRequest = z.infer<typeof schemaCreaDisciplina>;

export const schemaAggiornaDisciplina = z.object({
  denominazione: z.string().min(1),
});
export type AggiornaDisciplinaRequest = z.infer<typeof schemaAggiornaDisciplina>;

export const schemaCreaIstituzione = z.object({
  denominazione: z.string().min(1),
  codiceMeccanografico: z.string().min(1).optional(),
  indirizzo: z.string().min(1).optional(),
});
export type CreaIstituzioneRequest = z.infer<typeof schemaCreaIstituzione>;

export const schemaAggiornaIstituzione = schemaCreaIstituzione;
export type AggiornaIstituzioneRequest = z.infer<typeof schemaAggiornaIstituzione>;

export const schemaCreaImpianto = z.object({
  denominazione: z.string().min(1),
  istituzioneScolasticaId: z.string().uuid().optional(),
  indirizzo: z.string().min(1).optional(),
});
export type CreaImpiantoRequest = z.infer<typeof schemaCreaImpianto>;

export const schemaAggiornaImpianto = schemaCreaImpianto;
export type AggiornaImpiantoRequest = z.infer<typeof schemaAggiornaImpianto>;

export const schemaQueryListaImpianti = z.object({
  istituzioneScolasticaId: z.string().uuid().optional(),
});

export const schemaCreaSpazio = z.object({
  impiantoId: z.string().uuid(),
  denominazione: z.string().min(1),
  omologazioni: z.array(z.string().min(1)).optional(),
  note: z.string().min(1).optional(),
  disciplineCompatibili: z.array(z.string().min(1)).optional(),
});
export type CreaSpazioRequest = z.infer<typeof schemaCreaSpazio>;

export const schemaAggiornaSpazio = z.object({
  denominazione: z.string().min(1),
  omologazioni: z.array(z.string().min(1)).optional(),
  note: z.string().min(1).optional(),
  disciplineCompatibili: z.array(z.string().min(1)).optional(),
});
export type AggiornaSpazioRequest = z.infer<typeof schemaAggiornaSpazio>;

const REGEX_ORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

// Rispecchia il CHECK slot_orario_valido (orario_fine > orario_inizio) del DB: catturato
// qui con zod (400) invece di farlo emergere come 23514/500 dal driver Postgres. Il
// confronto stringa funziona perché il formato è HH:MM validato dal regex sopra, che
// ordina lessicograficamente come l'orario.
export const schemaCreaSlot = z
  .object({
    spazioId: z.string().uuid(),
    giornoSettimana: z.number().int().min(1).max(7),
    orarioInizio: z.string().regex(REGEX_ORARIO),
    orarioFine: z.string().regex(REGEX_ORARIO),
    pregiata: z.boolean().optional(),
    indisponibilePermanente: z.boolean().optional(),
    note: z.string().min(1).optional(),
  })
  .refine((d) => d.orarioInizio < d.orarioFine, {
    message: 'orarioInizio deve precedere orarioFine',
    path: ['orarioFine'],
  });
export type CreaSlotRequest = z.infer<typeof schemaCreaSlot>;

export const schemaAggiornaSlot = z
  .object({
    giornoSettimana: z.number().int().min(1).max(7),
    orarioInizio: z.string().regex(REGEX_ORARIO),
    orarioFine: z.string().regex(REGEX_ORARIO),
    pregiata: z.boolean(),
    indisponibilePermanente: z.boolean(),
    note: z.string().min(1).optional(),
  })
  .refine((d) => d.orarioInizio < d.orarioFine, {
    message: 'orarioInizio deve precedere orarioFine',
    path: ['orarioFine'],
  });
export type AggiornaSlotRequest = z.infer<typeof schemaAggiornaSlot>;

export const schemaQueryListaSlot = z.object({
  spazioId: z.string().uuid().optional(),
});

// Rispecchia il CHECK stagioni_date_valide (data_fine > data_inizio) del DB — stesso
// motivo del refine sugli slot sopra: 400 da zod invece di 23514/500 da Postgres. Le
// stringhe ISO YYYY-MM-DD ordinano correttamente come le date che rappresentano.
export const schemaCreaStagione = z
  .object({
    nome: z.string().min(1),
    dataInizio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dataFine: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((d) => d.dataInizio < d.dataFine, {
    message: 'dataInizio deve precedere dataFine',
    path: ['dataFine'],
  });
export type CreaStagioneRequest = z.infer<typeof schemaCreaStagione>;

export const schemaRespingiDelega = z.object({
  motivazione: z.string().min(1),
});
export type RespingiDelegaRequest = z.infer<typeof schemaRespingiDelega>;

export const schemaQueryListaDeleghe = z.object({
  stato: z.enum(['in_attesa', 'approvata', 'respinta', 'revocata']).optional(),
  stagioneId: z.string().uuid().optional(),
});

// clientSecret opzionale: merge-on-omit gestito da scriviConfigOidc (Task 1) — un PUT
// senza clientSecret preserva quello già salvato, tranne al primo salvataggio in assoluto
// (ErroreClientSecretMancante, mappato a 400 dalla route).
// issuer: normalizzato senza trailing slash — CLAUDE.md documenta che l'issuer del
// pa-sso-proxy va usato "senza /OIDC in fondo"; discovery.ts costruisce l'URL come
// `${issuer}/.well-known/openid-configuration`, un trailing slash produrrebbe un
// doppio slash e un fallimento di discovery confuso da debuggare. Non si restringe
// il protocollo a `https`: in ambiente di sviluppo/test l'issuer mock gira su http,
// e z.string().url() già esclude schemi palesemente non-URL (spazi, assenza di `://`).
export const schemaCreaUtenteBackoffice = z.object({
  email: z.string().email(),
  nome: z.string().min(1),
  cognome: z.string().min(1),
  ruolo: z.enum(['admin', 'operatore']),
});
export type CreaUtenteBackofficeRequest = z.infer<typeof schemaCreaUtenteBackoffice>;

export const schemaAggiornaUtenteBackoffice = z.object({
  nome: z.string().min(1),
  cognome: z.string().min(1),
  ruolo: z.enum(['admin', 'operatore']),
});
export type AggiornaUtenteBackofficeRequest = z.infer<typeof schemaAggiornaUtenteBackoffice>;

export const schemaCambiaStatoUtenteBackoffice = z.object({
  stato: z.enum(['attivo', 'disattivato']),
});
export type CambiaStatoUtenteBackofficeRequest = z.infer<typeof schemaCambiaStatoUtenteBackoffice>;

export const schemaImpostazioniOidc = z.object({
  issuer: z
    .string()
    .url()
    .transform((s) => s.replace(/\/+$/, '')),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  clientSecret: z.string().min(1).optional(),
});
export type ImpostazioniOidcRequest = z.infer<typeof schemaImpostazioniOidc>;

// NUMERIC(6,3): max 3 cifre intere, max 3 decimali (6 cifre totali). Usata per i campi che
// NON sono rapporti 0..1 (quelli hanno REGEX_RAPPORTO_01 sotto, già entro il limite) e la
// cui colonna DB è NUMERIC(6,3) — vedi db/migrations/000001_init.up.sql: pesoFasciaPregiata,
// caaNeutro, csdNeutro, e i campi di schemaCsdScaglione. Finding 4b: prima di questo fix
// accettava lunghezze arbitrarie (es. '99999999'), che Postgres rifiuta con 22003
// (numeric_field_overflow) — mappato a 400 in erroriDominio.ts come difesa di secondo
// livello, ma il vincolo va comunque applicato qui per rifiutare prima di toccare il DB.
const REGEX_DECIMALE_PARAMETRICO = /^\d{1,3}(\.\d{1,3})?$/;

// moltiplicatoreMinutiPerPunto e minutiSettimanaliMax sono NUMERIC(10,3) in DB (non
// NUMERIC(6,3) come gli altri campi decimali sopra — verificato in
// db/migrations/000001_init.up.sql, righe moltiplicatore_minuti_per_punto/
// minuti_settimanali_max), quindi ammettono fino a 7 cifre intere. Usare la regex a 3
// cifre anche qui avrebbe rifiutato valori legittimi entro la precisione reale della
// colonna — il vincolo di formato deve rispecchiare lo schema DB effettivo, non
// un'assunzione uniforme su tutti i campi NUMERIC.
const REGEX_DECIMALE_PARAMETRICO_ESTESO = /^\d{1,7}(\.\d{1,3})?$/;

// Rapporti/percentuali in forma decimale (0.0000-1.0000, NUMERIC(6,4)): '0.5%' si scrive
// '0.0050', non '0.5' o '50'. Finding 2: la regex generica precedente accettava fino a
// 99.9999, un admin che intende "20%" scrivendo '20.0000' pubblicava un valore che rompe
// il round-robin per l'intera stagione (target quota irraggiungibile). Accetta '0', '0.xxxx'
// (1-4 decimali), '1', '1.0000' (1-4 decimali) — mai sopra 1.
const REGEX_RAPPORTO_01 = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/;

export const schemaCsdScaglione = z
  .object({
    rapportoFdFrMin: z.string().regex(REGEX_DECIMALE_PARAMETRICO),
    rapportoFdFrMax: z.string().regex(REGEX_DECIMALE_PARAMETRICO).nullable(),
    coefficiente: z.string().regex(REGEX_DECIMALE_PARAMETRICO),
  })
  .refine((s) => s.rapportoFdFrMax === null || Number(s.rapportoFdFrMax) > Number(s.rapportoFdFrMin), {
    message: 'rapportoFdFrMax deve essere maggiore di rapportoFdFrMin',
    path: ['rapportoFdFrMax'],
  });

export const schemaCreaVersioneParametrico = z
  .object({
    note: z.string().min(1).optional(),
    moltiplicatoreMinutiPerPunto: z.string().regex(REGEX_DECIMALE_PARAMETRICO_ESTESO),
    pesoFasciaPregiata: z.string().regex(REGEX_DECIMALE_PARAMETRICO),
    minutiSettimanaliMax: z.string().regex(REGEX_DECIMALE_PARAMETRICO_ESTESO),
    slotMaxStessoImpianto: z.number().int().nonnegative(),
    fascePregiateMax: z.number().int().nonnegative(),
    giornateGaraMax: z.number().int().nonnegative(),
    incrementoSquadreNeutro: z.number().int().nonnegative(),
    // Coefficienti neutri: mai zero per definizione (moltiplicano altri valori nel calcolo,
    // uno zero azzererebbe qualunque grandezza che li usa). Regex sopra già impone il
    // formato NUMERIC(6,3); il vincolo "> 0" è un requisito semantico distinto (non di
    // formato), per questo espresso come .refine() separato invece di complicare la regex
    // con un negative-lookahead — più leggibile e il messaggio d'errore è più chiaro.
    caaNeutro: z.string().regex(REGEX_DECIMALE_PARAMETRICO).refine((v) => Number(v) > 0, {
      message: 'caaNeutro deve essere maggiore di zero',
    }),
    csdNeutro: z.string().regex(REGEX_DECIMALE_PARAMETRICO).refine((v) => Number(v) > 0, {
      message: 'csdNeutro deve essere maggiore di zero',
    }),
    tolleranzaIsfPct: z.string().regex(REGEX_RAPPORTO_01),
    sogliaMancatiUtilizziDiffida: z.number().int().nonnegative(),
    sogliaMancatiUtilizziDecadenza: z.number().int().nonnegative(),
    sogliaScostamentoDichiaratoPct: z.string().regex(REGEX_RAPPORTO_01),
    sogliaIsfCompensazione: z.string().regex(REGEX_RAPPORTO_01),
    // Finding 1: floor di 1 giorno minimo — art. B.39 richiede comunque una retention
    // minima, mai zero. Zero cancellava l'intero audit log al giro successivo dello
    // scheduler di housekeeping (il predicato diventa sempre vero).
    retentionLogOperazioniGiorni: z.number().int().min(1),
    quotaNuoveAssociazioniPct: z.string().regex(REGEX_RAPPORTO_01),
    // 🔺 placeholder, default 7gg — nessun valore fisso nella norma (analogo al "termine
    // indicato nell'avviso" di B.11), editabile dall'admin come ogni altro parametro.
    termineGiustificazioneGiorni: z.number().int().min(1),
    csdScaglioni: z.array(schemaCsdScaglione),
  })
  // Finding 2 (parte 2): la diffida deve arrivare prima della decadenza, non dopo/uguale.
  .refine((d) => d.sogliaMancatiUtilizziDiffida < d.sogliaMancatiUtilizziDecadenza, {
    message: 'sogliaMancatiUtilizziDiffida deve essere minore di sogliaMancatiUtilizziDecadenza',
    path: ['sogliaMancatiUtilizziDecadenza'],
  })
  // Finding 3: csdScaglioni deve coprire l'intero dominio [0, +inf) senza buchi né
  // sovrapposizioni. Il motore Go (calc/csd.go::LookupCSD) fallisce esplicitamente se
  // nessuno scaglione copre un rapporto FD/FR richiesto (array vuoto/con buchi), e prende
  // silenziosamente il primo match per ordine se gli scaglioni si sovrappongono (il
  // secondo scaglione coprente diventa codice morto, nessun errore visibile). L'array in
  // input dal client potrebbe non arrivare ordinato: si ordina una copia locale per
  // rapportoFdFrMin numerico prima di applicare i controlli, senza assumere l'ordine del
  // body.
  .superRefine((d, ctx) => {
    const scaglioni = [...d.csdScaglioni].sort((a, b) => Number(a.rapportoFdFrMin) - Number(b.rapportoFdFrMin));
    if (scaglioni.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'csdScaglioni non può essere vuoto: nessuno scaglione copre alcun rapporto FD/FR',
        path: ['csdScaglioni'],
      });
      return;
    }
    const primo = scaglioni[0]!;
    if (Number(primo.rapportoFdFrMin) !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'il primo scaglione di csdScaglioni deve avere rapportoFdFrMin = 0 (copertura deve iniziare da zero)',
        path: ['csdScaglioni'],
      });
    }
    for (let i = 1; i < scaglioni.length; i++) {
      const precedente = scaglioni[i - 1]!;
      const corrente = scaglioni[i]!;
      const maxPrecedente = precedente.rapportoFdFrMax === null ? null : Number(precedente.rapportoFdFrMax);
      if (maxPrecedente === null || maxPrecedente !== Number(corrente.rapportoFdFrMin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `csdScaglioni ha un buco o una sovrapposizione tra gli scaglioni con rapportoFdFrMin=${precedente.rapportoFdFrMin} e rapportoFdFrMin=${corrente.rapportoFdFrMin}: il rapportoFdFrMax del primo deve coincidere col rapportoFdFrMin del secondo`,
          path: ['csdScaglioni'],
        });
      }
    }
    const ultimo = scaglioni[scaglioni.length - 1]!;
    if (ultimo.rapportoFdFrMax !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "l'ultimo scaglione di csdScaglioni deve avere rapportoFdFrMax = null (copertura fino a infinito)",
        path: ['csdScaglioni'],
      });
    }
  });
export type CreaVersioneParametricoRequest = z.infer<typeof schemaCreaVersioneParametrico>;

export const schemaCreaIndisponibilita = z
  .object({
    dal: zDataIso,
    al: zDataIso,
    motivo: z.string().min(1),
    comunicataDa: z.enum(['istituzione_scolastica', 'ente']),
    slotRecuperoId: z.string().uuid().optional(),
  })
  .refine((d) => d.al >= d.dal, { message: 'al deve essere >= dal', path: ['al'] });
export type CreaIndisponibilitaRequest = z.infer<typeof schemaCreaIndisponibilita>;

// Filtri della coda backoffice delle variazioni: validati con zod come ogni altro input
// HTTP, non castati con `as` (M3 final review — un filtro invalido ritornava silenziosamente
// una lista vuota invece di 400).
export const schemaFiltriVariazioni = z.object({
  tipo: z.enum(['liberazione', 'recupero', 'scambio_temporaneo', 'utilizzo_occasionale']).optional(),
  stato: z.enum(['in_attesa_accettazione', 'accettata', 'rifiutata', 'annullata']).optional(),
});

export const schemaRegistraUtilizzo = z.object({
  data: zDataIso,
  esito: z.enum(['utilizzato', 'non_utilizzato_giustificato', 'non_utilizzato_non_giustificato', 'indisponibilita_impianto']),
  note: z.string().min(1).optional(),
});
export type RegistraUtilizzoRequest = z.infer<typeof schemaRegistraUtilizzo>;

export const schemaRigettaGiustificazione = z.object({
  motivazione: z.string().min(1),
});
export type RigettaGiustificazioneRequest = z.infer<typeof schemaRigettaGiustificazione>;

export const schemaCreaProvvedimento = z.object({
  tipo: z.enum(['diffida', 'decadenza']),
  motivazione: z.string().min(1),
});
export type CreaProvvedimentoRequest = z.infer<typeof schemaCreaProvvedimento>;
