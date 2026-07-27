import { z } from 'zod';

export const schemaCreaDisciplina = z.object({
  codice: z.string().min(1),
  denominazione: z.string().min(1),
});
export type CreaDisciplinaRequest = z.infer<typeof schemaCreaDisciplina>;

export const schemaAggiornaDisciplina = z.object({
  denominazione: z.string().min(1),
});
export type AggiornaDisciplinaRequest = z.infer<typeof schemaAggiornaDisciplina>;
