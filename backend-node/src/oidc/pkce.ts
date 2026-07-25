import { createHash, randomBytes } from 'node:crypto';

export interface CoppiaPkce {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function generaPkce(): CoppiaPkce {
  const state = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { state, codeVerifier, codeChallenge };
}
