import jsonwebtoken from 'jsonwebtoken';

export interface PayloadAccessTokenPubblico {
  sub: string; // persona_fisica.id
  codiceFiscale: string;
  nome: string;
  cognome: string;
}

const ALGORITMO = 'HS256' as const;
const DURATA_ACCESS_TOKEN = '15m';
// Stesso JWT_SECRET del backoffice (jwt.ts): l'audience distingue i due tipi di token,
// vedi commento in jwt.ts.
const AUDIENCE = 'pubblico' as const;

function segreto(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    throw new Error('JWT_SECRET non impostata');
  }
  return s;
}

export function generaAccessTokenPubblico(payload: PayloadAccessTokenPubblico): string {
  return jsonwebtoken.sign(payload, segreto(), {
    algorithm: ALGORITMO,
    expiresIn: DURATA_ACCESS_TOKEN,
    audience: AUDIENCE,
  });
}

export function verificaAccessTokenPubblico(token: string): PayloadAccessTokenPubblico {
  const decodificato = jsonwebtoken.verify(token, segreto(), { algorithms: [ALGORITMO], audience: AUDIENCE });

  if (typeof decodificato === 'string') {
    throw new Error('payload del token inatteso (stringa)');
  }

  const { sub, codiceFiscale, nome, cognome } = decodificato;
  if (typeof sub !== 'string' || typeof codiceFiscale !== 'string' || typeof nome !== 'string' || typeof cognome !== 'string') {
    throw new Error('payload del token non valido');
  }

  return { sub, codiceFiscale, nome, cognome };
}
