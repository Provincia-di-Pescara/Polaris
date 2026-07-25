import { randomBytes, createHash } from 'node:crypto';

// Ad alta entropia (generato casualmente, non scelto da una persona): a differenza
// delle password non serve un KDF lento come scrypt, un digest è sufficiente e molto
// più veloce da verificare ad ogni refresh.
export function generaRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
