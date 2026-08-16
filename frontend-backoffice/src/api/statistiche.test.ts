import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { leggiStatisticheStagione, ErroreRichiestaApi } from './statistiche';
import { impostaTokens, rimuoviTokens } from './client';

describe('leggiStatisticheStagione', () => {
  beforeEach(() => {
    impostaTokens('access-test', 'refresh-test');
  });
  afterEach(() => {
    rimuoviTokens();
    vi.restoreAllMocks();
  });

  it('chiama il path corretto ed effettua il parse della risposta', async () => {
    const corpo = {
      tassoUtilizzoImpiantiPct: '0.667',
      fascePregiateAssegnatePct: '0.500',
      isfMedioAssociazioni: '0.600',
      sociAtletiCoinvolti: 19,
      distribuzioneMinutiPerDisciplina: [],
      saturazionePerImpianto: [],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const risultato = await leggiStatisticheStagione('stagione-123');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/backoffice/stagioni/stagione-123/statistiche'),
      expect.anything(),
    );
    expect(risultato).toEqual(corpo);
  });

  it('lancia ErroreRichiestaApi con il messaggio del backend su risposta non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errore: 'stagione non trovata' }), { status: 404, headers: { 'content-type': 'application/json' } }),
    );

    await expect(leggiStatisticheStagione('inesistente')).rejects.toThrow(ErroreRichiestaApi);
  });
});
