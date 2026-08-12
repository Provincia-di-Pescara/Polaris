import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import * as api from '../api/audit.ts';
import { AuditSorteggioView } from './AuditSorteggioView.tsx';

function renderConStagione(stagioneId: string) {
  const router = createMemoryRouter([
    { path: '/', element: <Outlet context={stagioneId} />, children: [{ index: true, element: <AuditSorteggioView /> }] },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('AuditSorteggioView', () => {
  it('mostra il registro log-operazioni e i sorteggi della stagione', async () => {
    vi.spyOn(api, 'listaLogOperazioni').mockResolvedValue([
      { id: 'log-1', attoreNome: 'Admin Test (admin@test.local)', attoreTipo: 'backoffice', ruolo: 'admin', azione: 'crea_versione_parametrico', entitaTipo: 'parametrico_versioni', entitaId: 'v-1', dettaglio: null, ipAddress: null, avvenutaIl: '2026-08-01T10:00:00.000Z' },
    ]);
    vi.spyOn(api, 'listaSorteggiPerStagione').mockResolvedValue([
      { id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z', vincitoreAssociazioneId: 'ass-1' },
    ]);

    renderConStagione('stag-1');

    expect(await screen.findByText(/crea_versione_parametrico/i)).toBeInTheDocument();
    expect(await screen.findByText(/B\.21/)).toBeInTheDocument();
  });

  it('verifica HMAC reale: candidato genuino mostra esito positivo', async () => {
    vi.spyOn(api, 'listaLogOperazioni').mockResolvedValue([]);
    vi.spyOn(api, 'listaSorteggiPerStagione').mockResolvedValue([
      { id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z', vincitoreAssociazioneId: 'ass-1' },
    ]);
    const hmacGenuino = await api.verificaHmac('ab', 'ass-1');
    vi.spyOn(api, 'trovaSorteggio').mockResolvedValue({
      id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z',
      vincitoreAssociazioneId: 'ass-1', algoritmo: 'hmac-sha256-rank-asc', algoritmoVersione: 'v1', hashVerbale: 'x',
      candidati: [{ associazioneId: 'ass-1', ordineCanonico: 1, hmacHex: hmacGenuino, rank: 1 }],
    });

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /B\.21/i }));
    await userEvent.click(await screen.findByRole('button', { name: /ricalcola.*verifica/i }));

    expect(await screen.findByText(/ricalcolo verificato/i)).toBeInTheDocument();
  });

  it('verifica HMAC reale: candidato manomesso mostra esito negativo', async () => {
    vi.spyOn(api, 'listaLogOperazioni').mockResolvedValue([]);
    vi.spyOn(api, 'listaSorteggiPerStagione').mockResolvedValue([
      { id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z', vincitoreAssociazioneId: 'ass-1' },
    ]);
    vi.spyOn(api, 'trovaSorteggio').mockResolvedValue({
      id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z',
      vincitoreAssociazioneId: 'ass-1', algoritmo: 'hmac-sha256-rank-asc', algoritmoVersione: 'v1', hashVerbale: 'x',
      candidati: [{ associazioneId: 'ass-1', ordineCanonico: 1, hmacHex: 'hmac-manomesso-non-corrispondente', rank: 1 }],
    });

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /B\.21/i }));
    await userEvent.click(await screen.findByRole('button', { name: /ricalcola.*verifica/i }));

    expect(await screen.findByText(/potenzialmente manomesso/i)).toBeInTheDocument();
  });

  it('rileva un verbale manomesso con rank/vincitore scambiati ma HMAC per-candidato genuini', async () => {
    // Scenario che il solo confronto "ogni HMAC corrisponde" NON rileva: ogni
    // candidato ha il proprio HMAC genuino (ricalcolabile e corretto), ma il
    // `rank`/`vincitoreAssociazioneId` dichiarati nel verbale sono scambiati
    // rispetto al vero ordinamento crescente sull'HMAC (art. B.38). Un verbale
    // manomesso in questo modo deve comunque risultare "potenzialmente manomesso".
    vi.spyOn(api, 'listaLogOperazioni').mockResolvedValue([]);
    vi.spyOn(api, 'listaSorteggiPerStagione').mockResolvedValue([
      { id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z', vincitoreAssociazioneId: 'ass-2' },
    ]);
    const hmacA = await api.verificaHmac('ab', 'ass-1');
    const hmacB = await api.verificaHmac('ab', 'ass-2');
    // Ordine hex vero: chi ha l'hex più basso è rank 1 / vincitore. Assegniamo i
    // rank INVERTITI rispetto all'ordine reale, e dichiariamo vincitore il
    // candidato col rank "1" falso — entrambi gli HMAC restano genuini.
    const [rankVeroA, rankVeroB] = hmacA < hmacB ? [1, 2] : [2, 1];
    vi.spyOn(api, 'trovaSorteggio').mockResolvedValue({
      id: 'sort-1', elaborazioneId: 'el-1', articoloRiferimento: 'B.21', contesto: 'fascia contesa', semeHex: 'ab', semeGeneratoIl: '2026-08-01T09:00:00.000Z',
      vincitoreAssociazioneId: 'ass-2', algoritmo: 'hmac-sha256-rank-asc', algoritmoVersione: 'v1', hashVerbale: 'x',
      candidati: [
        { associazioneId: 'ass-1', ordineCanonico: 1, hmacHex: hmacA, rank: rankVeroB },
        { associazioneId: 'ass-2', ordineCanonico: 2, hmacHex: hmacB, rank: rankVeroA },
      ],
    });

    renderConStagione('stag-1');
    await userEvent.click(await screen.findByRole('button', { name: /B\.21/i }));
    await userEvent.click(await screen.findByRole('button', { name: /ricalcola.*verifica/i }));

    expect(await screen.findByText(/potenzialmente manomesso/i)).toBeInTheDocument();
  });
});
