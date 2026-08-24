import jsonwebtoken from 'jsonwebtoken';
import jwksRsa, { type JwksClient } from 'jwks-rsa';

// Un client JWKS per URI, riusato tra le chiamate (cache/rate-limit interni di jwks-rsa
// hanno senso solo se il client persiste — un client nuovo ad ogni verifica li vanifica).
const clientPerJwksUri = new Map<string, JwksClient>();

function ottieniClient(jwksUri: string): JwksClient {
  let client = clientPerJwksUri.get(jwksUri);
  if (!client) {
    client = jwksRsa({ jwksUri, cache: true, rateLimit: true, jwksRequestsPerMinute: 10 });
    clientPerJwksUri.set(jwksUri, client);
  }
  return client;
}

// L'id_token è emesso dal proxy OIDC (pa-sso-proxy), MAI dal nostro backend: si verifica
// sempre con le chiavi pubbliche del proxy (JWKS), mai con un secret nostro.
export function verificaIdToken(
  idToken: string,
  jwksUri: string,
  issuerAtteso: string,
  audienceAtteso: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const decodificato = jsonwebtoken.decode(idToken, { complete: true });
    if (!decodificato || typeof decodificato.payload === 'string') {
      reject(new Error('id_token non decodificabile'));
      return;
    }
    // kid assente: legittimo se il JWKS pubblica una sola chiave (comportamento
    // reale osservato contro pa-sso-proxy in produzione, 2026-08-24 — non un
    // caso teorico). jwks-rsa gestisce già questo caso in getSigningKey():
    // con kid undefined/null usa l'unica chiave se ce n'è una, altrimenti
    // rifiuta con SigningKeyNotFoundError se il JWKS ne pubblica più di una
    // (a quel punto servirebbe davvero il kid per scegliere, giustamente
    // non indoviniamo). Non serve replicare quella logica qui.
    const kid = decodificato.header.kid ?? undefined;

    ottieniClient(jwksUri).getSigningKey(kid, (err, key) => {
      if (err || !key) {
        reject(err ?? new Error('chiave di firma JWKS non trovata per il kid del token'));
        return;
      }

      jsonwebtoken.verify(
        idToken,
        key.getPublicKey(),
        { algorithms: ['RS256'], issuer: issuerAtteso, audience: audienceAtteso },
        (errVerifica, payload) => {
          if (errVerifica || !payload || typeof payload === 'string') {
            reject(errVerifica ?? new Error('payload id_token non valido'));
            return;
          }
          resolve(payload as Record<string, unknown>);
        },
      );
    });
  });
}
