import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { scopriEndpoint } from './discovery.ts';

interface ServerMock {
  server: Server;
  issuer: string;
  numeroChiamate: () => number;
}

async function avviaServerMock(): Promise<ServerMock> {
  let chiamate = 0;
  let issuer = '';

  const server = createServer((req, res) => {
    chiamate++;
    if (req.url === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/OIDC/authorization`,
          token_endpoint: `${issuer}/OIDC/token`,
          jwks_uri: `${issuer}/OIDC/jwks`,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('indirizzo server mock non disponibile');
  }
  issuer = `http://127.0.0.1:${address.port}`;

  return { server, issuer, numeroChiamate: () => chiamate };
}

test('scopriEndpoint legge authorization/token/jwks endpoint dal documento di discovery', async () => {
  const mock = await avviaServerMock();
  try {
    const endpoint = await scopriEndpoint(mock.issuer);
    assert.equal(endpoint.authorizationEndpoint, `${mock.issuer}/OIDC/authorization`);
    assert.equal(endpoint.tokenEndpoint, `${mock.issuer}/OIDC/token`);
    assert.equal(endpoint.jwksUri, `${mock.issuer}/OIDC/jwks`);
  } finally {
    mock.server.close();
  }
});

test('scopriEndpoint usa la cache: una seconda chiamata non ricontatta il server', async () => {
  const mock = await avviaServerMock();
  try {
    await scopriEndpoint(mock.issuer);
    await scopriEndpoint(mock.issuer);
    assert.equal(mock.numeroChiamate(), 1);
  } finally {
    mock.server.close();
  }
});

test('scopriEndpoint propaga errore se il documento di discovery non è raggiungibile', async () => {
  await assert.rejects(() => scopriEndpoint('http://127.0.0.1:1')); // porta non in ascolto
});
