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
  // Stessa persona fisica di ENTITA.personaFisicaId ('p1'): è lei che ha proposto.
  proponentePersonaFisicaId: 'p1',
  parti: [
    { associazioneId: 'ass1', accettatoIl: '2026-08-20T10:00:00.000Z', accettatoDaPersonaFisicaId: 'p1' },
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

  it('proposta della propria associazione ma proposta da un ALTRO delegato: nessun bottone Annulla (il backend verificherebbe la persona fisica, non solo l\'associazione)', async () => {
    // Stessa associazione proponente (ass1) di ENTITA, ma proponentePersonaFisicaId
    // è di un altro delegato: la route /annulla del backend confronta
    // proposta.proponentePersonaFisicaId === req.persona.sub, quindi questo
    // delegato otterrebbe sempre un 403 se il bottone fosse mostrato.
    vi.spyOn(concertazioneApi, 'listaProposteConcertazione').mockResolvedValue([
      { ...PROPOSTA_PROPONENTE, proponentePersonaFisicaId: 'altro-delegato-p9' },
    ]);
    renderView();

    await screen.findByText(/le mie proposte/i);
    expect(screen.queryByRole('button', { name: /annulla/i })).not.toBeInTheDocument();
    // La propria associazione ha già accettato (parte 'ass1' con accettatoIl valorizzato
    // nel fixture), quindi neanche Accetta deve comparire.
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

  it('caricaProposte scarta una risposta fuori ordine: la fetch del mount, più lenta, non deve sovrascrivere una fetch più recente già risolta', async () => {
    // Riproduce lo scenario di race del bug (stesso pattern già in EsitiIsfView):
    // la fetch dell'effect al mount (chiamata #1) resta pendente; una seconda
    // fetch (chiamata #2, innescata qui dall'invio di una nuova proposta) parte
    // dopo ma risolve PRIMA. Senza il contatore monotono, la chiamata #1
    // risolvendo più tardi sovrascriverebbe silenziosamente la lista con dati
    // superati (qui: lista vuota) nonostante la #2 avesse già mostrato dati freschi.
    let risolviChiamata1!: (v: Proposta[]) => void;
    let risolviChiamata2!: (v: Proposta[]) => void;
    const chiamata1 = new Promise<Proposta[]>((res) => { risolviChiamata1 = res; });
    const chiamata2 = new Promise<Proposta[]>((res) => { risolviChiamata2 = res; });

    const spyLista = vi.spyOn(concertazioneApi, 'listaProposteConcertazione')
      .mockReturnValueOnce(chiamata1) // fetch dell'effect al mount
      .mockReturnValueOnce(chiamata2); // fetch innescata da creaProposta più sotto
    vi.spyOn(concertazioneApi, 'creaProposta').mockResolvedValue({ ...PROPOSTA_PROPONENTE, id: 'p-nuova' });

    renderView();
    await screen.findByText(/le mie proposte/i); // il bollettino/proposte sono già montati, chiamata #1 pendente

    // Innesca la chiamata #2 (dopo l'invio di una nuova proposta riuscito).
    await userEvent.click(screen.getByRole('button', { name: /aggiungi riga slot/i }));
    await userEvent.selectOptions(screen.getByLabelText(/slot da cedere/i), 's1');
    await userEvent.selectOptions(screen.getByLabelText(/associazione ricevente/i), 'ass2');
    await userEvent.click(screen.getByRole('button', { name: /invia proposta/i }));
    expect(await screen.findByText(/proposta creata con successo/i)).toBeInTheDocument();
    expect(spyLista).toHaveBeenCalledTimes(2);

    // La chiamata #2 (più recente) risolve per prima con dati freschi.
    risolviChiamata2([PROPOSTA_PROPONENTE]);
    expect(await screen.findByRole('button', { name: /annulla/i })).toBeInTheDocument();

    // La chiamata #1 (mount, più vecchia) risolve DOPO con una lista vuota: senza
    // il guard sovrascriverebbe silenziosamente il bottone Annulla appena mostrato.
    risolviChiamata1([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole('button', { name: /annulla/i })).toBeInTheDocument();
  });
});
