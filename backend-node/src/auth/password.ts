import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Parametri scrypt incorporati nell'hash (formato self-describing): se in futuro si
// alzano N/r/p per hardware più veloce, gli hash vecchi restano verificabili con i
// PROPRI parametri originali invece di rompersi silenziosamente.
const N = 32768; // 2^15
const R = 8;
const P = 1;
const KEY_LEN = 64;
// 128*N*r deve stare sotto maxmem: col default di Node (32 MiB) N=32768,r=8 tocca
// esattamente il limite e fallisce — maxmem esplicito con margine.
const MAXMEM = 64 * 1024 * 1024;

function derivaChiave(password: string, salt: Buffer, keyLen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, { N: n, r, p, maxmem: MAXMEM }, (err, chiave) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(chiave);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivata = await derivaChiave(password, salt, KEY_LEN, N, R, P);
  return `scrypt:${N}:${R}:${P}:${salt.toString('hex')}:${derivata.toString('hex')}`;
}

export async function verificaPassword(password: string, hash: string): Promise<boolean> {
  const parti = hash.split(':');
  if (parti.length !== 6 || parti[0] !== 'scrypt') {
    return false;
  }
  const [, nTxt, rTxt, pTxt, saltHex, derivataHex] = parti as [string, string, string, string, string, string];
  const salt = Buffer.from(saltHex, 'hex');
  const derivataAttesa = Buffer.from(derivataHex, 'hex');

  const derivataCalcolata = await derivaChiave(password, salt, derivataAttesa.length, Number(nTxt), Number(rTxt), Number(pTxt));

  return derivataCalcolata.length === derivataAttesa.length && timingSafeEqual(derivataCalcolata, derivataAttesa);
}
