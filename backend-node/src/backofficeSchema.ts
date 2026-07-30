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
