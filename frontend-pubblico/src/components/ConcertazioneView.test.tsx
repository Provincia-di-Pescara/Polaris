import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as concertazioneApi from '../api/concertazione.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { ConcertazioneView } from './ConcertazioneView.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import type { VocePropostaProvvisoria, Proposta } from '../api/concertazione.ts';

const ENTITA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 'st1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

const VOCE_PROPRIA: VocePropostaProvvisoria = {
  slotId: 's1', associazioneId: 'ass1', associazioneDenominazione: 'ASD Test', tipo: 'singola',
  valoreMinutiAssegnato: '120.000', fabbisognoRiconosciutoMinuti: '420.000', isf: '0.857',
  sorteggioRiferimento: null, impiantoDenominazione: 'Palestra Galilei', spazioDenominazione: 'Campo 1',
  giornoSettimana: 1, orarioInizio: '17:00', orarioFine: '19:00', durataMinuti: 120, pregiata: true,
};

const VOCE_ALTRA: VocePropostaProvvisoria = {
  slotId: 's2', associazioneId: 'ass2', associazioneDenominazione: 'Polisportiva Aterno', tipo: 'singola',
  valoreMinutiAssegnato: '90.000', fabbisognoRiconosciutoMinuti: '300.000', isf: null,
  sorteggioRiferimento: null, impiantoDenominazione: 'Palestra Volta', spazioDenominazione: 'Campo A',
  giornoSettimana: 2, orarioInizio: '18:00', orarioFine: '19:30', durataMinuti: 90, pregiata: false,
};

const BOLLETTINO: VocePropostaProvvisoria[] = [VOCE_PROPRIA, VOCE_ALTRA];

const PROPOSTA_IN_ATTESA_NON_ACCETTATA: Proposta = {
  id: 'p1', stagioneId: 'st1', tipo: 'scambio_bilaterale', proponentePersonaFisicaId: 'pf2',
  proponenteAssociazioneId: 'ass2', stato: 'in_attesa_accettazione', versione: 1, motivazioneRigetto: null,
  creataIl: '2026-08-20T10:00:00.000Z', validataIl: null, validataDa: null,
  parti: [
    { associazioneId: 'ass2', accettatoIl: '2026-08-20T10:00:00.000Z', accettatoDaPersonaFisicaId: 'pf2' },
    { associazioneId: 'ass1', accettatoIl: null, accettatoDaPersonaFisicaId: null },
  ],
  slot: [
    { slotId: 's2', associazioneCedenteId: 'ass2', associazioneRiceventeId: 'ass1' },
    { slotId: 's1', associazioneCedenteId: 'ass1', associazioneRiceventeId: 'ass2' },
  ],
};

const PROPOSTA_PROPONENTE: Proposta = {
  ...PROPOSTA_IN_ATTESA_NON_ACCETTATA,
  id: 'p2',
  proponenteAssociazioneId: 'ass1',
  parti: [
    { associazioneId: 'ass1', accettatoIl: '2026-08-20T10:00:00.000Z', accettatoDaPersonaFisicaId: 'pf1' },
    { associazioneId: 'ass2', accettatoIl: null, accettatoDaPersonaFisicaId: null },
  ],
};

function renderView(): ReturnType<typeof render> {
  return render(<ConcertazioneView entities={[ENTITA]} stagioneId="st1" activeEntity={ENTITA} />);
}

describe('ConcertazioneView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(concertazioneApi, 'propostaProvvisoria').mockResolvedValue(BOLLETTINO);
    vi.spyOn(concertazioneApi, 'listaProposteConcertazione').mockResolvedValue([]);
  });

  it('stagione non ancora in concertazione: messaggio dedicato, nessuna sezione', async () => {
    vi.spyOn(concertazioneApi, 'propostaProvvisoria').mockRejectedValue(
      new ErroreRichiestaApi(409, 'la concertazione non è ancora aperta per questa stagione'),
    );
    renderView();

    expect(await screen.findByText(/la concertazione non è ancora aperta per questa stagione/i)).toBeInTheDocument();
    expect(screen.queryByText(/bollettino proposta provvisoria/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/le mie proposte/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/proponi nuova concertazione/i)).not.toBeInTheDocument();
  });

  it('bollettino con più voci di più associazioni: tabella corretta, riga propria evidenziata', async () => {
    renderView();

    const rigaPropria = (await screen.findByText('La tua associazione')).closest('tr')!;
    expect(within(rigaPropria).getByText('Palestra Galilei')).toBeInTheDocument();
    expect(within(rigaPropria).getByText('420.000')).toBeInTheDocument();
    expect(within(rigaPropria).getByText('0.857')).toBeInTheDocument();

    const rigaAltra = screen.getByText('Polisportiva Aterno').closest('tr')!;
    expect(within(rigaAltra).getByText('300.000')).toBeInTheDocument();
    expect(within(rigaAltra).getByText('—')).toBeInTheDocument();
    expect(within(rigaAltra).queryByText('La tua associazione')).not.toBeInTheDocument();
  });

  it('proposta in attesa non ancora accettata dalla propria associazione: bottone Accetta, click chiama accettaProposta e ricarica', async () => {
    const spyLista = vi.spyOn(concertazioneApi, 'listaProposteConcertazione').mockResolvedValue([PROPOSTA_IN_ATTESA_NON_ACCETTATA]);
    const spyAccetta = vi.spyOn(concertazioneApi, 'accettaProposta').mockResolvedValue({
      ...PROPOSTA_IN_ATTESA_NON_ACCETTATA,
      parti: PROPOSTA_IN_ATTESA_NON_ACCETTATA.parti.map((p) => (p.associazioneId === 'ass1' ? { ...p, accettatoIl: '2026-08-21T10:00:00.000Z' } : p)),
    });
    renderView();

    const bottoneAccetta = await screen.findByRole('button', { name: /accetta/i });
    expect(screen.queryByRole('button', { name: /annulla/i })).not.toBeInTheDocument();

    spyLista.mockResolvedValue([]);
    await userEvent.click(bottoneAccetta);

    expect(spyAccetta).toHaveBeenCalledWith('p1', 'ass1');
    expect(spyLista).toHaveBeenCalledTimes(2);
  });

  it('proposta in attesa dove la propria associazione è la proponente: bottone Annulla al posto di Accetta', async () => {
    vi.spyOn(concertazioneApi, 'listaProposteConcertazione').mockResolvedValue([PROPOSTA_PROPONENTE]);
    renderView();

    expect(await screen.findByRole('button', { name: /annulla/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^accetta$/i })).not.toBeInTheDocument();
  });

  it('proposte in stati terminali: nessun bottone azione', async () => {
    for (const stato of ['accettata_da_tutti', 'validata', 'rigettata', 'annullata'] as const) {
      vi.spyOn(concertazioneApi, 'listaProposteConcertazione').mockResolvedValue([
        { ...PROPOSTA_PROPONENTE, stato },
      ]);
      const { unmount } = renderView();
      await screen.findByText(/le mie proposte/i);
      expect(screen.queryByRole('button', { name: /accetta/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /annulla/i })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('nuova proposta scambio bilaterale: select slot da cedere visibile, submit invia il payload atteso', async () => {
    const spyCrea = vi.spyOn(concertazioneApi, 'creaProposta').mockResolvedValue({
      ...PROPOSTA_PROPONENTE,
      id: 'p-nuova',
    });
    renderView();

    await userEvent.click(await screen.findByRole('button', { name: /aggiungi riga slot/i }));
    expect(screen.getByLabelText(/slot da cedere/i)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/slot da cedere/i), 's1');
    await userEvent.selectOptions(screen.getByLabelText(/associazione ricevente/i), 'ass2');
    await userEvent.click(screen.getByRole('button', { name: /invia proposta/i }));

    expect(spyCrea).toHaveBeenCalledWith({
      stagioneId: 'st1',
      proponenteAssociazioneId: 'ass1',
      tipo: 'scambio_bilaterale',
      slot: [{ slotId: 's1', associazioneCedenteId: 'ass1', associazioneRiceventeId: 'ass2' }],
    });
  });

  it('nuova proposta utilizzo slot libero: select slot da cedere assente, submit senza associazioneCedenteId', async () => {
    const spyCrea = vi.spyOn(concertazioneApi, 'creaProposta').mockResolvedValue({
      ...PROPOSTA_PROPONENTE,
      id: 'p-nuova',
      tipo: 'utilizzo_slot_libero',
    });
    renderView();

    await userEvent.selectOptions(await screen.findByLabelText(/tipo proposta/i), 'utilizzo_slot_libero');
    await userEvent.click(screen.getByRole('button', { name: /aggiungi riga slot/i }));
    expect(screen.queryByLabelText(/slot da cedere/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/associazione ricevente/i), 'ass2');
    await userEvent.selectOptions(screen.getByLabelText(/slot ricevuto/i), 's2');
    await userEvent.click(screen.getByRole('button', { name: /invia proposta/i }));

    expect(spyCrea).toHaveBeenCalledWith({
      stagioneId: 'st1',
      proponenteAssociazioneId: 'ass1',
      tipo: 'utilizzo_slot_libero',
      slot: [{ slotId: 's2', associazioneRiceventeId: 'ass1' }],
    });
    const chiamata = spyCrea.mock.calls[0]![0];
    expect(chiamata.slot[0]).not.toHaveProperty('associazioneCedenteId');
  });

  it('submit bloccato se nessuna riga slot presente', async () => {
    const spyCrea = vi.spyOn(concertazioneApi, 'creaProposta');
    renderView();

    await userEvent.click(await screen.findByRole('button', { name: /invia proposta/i }));

    expect(await screen.findByText(/aggiungi almeno una riga slot/i)).toBeInTheDocument();
    expect(spyCrea).not.toHaveBeenCalled();
  });
});
