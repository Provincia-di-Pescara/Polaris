import { z } from 'zod';

export const schemaCreaAssociazione = z.object({
  denominazione: z.string().min(1),
  codiceFiscalePartitaIva: z.string().min(11).max(16),
  rnaNumeroIscrizione: z.string().min(1).optional(),
  dataCostituzione: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  stagioneId: z.string().uuid(),
});
export type CreaAssociazioneRequest = z.infer<typeof schemaCreaAssociazione>;
