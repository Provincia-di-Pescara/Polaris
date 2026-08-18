import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as disciplineApi from '../api/discipline.ts';
import * as classiApi from '../api/classiAttivita.ts';
import * as slotApi from '../api/slot.ts';
import * as domandeApi from '../api/domande.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { WizardDomandaView } from './WizardDomandaView.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import type { Domanda } from '../api/domande.ts';

const ENTITA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 'st1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

const DOMANDA_MOCK: Domanda = {
  id: 'd1', numeroProtocollo: 'PROT-2026-0001', associazioneId: 'ass1', stagioneId: 'st1',
  stato: 'presentata', presentataIl: '2026-08-18T10:00:00.000Z',
  numeroTesserati: 40, numeroAtletiPartecipanti: 30, numeroSquadre: 3,
  fabbisognoMinimoMinuti: '360', fabbisognoOttimaleMinuti: '480',
};

const SLOT_A: slotApi.SlotDisponibile = {
  id: '11111111-1111-1111-1111-111111111111', impiantoDenominazione: 'Palestra Galilei', spazioDenominazione: 'Campo 1',
  giornoSettimana: 1, orarioInizio: '18:00', orarioFine: '19:30', durataMinuti: 90, pregiata: true,
};
const SLOT_B: slotApi.SlotDisponibile = {
  id: '22222222-2222-2222-2222-222222222222', impiantoDenominazione: 'Palestra Galilei', spazioDenominazione: 'Campo 1',
  giornoSettimana: 3, orarioInizio: '19:30', orarioFine: '21:00', durataMinuti: 90, pregiata: false,
};

function mockAnagrafiche(): void {
  vi.spyOn(disciplineApi, 'listaDiscipline').mockResolvedValue([
    { codice: 'PALL', denominazione: 'Pallavolo' },
    { codice: 'BASK', denominazione: 'Pallacanestro' },
  ]);
  vi.spyOn(classiApi, 'listaClassiAttivita').mockResolvedValue([
    { codice: 'A', descrizione: 'Campionati nazionali', pesoBase: 1 },
    { codice: 'C', descrizione: 'Attività promozionale', pesoBase: 3 },
  ]);
}

function renderWizard(): ReturnType<typeof render> {
  return render(<WizardDomandaView entities={[ENTITA]} stagioneId="st1" activeEntity={ENTITA} />);
}

// Gli slot si selezionano per id (le etichette contengono orari ripetuti tra
// slot contigui: l'orario di fine di uno coincide con l'inizio dell'altro).
async function selezionaSlot(slotId: string): Promise<void> {
  const el = await vi.waitFor(() => {
    const trovato = document.getElementById(`wiz-slot-${slotId}`);
    if (!trovato) throw new Error(`Slot #${slotId} non trovato`);
    return trovato;
  });
  await userEvent.click(el);
}

// Compila i minimi indispensabili per superare le validazioni di ogni step
// (disciplina allo step 1, fabbisogni allo step 2) e avanza fino allo step
// indicato.
async function vaiAlloStep(n: number): Promise<void> {
  await userEvent.click(await screen.findByLabelText('Pallavolo'));
  for (let i = 1; i < n; i++) {
    if (i === 2) {
      await userEvent.type(screen.getByLabelText(/fabbisogno minimo/i), '360');
      await userEvent.type(screen.getByLabelText(/fabbisogno ottimale/i), '480');
    }
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
  }
}

describe('WizardDomandaView', () => {
  beforeEach(() => {
    mockAnagrafiche();
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([]);
    vi.spyOn(slotApi, 'listaSlot').mockResolvedValue([SLOT_A, SLOT_B]);
  });

  it('nessuna domanda esistente: mostra il wizard allo step 1', async () => {
    renderWizard();
    expect(await screen.findByText(/step 1: inquadramento/i)).toBeInTheDocument();
    expect(domandeApi.listaDomandePerAssociazione).toHaveBeenCalledWith('ass1');
  });

  it('domanda già presentata per la stagione: mostra il riepilogo di sola lettura', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([DOMANDA_MOCK]);
    renderWizard();

    expect(await screen.findByText(/domanda già presentata/i)).toBeInTheDocument();
    expect(screen.getByText(/PROT-2026-0001/)).toBeInTheDocument();
    expect(screen.queryByText(/step 1: inquadramento/i)).not.toBeInTheDocument();
  });

  it('domanda esistente ma di un\'altra stagione: mostra comunque il wizard', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([{ ...DOMANDA_MOCK, stagioneId: 'st-vecchia' }]);
    renderWizard();
    expect(await screen.findByText(/step 1: inquadramento/i)).toBeInTheDocument();
  });

  it('senza associazione attiva: messaggio esplicito, nessuna chiamata API', async () => {
    render(<WizardDomandaView entities={[]} stagioneId="st1" activeEntity={null} />);
    expect(screen.getByText(/seleziona un'associazione con delega approvata/i)).toBeInTheDocument();
    expect(domandeApi.listaDomandePerAssociazione).not.toHaveBeenCalled();
  });

  it('senza stagione selezionata: messaggio esplicito', () => {
    render(<WizardDomandaView entities={[ENTITA]} stagioneId={null} activeEntity={ENTITA} />);
    expect(screen.getByText(/seleziona una stagione/i)).toBeInTheDocument();
  });

  it('naviga avanti e indietro tra i 4 step', async () => {
    renderWizard();
    await vaiAlloStep(2);
    expect(screen.getByText(/step 2: fabbisogno/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/fabbisogno minimo/i), '360');
    await userEvent.type(screen.getByLabelText(/fabbisogno ottimale/i), '480');
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    expect(screen.getByText(/step 3: richiesta blocco giornata/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    expect(screen.getByText(/step 4: preferenze slot/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /indietro/i }));
    expect(screen.getByText(/step 3: richiesta blocco giornata/i)).toBeInTheDocument();
  });

  it('step 1 senza discipline selezionate: blocca l\'avanzamento', async () => {
    renderWizard();
    await screen.findByText(/step 1: inquadramento/i);
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    expect(screen.getByText(/seleziona almeno una disciplina/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1: inquadramento/i)).toBeInTheDocument();
  });

  it('step 3: giornata gara richiesta senza richieste blocca l\'avanzamento, con una richiesta avanza', async () => {
    renderWizard();
    await vaiAlloStep(3);

    await userEvent.click(screen.getByLabelText(/richiedi blocco\/i giornata gara/i));
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    expect(screen.getByText(/aggiungi almeno una richiesta/i)).toBeInTheDocument();
    expect(screen.getByText(/step 3: richiesta blocco giornata/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /aggiungi richiesta giornata gara/i }));
    await userEvent.type(screen.getByLabelText(/^federazione/i), 'FIPAV');
    await userEvent.type(screen.getByLabelText(/^campionato/i), 'Serie C');
    await userEvent.type(screen.getByLabelText(/^categoria/i), 'Maschile');
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    expect(screen.getByText(/step 4: preferenze slot/i)).toBeInTheDocument();
  });

  it('step 2: fabbisogni vuoti o ottimale < minimo bloccano l\'avanzamento', async () => {
    renderWizard();
    await vaiAlloStep(2);

    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    expect(screen.getByText(/fabbisogno minimo settimanale valido/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/fabbisogno minimo/i), '480');
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    expect(screen.getByText(/fabbisogno ottimale settimanale valido/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/fabbisogno ottimale/i), '360');
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    expect(screen.getByText(/ottimale deve essere maggiore o uguale/i)).toBeInTheDocument();
    expect(screen.getByText(/step 2: fabbisogno/i)).toBeInTheDocument();
  });

  it('step 3: una richiesta giornata gara con campi vuoti blocca l\'avanzamento', async () => {
    renderWizard();
    await vaiAlloStep(3);

    await userEvent.click(screen.getByLabelText(/richiedi blocco\/i giornata gara/i));
    await userEvent.click(screen.getByRole('button', { name: /aggiungi richiesta giornata gara/i }));
    await userEvent.type(screen.getByLabelText(/^federazione/i), 'FIPAV');
    // campionato e categoria restano vuoti: il backend li richiede .min(1)
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));

    expect(screen.getByText(/federazione, campionato e categoria sono obbligatori/i)).toBeInTheDocument();
    expect(screen.getByText(/step 3: richiesta blocco giornata/i)).toBeInTheDocument();
  });

  it('submit senza preferenze: blocca con messaggio, non chiama creaDomanda', async () => {
    const spy = vi.spyOn(domandeApi, 'creaDomanda');
    renderWizard();
    await vaiAlloStep(4);

    await userEvent.click(screen.getByRole('button', { name: /invia domanda definitiva/i }));

    expect(screen.getByText(/seleziona almeno uno slot tra le preferenze/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('submit dopo aver saltato lo step 2 con lo stepper: rivalidato, nessuna chiamata', async () => {
    const spy = vi.spyOn(domandeApi, 'creaDomanda');
    renderWizard();
    await userEvent.click(await screen.findByLabelText('Pallavolo'));
    // Salto diretto allo step 4 cliccando lo stepper (bypass dei bottoni Avanti).
    await userEvent.click(screen.getByText('Preferenze & Blocchi'));
    await selezionaSlot(SLOT_A.id);
    await userEvent.click(screen.getByRole('button', { name: /invia domanda definitiva/i }));

    expect(screen.getByText(/fabbisogno minimo settimanale valido/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('uno slot già in un blocco non può entrare in un secondo blocco', async () => {
    renderWizard();
    await vaiAlloStep(4);

    await selezionaSlot(SLOT_A.id);
    await selezionaSlot(SLOT_B.id);
    await userEvent.click(document.getElementById(`wiz-blocco-sel-${SLOT_A.id}`)!);
    await userEvent.click(document.getElementById(`wiz-blocco-sel-${SLOT_B.id}`)!);
    await userEvent.click(screen.getByRole('button', { name: /raggruppa in blocco allenamento/i }));

    expect(document.getElementById(`wiz-blocco-sel-${SLOT_A.id}`)).toBeDisabled();
    expect(document.getElementById(`wiz-blocco-sel-${SLOT_B.id}`)).toBeDisabled();
    expect(screen.getAllByText(/già nel blocco 1/i).length).toBe(2);
  });

  it('anteprima FR: chiama anteprimaFabbisogno con i campi correnti e mostra il risultato', async () => {
    const spy = vi.spyOn(domandeApi, 'anteprimaFabbisogno').mockResolvedValue({
      pesoBase: 1, incrementoSquadre: 3, frCalcolatoMinuti: '240.00', frFinaleMinuti: '240.00',
      crs: '1.0000', caa: '1.0000', csd: '1.0000', cp: '1.0000',
    });
    renderWizard();
    await screen.findByText(/step 1: inquadramento/i);
    await userEvent.click(screen.getByLabelText('Pallavolo'));
    await userEvent.selectOptions(screen.getByLabelText(/classe di attività/i), 'A');
    await userEvent.clear(screen.getByLabelText(/squadre federali stagione precedente/i));
    await userEvent.type(screen.getByLabelText(/squadre federali stagione precedente/i), '4');
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));

    await userEvent.type(screen.getByLabelText(/fabbisogno ottimale/i), '480');
    await userEvent.click(screen.getByRole('button', { name: /calcola anteprima/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      associazioneId: 'ass1',
      stagioneId: 'st1',
      classeAttivitaCodice: 'A',
      numeroSquadreFederali: 4,
      fdMinuti: '480',
    }));
    expect(await screen.findByText(/240\.00 minuti settimanali/)).toBeInTheDocument();
    expect(screen.getByText(/il valore definitivo sarà confermato dalla provincia/i)).toBeInTheDocument();
  });

  it('anteprima FR fallita (motore non configurato): mostra un errore leggibile, nessun crash', async () => {
    vi.spyOn(domandeApi, 'anteprimaFabbisogno').mockRejectedValue(new ErroreRichiestaApi(503, 'motore non configurato'));
    renderWizard();
    await screen.findByText(/step 1: inquadramento/i);
    await userEvent.click(screen.getByLabelText('Pallavolo'));
    await userEvent.selectOptions(screen.getByLabelText(/classe di attività/i), 'A');
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));

    await userEvent.type(screen.getByLabelText(/fabbisogno ottimale/i), '480');
    await userEvent.click(screen.getByRole('button', { name: /calcola anteprima/i }));

    expect(await screen.findByText(/motore di calcolo non disponibile/i)).toBeInTheDocument();
    expect(screen.getByText(/step 2: fabbisogno/i)).toBeInTheDocument();
  });

  it('step 4: due slot raggruppati in un blocco finiscono in blocchiAllenamento nel submit', async () => {
    const spy = vi.spyOn(domandeApi, 'creaDomanda').mockResolvedValue(DOMANDA_MOCK);
    renderWizard();
    await vaiAlloStep(4);

    expect(await vi.waitFor(() => slotApi.listaSlot)).toHaveBeenCalledWith('st1', 'PALL');

    await selezionaSlot(SLOT_A.id);
    await selezionaSlot(SLOT_B.id);

    // Nella lista preferenze ogni riga ha una seconda checkbox (selezione per blocco).
    await userEvent.click(document.getElementById(`wiz-blocco-sel-${SLOT_A.id}`)!);
    await userEvent.click(document.getElementById(`wiz-blocco-sel-${SLOT_B.id}`)!);
    await userEvent.click(screen.getByRole('button', { name: /raggruppa in blocco allenamento/i }));

    expect(screen.getByText('Blocco 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /invia domanda definitiva/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      preferenze: [SLOT_A.id, SLOT_B.id],
      blocchiAllenamento: [[SLOT_A.id, SLOT_B.id]],
    }));
  });

  it('rimuovere un blocco lascia gli slot nelle preferenze', async () => {
    renderWizard();
    await vaiAlloStep(4);

    await selezionaSlot(SLOT_A.id);
    await selezionaSlot(SLOT_B.id);
    await userEvent.click(document.getElementById(`wiz-blocco-sel-${SLOT_A.id}`)!);
    await userEvent.click(document.getElementById(`wiz-blocco-sel-${SLOT_B.id}`)!);
    await userEvent.click(screen.getByRole('button', { name: /raggruppa in blocco allenamento/i }));
    await userEvent.click(screen.getByRole('button', { name: /rimuovi blocco/i }));

    expect(screen.queryByText(/blocchi allenamento richiesti/i)).not.toBeInTheDocument();
    expect(document.getElementById(`wiz-blocco-sel-${SLOT_A.id}`)).toBeInTheDocument();
    expect(document.getElementById(`wiz-blocco-sel-${SLOT_B.id}`)).toBeInTheDocument();
  });

  it('submit riuscito: creaDomanda riceve il payload atteso, poi appare il riepilogo di sola lettura', async () => {
    const spy = vi.spyOn(domandeApi, 'creaDomanda').mockResolvedValue(DOMANDA_MOCK);
    renderWizard();
    await screen.findByText(/step 1: inquadramento/i);

    await userEvent.click(screen.getByLabelText('Pallavolo'));
    await userEvent.selectOptions(screen.getByLabelText(/classe di attività/i), 'A');
    await userEvent.selectOptions(screen.getByLabelText(/livello campionato/i), 'regionale');
    await userEvent.clear(screen.getByLabelText(/numero tesserati/i));
    await userEvent.type(screen.getByLabelText(/numero tesserati/i), '40');
    await userEvent.clear(screen.getByLabelText(/numero atleti partecipanti/i));
    await userEvent.type(screen.getByLabelText(/numero atleti partecipanti/i), '30');
    await userEvent.clear(screen.getByLabelText(/numero squadre:/i));
    await userEvent.type(screen.getByLabelText(/numero squadre:/i), '3');
    await userEvent.clear(screen.getByLabelText(/squadre federali stagione precedente/i));
    await userEvent.type(screen.getByLabelText(/squadre federali stagione precedente/i), '2');
    await userEvent.click(screen.getByLabelText(/attività agonistica/i));
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));

    await userEvent.type(screen.getByLabelText(/fabbisogno minimo/i), '360');
    await userEvent.type(screen.getByLabelText(/fabbisogno ottimale/i), '480');
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));
    await userEvent.click(screen.getByRole('button', { name: /avanti al prossimo step/i }));

    await selezionaSlot(SLOT_A.id);
    await userEvent.click(screen.getByRole('button', { name: /invia domanda definitiva/i }));

    expect(spy).toHaveBeenCalledWith({
      associazioneId: 'ass1',
      stagioneId: 'st1',
      disciplineCodici: ['PALL'],
      classeAttivitaCodice: 'A',
      livelloCampionato: 'regionale',
      numeroTesserati: 40,
      numeroAtletiPartecipanti: 30,
      numeroSquadre: 3,
      numeroSquadreFederaliStagionePrecedente: 2,
      attivitaGiovanile: false,
      attivitaAgonistica: true,
      attivitaParalimpicaInclusiva: false,
      fabbisognoMinimoMinuti: '360',
      fabbisognoOttimaleMinuti: '480',
      preferenze: [SLOT_A.id],
      blocchiAllenamento: [],
      richiedeGiornataGara: false,
      richiesteGiornataGara: [],
    });

    expect(await screen.findByText(/domanda già presentata/i)).toBeInTheDocument();
    expect(screen.getByText(/PROT-2026-0001/)).toBeInTheDocument();
  });

  it('submit fallito: mostra il messaggio di errore del backend', async () => {
    vi.spyOn(domandeApi, 'creaDomanda').mockRejectedValue(new ErroreRichiestaApi(409, 'domanda già presente per questa stagione'));
    renderWizard();
    await vaiAlloStep(4);

    await selezionaSlot(SLOT_A.id);
    await userEvent.click(screen.getByRole('button', { name: /invia domanda definitiva/i }));

    expect(await screen.findByText(/domanda già presente per questa stagione/i)).toBeInTheDocument();
  });
});
