import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as sttApi from '../api/settimanaTipoDefinitiva.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { CalendarioDefinitivoView } from './CalendarioDefinitivoView.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import type { VoceSettimanaTipoDefinitiva } from '../api/settimanaTipoDefinitiva.ts';

const ENTITA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 'st1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

const FASCIA_PROPRIA: VoceSettimanaTipoDefinitiva = {
  slotId: 's1', associazioneId: 'ass1', associazioneDenominazione: 'ASD Test', tipo: 'singola',
  valoreMinutiAssegnato: '120.000', fabbisognoRiconosciutoMinuti: '420.000', isf: '0.857',
  sorteggioRiferimento: null, concertazioneProposaId: null, efficace: true,
  impiantoDenominazione: 'Palestra Galilei', spazioDenominazione: 'Campo 1',
  giornoSettimana: 1, orarioInizio: '17:00', orarioFine: '19:00', durataMinuti: 120,
};

const FASCIA_ALTRA: VoceSettimanaTipoDefinitiva = {
  slotId: 's2', associazioneId: 'ass2', associazioneDenominazione: 'Polisportiva Aterno', tipo: 'blocco_gara',
  valoreMinutiAssegnato: '90.000', fabbisognoRiconosciutoMinuti: '300.000', isf: null,
  sorteggioRiferimento: null, concertazioneProposaId: null, efficace: false,
  impiantoDenominazione: 'Palestra Volta', spazioDenominazione: 'Campo A',
  giornoSettimana: 6, orarioInizio: '16:00', orarioFine: '20:00', durataMinuti: 240,
};

function renderView(): ReturnType<typeof render> {
  return render(<CalendarioDefinitivoView entities={[ENTITA]} stagioneId="st1" activeEntity={ENTITA} />);
}

describe('CalendarioDefinitivoView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('nessuna stagione selezionata: messaggio dedicato', () => {
    render(<CalendarioDefinitivoView entities={[]} stagioneId={null} activeEntity={null} />);
    expect(screen.getByText(/seleziona una stagione/i)).toBeInTheDocument();
  });

  it('nessuna associazione delegata: messaggio dedicato', () => {
    render(<CalendarioDefinitivoView entities={[]} stagioneId="st1" activeEntity={null} />);
    expect(screen.getByText(/seleziona un'associazione/i)).toBeInTheDocument();
  });

  it('settimana tipo definitiva non ancora approvata: messaggio verbatim dal backend, nessuna griglia', async () => {
    vi.spyOn(sttApi, 'settimanaTipoDefinitiva').mockRejectedValue(
      new ErroreRichiestaApi(409, 'la settimana tipo definitiva non è ancora stata approvata per questa stagione'),
    );
    renderView();

    expect(await screen.findByText(/la settimana tipo definitiva non è ancora stata approvata/i)).toBeInTheDocument();
    expect(screen.queryByText('Palestra Galilei')).not.toBeInTheDocument();
  });

  it('griglia settimanale: fasce nei giorni corretti, riga propria evidenziata, badge tipo ed efficacia', async () => {
    vi.spyOn(sttApi, 'settimanaTipoDefinitiva').mockResolvedValue({ fasce: [FASCIA_PROPRIA, FASCIA_ALTRA], slotLiberi: [] });
    renderView();

    expect(await screen.findByText('Palestra Galilei')).toBeInTheDocument();
    expect(screen.getByText('Tua associazione')).toBeInTheDocument();
    expect(screen.getByText('Efficace')).toBeInTheDocument();
    expect(screen.getByText('In attesa di convenzione')).toBeInTheDocument();
    expect(screen.getByText('Blocco Gara')).toBeInTheDocument();
    expect(screen.getByText('Polisportiva Aterno')).toBeInTheDocument();
  });

  it('giorno senza assegnazioni: messaggio "Nessuna assegnazione"', async () => {
    vi.spyOn(sttApi, 'settimanaTipoDefinitiva').mockResolvedValue({ fasce: [FASCIA_PROPRIA], slotLiberi: [] });
    renderView();

    await screen.findByText('Palestra Galilei');
    expect(screen.getAllByText('Nessuna assegnazione').length).toBeGreaterThan(0);
  });
});
