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
