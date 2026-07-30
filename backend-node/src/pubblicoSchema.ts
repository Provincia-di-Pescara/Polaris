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
