import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as associazioniApi from '../api/associazioni.ts';
import * as delegheApi from '../api/deleghe.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { AccreditamentoDelegaView } from './AccreditamentoDelegaView.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';

const ENTITA_APPROVATA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 's1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

describe('AccreditamentoDelegaView', () => {
  it('mostra le associazioni reali (non mock), incluso lo stato', () => {
    render(<AccreditamentoDelegaView entities={[ENTITA_APPROVATA]} stagioneId="st1" onRicarica={vi.fn()} />);
    expect(screen.getByText('ASD Test')).toBeInTheDocument();
    expect(screen.getByText(/Approvato/)).toBeInTheDocument();
  });

  it('nessuna associazione: mostra lo stato vuoto', () => {
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={vi.fn()} />);
    expect(screen.getByText(/nessuna associazione accreditata/i)).toBeInTheDocument();
  });

  it('crea associazione: chiama creaAssociazione con stagioneId, poi onRicarica', async () => {
    const spy = vi.spyOn(associazioniApi, 'creaAssociazione').mockResolvedValue({
      id: 'nuova-ass', denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', rnaNumeroIscrizione: null, dataCostituzione: null,
    });
    const onRicarica = vi.fn();
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={onRicarica} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', stagioneId: 'st1' }));
    expect(await vi.waitFor(() => onRicarica)).toHaveBeenCalled();
  });

  it('senza stagioneId selezionato: mostra errore, non chiama creaAssociazione', async () => {
    const spy = vi.spyOn(associazioniApi, 'creaAssociazione');
    render(<AccreditamentoDelegaView entities={[]} stagioneId={null} onRicarica={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(screen.getByText(/seleziona una stagione/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('creazione associazione riuscita ma upload documento fallito: mostra avviso distinto, chiama comunque onRicarica', async () => {
    vi.spyOn(associazioniApi, 'creaAssociazione').mockResolvedValue({
      id: 'nuova-ass', denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', rnaNumeroIscrizione: null, dataCostituzione: null,
    });
    vi.spyOn(associazioniApi, 'caricaDocumento').mockRejectedValue(new ErroreRichiestaApi(415, 'il contenuto del file non è un PDF valido'));
    const onRicarica = vi.fn();
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={onRicarica} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    const file = new File(['contenuto'], 'doc.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/carica documento/i), file);
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(await screen.findByText(/associazione creata, ma il caricamento del documento è fallito/i)).toBeInTheDocument();
    expect(onRicarica).toHaveBeenCalled();
  });

  it('invita delegato: chiama creaSubDelega con lo stagioneId dell\'abilitazione, non uno globale', async () => {
    const spy = vi.spyOn(delegheApi, 'creaSubDelega').mockResolvedValue({
      id: 'del1', personaFisicaId: 'p2', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 's1',
      titolo: 'delegato', ruolo: 'operatore', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: 'a1',
    });
    const onRicarica = vi.fn();
    render(<AccreditamentoDelegaView entities={[ENTITA_APPROVATA]} stagioneId="stagione-diversa-selezionata-in-header" onRicarica={onRicarica} />);

    await userEvent.click(screen.getByRole('button', { name: /invita delegato/i }));
    await userEvent.type(screen.getByLabelText(/codice fiscale/i), 'DLGDLG80A01H501U');
    await userEvent.type(screen.getByLabelText(/^nome/i), 'Nuovo');
    await userEvent.type(screen.getByLabelText(/^cognome/i), 'Delegato');
    await userEvent.click(screen.getByRole('button', { name: /invia invito/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      associazioneId: 'ass1',
      stagioneId: 's1', // = ENTITA_APPROVATA.stagioneId, non "stagione-diversa-selezionata-in-header"
      ruolo: 'operatore',
    }));
    expect(await vi.waitFor(() => onRicarica)).toHaveBeenCalled();
  });

  it('delegante con ruolo operatore: il dropdown non offre l\'opzione rappresentante', async () => {
    const entitaOperatore = { ...ENTITA_APPROVATA, ruolo: 'operatore' as const };
    render(<AccreditamentoDelegaView entities={[entitaOperatore]} stagioneId="st1" onRicarica={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /invita delegato/i }));

    expect(screen.queryByRole('option', { name: /rappresentante/i })).not.toBeInTheDocument();
  });
});
