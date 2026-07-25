import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto';

// Chiave di cifratura derivata da JWT_SECRET con un context label dedicato (KDF, non i
// byte grezzi del secret): separa lo scopo "firma JWT" da "cifratura at-rest", pur senza
// dover gestire un secret aggiuntivo in produzione.
const CONTEXT_LABEL = 'polaris-oidc-client-secret-v1';
const IV_LEN = 12; // GCM standard
const KEY_LEN = 32; // AES-256

function derivaChiave(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      reject(new Error('JWT_SECRET non impostata'));
      return;
    }
    scryptCallback(jwtSecret, CONTEXT_LABEL, KEY_LEN, (err, chiave) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(chiave);
    });
  });
}

// Formato: base64url(iv) + '.' + base64url(authTag) + '.' + base64url(ciphertext)
export async function cifra(testoInChiaro: string): Promise<string> {
  const chiave = await derivaChiave();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', chiave, iv);
  const cifrato = Buffer.concat([cipher.update(testoInChiaro, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${cifrato.toString('base64url')}`;
}

export async function decifra(valoreCifrato: string): Promise<string> {
  const parti = valoreCifrato.split('.');
  if (parti.length !== 3) {
    throw new Error('formato valore cifrato non valido');
  }
  const [ivB64, tagB64, cifratoB64] = parti as [string, string, string];

  const chiave = await derivaChiave();
  const decipher = createDecipheriv('aes-256-gcm', chiave, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decifrato = Buffer.concat([decipher.update(Buffer.from(cifratoB64, 'base64url')), decipher.final()]);
  return decifrato.toString('utf8');
}
