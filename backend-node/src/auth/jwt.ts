import jsonwebtoken from 'jsonwebtoken';

export interface PayloadAccessToken {
  sub: string;
  email: string;
  ruolo: 'admin' | 'operatore';
}

// Pinnato esplicitamente sia in firma che in verifica: mai fidarsi dell'algoritmo
// dichiarato nell'header del token (previene l'attacco di algorithm confusion, es. alg=none).
const ALGORITMO = 'HS256' as const;
const DURATA_ACCESS_TOKEN = '15m';

function segreto(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    throw new Error('JWT_SECRET non impostata');
  }
  return s;
}

export function generaAccessToken(payload: PayloadAccessToken): string {
  return jsonwebtoken.sign(payload, segreto(), { algorithm: ALGORITMO, expiresIn: DURATA_ACCESS_TOKEN });
}

export function verificaAccessToken(token: string): PayloadAccessToken {
  const decodificato = jsonwebtoken.verify(token, segreto(), { algorithms: [ALGORITMO] });

  if (typeof decodificato === 'string') {
    throw new Error('payload del token inatteso (stringa)');
  }

  const { sub, email, ruolo } = decodificato;
  if (typeof sub !== 'string' || typeof email !== 'string' || (ruolo !== 'admin' && ruolo !== 'operatore')) {
    throw new Error('payload del token non valido');
  }

  return { sub, email, ruolo };
}
