import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generaPkce } from './pkce.ts';

test('generaPkce: coppie diverse ad ogni chiamata', () => {
  const a = generaPkce();
  const b = generaPkce();
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.codeVerifier, b.codeVerifier);
});

test('generaPkce: code_challenge = SHA256(code_verifier) base64url (RFC 7636 S256)', () => {
  const { codeVerifier, codeChallenge } = generaPkce();
  const atteso = createHash('sha256').update(codeVerifier).digest('base64url');
  assert.equal(codeChallenge, atteso);
});
