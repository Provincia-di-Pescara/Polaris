import { z } from 'zod';

// Una data ISO va validata sia nella forma sia nell'esistenza: il solo regex accetta
// '2030-13-45', che arriva fino a Postgres e torna come 22008 (datetime_field_overflow),
// codice non mappato da comeErroreRiferimentoNonValido → 500 grezzo al client
// (I7 final review). Date.parse su una stringa ISO completa è specificato per rifiutare i
// componenti fuori range, quindi NaN ⟺ data inesistente.
export function dataIsoValida(valore: string): boolean {
  return !Number.isNaN(Date.parse(`${valore}T00:00:00Z`));
}

export const zDataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'formato data atteso YYYY-MM-DD')
  .refine(dataIsoValida, { message: 'data inesistente nel calendario' });
