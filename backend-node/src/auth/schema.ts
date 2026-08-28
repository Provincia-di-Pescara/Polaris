import { z } from 'zod';

export const schemaLoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof schemaLoginRequest>;

export const schemaRefreshRequest = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof schemaRefreshRequest>;

export const schemaOidcCallback = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type OidcCallbackRequest = z.infer<typeof schemaOidcCallback>;

export const schemaBootstrapPrimoAdmin = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  nome: z.string().min(1),
  cognome: z.string().min(1),
});
export type BootstrapPrimoAdminRequest = z.infer<typeof schemaBootstrapPrimoAdmin>;

export const schemaBootstrapVerifica = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BootstrapVerificaRequest = z.infer<typeof schemaBootstrapVerifica>;

export const schemaAccettaInvitoUtente = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(12),
});
export type AccettaInvitoUtenteRequest = z.infer<typeof schemaAccettaInvitoUtente>;

export const schemaPasswordDimenticata = z.object({
  email: z.string().email(),
});
export type PasswordDimenticataRequest = z.infer<typeof schemaPasswordDimenticata>;
