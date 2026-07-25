export interface EndpointOidc {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

interface VoceCache {
  endpoint: EndpointOidc;
  scadeIl: number;
}

const DURATA_CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, VoceCache>();

interface DocumentoDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export async function scopriEndpoint(issuer: string): Promise<EndpointOidc> {
  const voceCache = cache.get(issuer);
  if (voceCache && voceCache.scadeIl > Date.now()) {
    return voceCache.endpoint;
  }

  const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`discovery OIDC fallita: HTTP ${res.status}`);
  }
  const documento = (await res.json()) as DocumentoDiscovery;

  const endpoint: EndpointOidc = {
    authorizationEndpoint: documento.authorization_endpoint,
    tokenEndpoint: documento.token_endpoint,
    jwksUri: documento.jwks_uri,
  };
  cache.set(issuer, { endpoint, scadeIl: Date.now() + DURATA_CACHE_MS });
  return endpoint;
}
