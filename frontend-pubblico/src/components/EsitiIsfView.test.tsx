import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as domandeApi from '../api/domande.ts';
import * as assegnazioniApi from '../api/assegnazioni.ts';
import * as osservazioniApi from '../api/osservazioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { EsitiIsfView } from './EsitiIsfView.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import type { Domanda, EsitoPubblicato } from '../api/domande.ts';
import type { AssegnazioneLettura } from '../api/assegnazioni.ts';
import type { Osservazione } from '../api/osservazioni.ts';

const ENTITA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 'st1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

const DOMANDA_PRESENTATA: Domanda = {
  id: 'd1', numeroProtocollo: 'PROT-2026-0001', associazioneId: 'ass1', stagioneId: 'st1',
  stato: 'presentata', riesameStato: 'nessuno', motivazioneEsclusione: null, presentataIl: '2026-08-18T10:00:00.000Z',
  numeroTesserati: 40, numeroAtletiPartecipanti: 30, numeroSquadre: 3,
  fabbisognoMinimoMinuti: '360', fabbisognoOttimaleMinuti: '480',
};

const DOMANDA_AMMESSA: Domanda = { ...DOMANDA_PRESENTATA, stato: 'ammessa' };

const DOMANDA_ESCLUSA: Domanda = {
  ...DOMANDA_PRESENTATA, stato: 'esclusa', motivazioneEsclusione: 'Documentazione assicurativa incompleta.',
};

// FR 420, VA 360 (120 + 240) → ISF 0.857 (85.7%): stessi numeri del mock
// storico, così il calcolo atteso è verificabile a mano.
const ESITO_PROPRIO: EsitoPubblicato = {
  domandaId: 'd1', associazioneId: 'ass1', associazioneDenominazione: 'ASD Test',
  stato: 'ammessa', motivazioneEsclusione: null,
  fabbisognoRiconosciuto: { frCalcolatoMinuti: '400.000', fdMinuti: '480.000', frFinaleMinuti: '420.000' },
  coefficienti: { crs: '1.2000', caa: '1.0000', csd: '1.0000', cp: '1.2000' },
};

const ESITO_ALTRA: EsitoPubblicato = {
  domandaId: 'd2', associazioneId: 'ass2', associazioneDenominazione: 'Polisportiva Aterno',
  stato: 'esclusa', motivazioneEsclusione: 'Fuori termine.',
  fabbisognoRiconosciuto: { frCalcolatoMinuti: '300.000', fdMinuti: '300.000', frFinaleMinuti: '300.000' },
  coefficienti: { crs: '1.0000', caa: '1.0000', csd: '1.0000', cp: '1.0000' },
};

const ASSEGNAZIONE_A: AssegnazioneLettura = {
  id: 'as1', tipo: 'singola', stato: 'provvisoria', valoreMinuti: '120.000',
  impiantoDenominazione: 'Palestra Galilei', spazioDenominazione: 'Campo 1',
  giornoSettimana: 1, orarioInizio: '17:00', orarioFine: '19:00', durataMinuti: 120, pregiata: true,
};

const ASSEGNAZIONE_B: AssegnazioneLettura = {
  id: 'as2', tipo: 'blocco_gara', stato: 'validata', valoreMinuti: '240.000',
  impiantoDenominazione: 'Palestra Galilei', spazioDenominazione: 'Campo 1',
  giornoSettimana: 6, orarioInizio: '16:00', orarioFine: '20:00', durataMinuti: 240, pregiata: false,
};

const OSSERVAZIONE: Osservazione = {
  id: 'o1', domandaId: 'd1', testo: 'Le polizze erano state allegate.', presentataIl: '2026-08-19T09:00:00.000Z',
  stato: 'in_esame', decisioneMotivazione: null, decisaIl: null,
};

function renderView(): ReturnType<typeof render> {
  return render(<EsitiIsfView entities={[ENTITA]} stagioneId="st1" activeEntity={ENTITA} />);
}

describe('EsitiIsfView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([]);
    vi.spyOn(domandeApi, 'elencoEsitiPubblicati').mockResolvedValue([]);
    vi.spyOn(assegnazioniApi, 'listaAssegnazioni').mockResolvedValue([]);
    vi.spyOn(osservazioniApi, 'listaOsservazioni').mockResolvedValue([]);
  });

  it('senza stagione selezionata: messaggio esplicito, nessuna chiamata API', () => {
    render(<EsitiIsfView entities={[ENTITA]} stagioneId={null} activeEntity={ENTITA} />);
    expect(screen.getByText(/seleziona una stagione/i)).toBeInTheDocument();
    expect(domandeApi.elencoEsitiPubblicati).not.toHaveBeenCalled();
  });

  it('senza associazione attiva: messaggio esplicito, nessuna lettura domanda', () => {
    render(<EsitiIsfView entities={[]} stagioneId="st1" activeEntity={null} />);
    expect(screen.getByText(/seleziona un'associazione con delega approvata/i)).toBeInTheDocument();
    expect(domandeApi.listaDomandePerAssociazione).not.toHaveBeenCalled();
  });

  it('nessuna domanda per la stagione: messaggio, nessuna sezione osservazioni, tabellone comunque presente', async () => {
    vi.spyOn(domandeApi, 'elencoEsitiPubblicati').mockResolvedValue([ESITO_ALTRA]);
    renderView();

    expect(await screen.findByText(/nessuna domanda presentata per questa stagione/i)).toBeInTheDocument();
    expect(screen.queryByText(/osservazioni e richiesta di riesame/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Polisportiva Aterno')).toBeInTheDocument();
    expect(assegnazioniApi.listaAssegnazioni).not.toHaveBeenCalled();
    expect(osservazioniApi.listaOsservazioni).not.toHaveBeenCalled();
  });

  it('tabellone vuoto: messaggio dedicato', async () => {
    renderView();
    expect(await screen.findByText(/nessun esito ancora pubblicato per questa stagione/i)).toBeInTheDocument();
  });

  it('domanda ancora "presentata": esito non pubblicato, nessun KPI, nessuna osservazione', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([DOMANDA_PRESENTATA]);
    renderView();

    expect(await screen.findByText(/esito istruttoria non ancora pubblicato/i)).toBeInTheDocument();
    expect(screen.queryByText(/punteggio isf/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/osservazioni e richiesta di riesame/i)).not.toBeInTheDocument();
    expect(assegnazioniApi.listaAssegnazioni).not.toHaveBeenCalled();
  });

  it('domanda ammessa: KPI, tabella slot e ISF calcolato da VA/FR', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([DOMANDA_AMMESSA]);
    vi.spyOn(domandeApi, 'elencoEsitiPubblicati').mockResolvedValue([ESITO_PROPRIO, ESITO_ALTRA]);
    vi.spyOn(assegnazioniApi, 'listaAssegnazioni').mockResolvedValue([ASSEGNAZIONE_A, ASSEGNAZIONE_B]);
    renderView();

    expect(await screen.findByText('420.000 minuti')).toBeInTheDocument();
    expect(screen.getByText(/CRS 1\.2000 • CAA 1\.0000 • CSD 1\.0000/)).toBeInTheDocument();
    // Esiti e assegnazioni sono due fetch distinte: i KPI che dipendono dal VA
    // possono comparire dopo quelli che dipendono dal solo esito.
    expect(await screen.findByText('2 slot (360 min)')).toBeInTheDocument();
    // ISF = 360 / 420 = 0.857 (85.7%) — calcolo di sola visualizzazione.
    expect((await screen.findAllByText('0.857 (85.7%)')).length).toBeGreaterThan(0);
    expect(screen.getByText(/ISF = VA \/ FR = 360 \/ 420\.000/)).toBeInTheDocument();

    expect(screen.getByText('Assegnato Blocco Gara')).toBeInTheDocument();
    expect(screen.getByText(/Assegnazione Singola \(provvisoria\)/)).toBeInTheDocument();
    expect(screen.getByText('Pregiata')).toBeInTheDocument();
    expect(screen.getByText('17:00 - 19:00')).toBeInTheDocument();

    expect(screen.queryByText(/osservazioni e richiesta di riesame/i)).not.toBeInTheDocument();
    expect(assegnazioniApi.listaAssegnazioni).toHaveBeenCalledWith('ass1', 'st1');
    // Una sola fetch degli esiti, condivisa tra KPI e tabellone.
    expect(domandeApi.elencoEsitiPubblicati).toHaveBeenCalledTimes(1);
  });

  it('esito presente ma coefficienti non ancora calcolati: messaggio di attesa al posto dei KPI', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([DOMANDA_AMMESSA]);
    vi.spyOn(domandeApi, 'elencoEsitiPubblicati').mockResolvedValue([
      { ...ESITO_PROPRIO, fabbisognoRiconosciuto: null, coefficienti: null },
    ]);
    renderView();

    expect(await screen.findByText(/in attesa di calcolo coefficienti/i)).toBeInTheDocument();
    expect(screen.queryByText(/punteggio isf/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nessuno slot assegnato/i)).toBeInTheDocument();
  });

  it('domanda esclusa: motivazione, form osservazione, invio e ricarica della lista', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([DOMANDA_ESCLUSA]);
    vi.spyOn(domandeApi, 'elencoEsitiPubblicati').mockResolvedValue([{ ...ESITO_PROPRIO, stato: 'esclusa' }]);
    const spyLista = vi.spyOn(osservazioniApi, 'listaOsservazioni').mockResolvedValue([]);
    const spyPresenta = vi.spyOn(osservazioniApi, 'presentaOsservazione').mockResolvedValue(OSSERVAZIONE);
    renderView();

    expect(await screen.findByText(/osservazioni e richiesta di riesame/i)).toBeInTheDocument();
    expect(screen.getByText('Documentazione assicurativa incompleta.')).toBeInTheDocument();
    expect(spyLista).toHaveBeenCalledTimes(1);

    spyLista.mockResolvedValue([OSSERVAZIONE]);
    await userEvent.type(screen.getByLabelText(/testo dell'osservazione/i), 'Le polizze erano state allegate.');
    await userEvent.click(screen.getByRole('button', { name: /presenta osservazione/i }));

    expect(spyPresenta).toHaveBeenCalledWith('d1', 'Le polizze erano state allegate.');
    expect(await screen.findByText('In esame')).toBeInTheDocument();
    expect(spyLista).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(/testo dell'osservazione/i)).toHaveValue('');
  });

  it('invio osservazione rifiutato dal backend: mostra il messaggio del backend', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([DOMANDA_ESCLUSA]);
    vi.spyOn(osservazioniApi, 'presentaOsservazione').mockRejectedValue(
      new ErroreRichiestaApi(409, 'riesame già deciso per questa domanda'),
    );
    renderView();

    await userEvent.type(await screen.findByLabelText(/testo dell'osservazione/i), 'Testo');
    await userEvent.click(screen.getByRole('button', { name: /presenta osservazione/i }));

    expect(await screen.findByText(/riesame già deciso per questa domanda/i)).toBeInTheDocument();
  });

  it('riesame già deciso: nessun form osservazioni anche se la domanda è esclusa', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([
      { ...DOMANDA_ESCLUSA, riesameStato: 'deciso' },
    ]);
    renderView();

    expect(await screen.findByText(/riesame deciso/i)).toBeInTheDocument();
    expect(screen.queryByText(/osservazioni e richiesta di riesame/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /presenta osservazione/i })).not.toBeInTheDocument();
  });

  it('tabellone pubblico: più associazioni, ISF solo sulla riga propria', async () => {
    vi.spyOn(domandeApi, 'listaDomandePerAssociazione').mockResolvedValue([DOMANDA_AMMESSA]);
    vi.spyOn(domandeApi, 'elencoEsitiPubblicati').mockResolvedValue([ESITO_PROPRIO, ESITO_ALTRA]);
    vi.spyOn(assegnazioniApi, 'listaAssegnazioni').mockResolvedValue([ASSEGNAZIONE_A, ASSEGNAZIONE_B]);
    renderView();

    const rigaPropria = (await screen.findByText('La tua associazione')).closest('tr')!;
    expect(within(rigaPropria).getByText('420.000')).toBeInTheDocument();
    // L'ISF di riga dipende anche dalla fetch assegnazioni (VA): può arrivare dopo.
    await vi.waitFor(() => expect(within(rigaPropria).getByText('0.857 (85.7%)')).toBeInTheDocument());

    const rigaAltra = screen.getByText('Polisportiva Aterno').closest('tr')!;
    expect(within(rigaAltra).getByText('300.000')).toBeInTheDocument();
    // Nessun ISF per le altre associazioni: il VA altrui non è leggibile.
    expect(within(rigaAltra).getByText('—')).toBeInTheDocument();
    expect(within(rigaAltra).queryByText('La tua associazione')).not.toBeInTheDocument();
  });

  it('tabellone non disponibile: errore leggibile, nessun crash', async () => {
    vi.spyOn(domandeApi, 'elencoEsitiPubblicati').mockRejectedValue(new ErroreRichiestaApi(500, 'boom'));
    renderView();
    expect(await screen.findByText(/tabellone esiti non disponibile: boom/i)).toBeInTheDocument();
  });
});
