import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { avviaLoginOidc, scambiaCallbackOidc } from './auth.ts';
import { rimuoviTokens } from './client.ts';

describe('auth.ts', () => {
  let originalLocation: Location;

  beforeEach(() => {
    rimuoviTokens();
    originalLocation = window.location;
  });

  afterEach(() => {
    // @ts-expect-error -- restore original location
    window.location = originalLocation;
  });

  it('avviaLoginOidc reindirizza a /auth/oidc/start', () => {
    // @ts-expect-error -- mock window.location per il test
    delete window.location;
    // @ts-expect-error -- assign mock location
    window.location = { href: '' };

    avviaLoginOidc();

    expect(window.location.href).toContain('/auth/oidc/start');
  });

  it('scambiaCallbackOidc su risposta non-ok propaga il messaggio di errore del backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errore: 'sessione di login scaduta o non valida, riprovare' }), { status: 401 }),
    );

    await expect(scambiaCallbackOidc('code-test', 'state-test')).rejects.toThrow(
      'sessione di login scaduta o non valida, riprovare',
    );
  });
});
