import { z } from 'zod';

export const schemaCreaAssociazione = z.object({
  denominazione: z.string().min(1),
  codiceFiscalePartitaIva: z.string().min(11).max(16),
  rnaNumeroIscrizione: z.string().min(1).optional(),
  dataCostituzione: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  stagioneId: z.string().uuid(),
});
export type CreaAssociazioneRequest = z.infer<typeof schemaCreaAssociazione>;

export const schemaCaricaDocumento = z.object({
  tipo: z.enum(['statuto', 'atto_costitutivo', 'altro']),
});

export const schemaCreaDelega = z.object({
  codiceFiscale: z.string().min(11).max(16),
  nome: z.string().min(1),
  cognome: z.string().min(1),
  associazioneId: z.string().uuid(),
  stagioneId: z.string().uuid(),
  ruolo: z.enum(['rappresentante', 'operatore']),
});
export type CreaDelegaRequest = z.infer<typeof schemaCreaDelega>;

const REGEX_MINUTI = /^\d{1,7}(\.\d{1,3})?$/; // coerente con NUMERIC(10,3) di domande.fabbisogno_*_minuti

export const schemaRichiestaGiornataGara = z.object({
  federazione: z.string().min(1),
  campionato: z.string().min(1),
  categoria: z.string().min(1),
  requisitiTecnici: z.string().min(1).optional(),
  necessitaImpiantoOmologato: z.boolean().default(true),
});

export const schemaCreaDomanda = z
  .object({
    associazioneId: z.string().uuid(),
    stagioneId: z.string().uuid(),
    disciplineCodici: z.array(z.string().min(1)).min(1),
    classeAttivitaCodice: z.string().min(1).optional(),
    livelloCampionato: z.enum(['provinciale', 'regionale', 'interregionale', 'nazionale']).optional(),
    numeroTesserati: z.number().int().min(0).default(0),
    numeroAtletiPartecipanti: z.number().int().min(0).default(0),
    numeroSquadre: z.number().int().min(0).default(0),
    numeroSquadreFederaliStagionePrecedente: z.number().int().min(0).default(0),
    attivitaGiovanile: z.boolean().default(false),
    attivitaAgonistica: z.boolean().default(false),
    attivitaParalimpicaInclusiva: z.boolean().default(false),
    fabbisognoMinimoMinuti: z.string().regex(REGEX_MINUTI),
    fabbisognoOttimaleMinuti: z.string().regex(REGEX_MINUTI),
    preferenze: z.array(z.string().uuid()).min(1),
    blocchiAllenamento: z.array(z.array(z.string().uuid()).min(2)).default([]),
    richiedeGiornataGara: z.boolean().default(false),
    richiesteGiornataGara: z.array(schemaRichiestaGiornataGara).default([]),
  })
  .refine((d) => Number(d.fabbisognoOttimaleMinuti) >= Number(d.fabbisognoMinimoMinuti), {
    message: 'fabbisognoOttimaleMinuti deve essere >= fabbisognoMinimoMinuti',
    path: ['fabbisognoOttimaleMinuti'],
  })
  .refine((d) => new Set(d.preferenze).size === d.preferenze.length, {
    message: 'preferenze contiene slotId duplicati',
    path: ['preferenze'],
  })
  .refine((d) => d.blocchiAllenamento.every((blocco) => new Set(blocco).size === blocco.length), {
    message: 'un blocco allenamento contiene slotId duplicati',
    path: ['blocchiAllenamento'],
  })
  .refine(
    (d) => d.blocchiAllenamento.every((blocco) => blocco.every((slotId) => d.preferenze.includes(slotId))),
    { message: 'ogni fascia di un blocco allenamento deve comparire anche tra le preferenze', path: ['blocchiAllenamento'] },
  )
  .refine((d) => !d.richiedeGiornataGara || d.richiesteGiornataGara.length > 0, {
    message: 'richiesteGiornataGara non può essere vuoto se richiedeGiornataGara è true',
    path: ['richiesteGiornataGara'],
  })
  .refine((d) => d.richiedeGiornataGara || d.richiesteGiornataGara.length === 0, {
    message: 'richiesteGiornataGara deve essere vuoto se richiedeGiornataGara è false',
    path: ['richiesteGiornataGara'],
  });
export type CreaDomandaRequest = z.infer<typeof schemaCreaDomanda>;

export const schemaCreaOsservazione = z.object({
  testo: z.string().min(1),
});
export type CreaOsservazioneRequest = z.infer<typeof schemaCreaOsservazione>;
