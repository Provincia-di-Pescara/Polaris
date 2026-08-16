import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as authApi from '../api/auth.ts';
import { OidcCallbackView } from './OidcCallbackView.tsx';

function conQueryString(qs: string, ui: React.ReactElement): ReturnType<typeof render> {
  window.history.pushState({}, '', `/oidc/callback${qs}`);
  return render(ui);
}

describe('OidcCallbackView', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('scambia code+state e chiama onCompletato', async () => {
    const scambia = vi.spyOn(authApi, 'scambiaCallbackOidc').mockResolvedValue(undefined);
    const onCompletato = vi.fn();

    conQueryString('?code=abc&state=xyz', <OidcCallbackView onCompletato={onCompletato} />);

    await vi.waitFor(() => expect(onCompletato).toHaveBeenCalled());
    expect(scambia).toHaveBeenCalledWith('abc', 'xyz');
  });

  it('error dal provider: mostra il messaggio, non chiama scambiaCallbackOidc', async () => {
    const scambia = vi.spyOn(authApi, 'scambiaCallbackOidc');

    conQueryString('?error=access_denied', <OidcCallbackView onCompletato={vi.fn()} />);

    expect(await screen.findByText(/accesso negato dal provider: access_denied/i)).toBeInTheDocument();
    expect(scambia).not.toHaveBeenCalled();
  });

  it('scambio fallito: mostra il messaggio di errore del backend', async () => {
    vi.spyOn(authApi, 'scambiaCallbackOidc').mockRejectedValue(new Error('sessione di login scaduta o non valida, riprovare'));

    conQueryString('?code=abc&state=xyz', <OidcCallbackView onCompletato={vi.fn()} />);

    expect(await screen.findByText(/sessione di login scaduta/i)).toBeInTheDocument();
  });
});
