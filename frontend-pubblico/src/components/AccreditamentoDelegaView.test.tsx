import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as associazioniApi from '../api/associazioni.ts';
import * as delegheApi from '../api/deleghe.ts';
import * as organismiApi from '../api/organismiSportivi.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { AccreditamentoDelegaView } from './AccreditamentoDelegaView.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import type { Associazione } from '../api/associazioni.ts';
import type { PersonaAutenticata } from '../api/auth.ts';

// Nome/cognome combaciano con quelli usati come Rappresentante Legale in
// compilaCampiObbligatoriAssociazione() più sotto: la validazione anti-frode
// lato client (Finding 2 della code review finale del branch) confronterebbe
// altrimenti un mismatch e bloccherebbe ogni submit dei test esistenti.
const PERSONA_MOCK: PersonaAutenticata = { sub: 'p1', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi' };

const ENTITA_APPROVATA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 's1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

const ASSOCIAZIONE_MOCK_COMPLETA: Associazione = {
  id: 'nuova-ass', denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', rnaNumeroIscrizione: null, dataCostituzione: null,
  rappresentanteLegaleNome: 'Mario', rappresentanteLegaleCognome: 'Rossi', delegatoNome: null, delegatoCognome: null,
  indirizzoVia: 'Via Roma', indirizzoCivico: '1', indirizzoCitta: 'Pescara', pec: null, email: 'asd@example.com',
  tipologiaSoggetto: 'associazione_sportiva', iscrittaRasd: false, organismoSportivoCodice: null, codiceAffiliazione: null,
  haPersonaleAssunto: false,
};

// Riempie tutti i campi obbligatori del form di creazione associazione tranne
// denominazione/CF (compilati separatamente da ciascun test) e i campi
// condizionali (RASD, RCO) che sono coperti da test dedicati. Usa fireEvent
// direttamente sugli id (anziché getByLabelText, che sarebbe ambiguo: più
// sezioni condividono etichette come "Nome:"/"Cognome:") per evitare le
// stranezze di userEvent.type sugli input type="date" in jsdom.
function compilaCampiObbligatoriAssociazione(): void {
  const set = (id: string, value: string): void => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Campo #${id} non trovato`);
    fireEvent.change(el, { target: { value } });
  };
  set('acc-rl-nome', 'Mario');
  set('acc-rl-cognome', 'Rossi');
  set('acc-indirizzo-via', 'Via Roma');
  set('acc-indirizzo-civico', '1');
  set('acc-indirizzo-citta', 'Pescara');
  set('acc-email', 'asd@example.com');
  set('acc-rct-compagnia', 'Generali');
  set('acc-rct-polizza', 'POL123');
  set('acc-rct-massimale', '1000000.00');
  set('acc-rct-dal', '2026-01-01');
  set('acc-rct-al', '2027-01-01');
  set('acc-sic-nome', 'Luigi');
  set('acc-sic-cognome', 'Verdi');
  set('acc-sic-nato-a', 'Pescara');
  set('acc-sic-nato-il', '1980-01-01');
  set('acc-sic-via', 'Via Milano');
  set('acc-sic-citta', 'Pescara');
  set('acc-sic-cellulare', '3331234567');
  set('acc-sic-cid', 'AB1234567');
  set('acc-eme-nome', 'Anna');
  set('acc-eme-cognome', 'Bianchi');
  set('acc-eme-nato-a', 'Pescara');
  set('acc-eme-nato-il', '1985-05-05');
  set('acc-eme-via', 'Via Napoli');
  set('acc-eme-citta', 'Pescara');
  set('acc-eme-cellulare', '3339876543');
  set('acc-eme-cid', 'CD7654321');
  set('acc-dae-marca', 'Philips');
  set('acc-dae-matricola', 'DAE001');
  set('acc-dae-scadenza', '2028-01-01');
}

describe('AccreditamentoDelegaView', () => {
  it('mostra le associazioni reali (non mock), incluso lo stato', () => {
    render(<AccreditamentoDelegaView entities={[ENTITA_APPROVATA]} stagioneId="st1" onRicarica={vi.fn()} persona={PERSONA_MOCK} />);
    expect(screen.getByText('ASD Test')).toBeInTheDocument();
    expect(screen.getByText(/Approvato/)).toBeInTheDocument();
  });

  it('nessuna associazione: mostra lo stato vuoto', () => {
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={vi.fn()} persona={PERSONA_MOCK} />);
    expect(screen.getByText(/nessuna associazione accreditata/i)).toBeInTheDocument();
  });

  it('crea associazione: chiama creaAssociazione con stagioneId, poi onRicarica', async () => {
    const spy = vi.spyOn(associazioniApi, 'creaAssociazione').mockResolvedValue(ASSOCIAZIONE_MOCK_COMPLETA);
    const onRicarica = vi.fn();
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={onRicarica} persona={PERSONA_MOCK} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    compilaCampiObbligatoriAssociazione();
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ denominazione: 'ASD Nuova', codiceFiscalePartitaIva: '123', stagioneId: 'st1' }));
    expect(await vi.waitFor(() => onRicarica)).toHaveBeenCalled();
  });

  it('senza stagioneId selezionato: il bottone "richiedi nuova delega" resta disabilitato, mai chiamata creaAssociazione', () => {
    // Bug reale trovato 2026-08-24: prima si poteva compilare l'intero form
    // (denominazione, CF, tutti i campi obbligatori, upload documento) e
    // scoprire solo al submit che mancava la stagione -- ora il bottone che
    // apre il form resta disabilitato finché non c'è una stagione selezionata
    // (l'errore a submit-time in handleSubmit resta come difesa in profondità,
    // non più il percorso normale).
    render(<AccreditamentoDelegaView entities={[]} stagioneId={null} onRicarica={vi.fn()} persona={PERSONA_MOCK} />);

    expect(screen.getByRole('button', { name: /richiedi nuova delega/i })).toBeDisabled();
  });

  it('creazione associazione riuscita ma upload documento fallito: mostra avviso distinto, chiama comunque onRicarica', async () => {
    vi.spyOn(associazioniApi, 'creaAssociazione').mockResolvedValue(ASSOCIAZIONE_MOCK_COMPLETA);
    vi.spyOn(associazioniApi, 'caricaDocumento').mockRejectedValue(new ErroreRichiestaApi(415, 'il contenuto del file non è un PDF valido'));
    const onRicarica = vi.fn();
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={onRicarica} persona={PERSONA_MOCK} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    compilaCampiObbligatoriAssociazione();
    const file = new File(['contenuto'], 'doc.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/carica documento/i), file);
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(await screen.findByText(/associazione creata, ma il caricamento del documento è fallito/i)).toBeInTheDocument();
    expect(onRicarica).toHaveBeenCalled();
  });

  it('select organismo sportivo: nascosto finché RASD non è selezionato', async () => {
    vi.spyOn(organismiApi, 'listaOrganismiSportivi').mockResolvedValue([
      { codice: 'CONI', denominazione: 'CONI' },
    ]);
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={vi.fn()} persona={PERSONA_MOCK} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));

    expect(document.getElementById('acc-organismo-sportivo')).not.toBeInTheDocument();
    expect(document.getElementById('acc-codice-affiliazione')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/RASD/i));

    expect(document.getElementById('acc-organismo-sportivo')).toBeInTheDocument();
    expect(document.getElementById('acc-codice-affiliazione')).toBeInTheDocument();
  });

  it('campi RCO: nascosti finché "ha personale assunto" non è selezionato', async () => {
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={vi.fn()} persona={PERSONA_MOCK} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));

    expect(document.getElementById('acc-rco-compagnia')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/l'associazione ha personale assunto/i));

    expect(document.getElementById('acc-rco-compagnia')).toBeInTheDocument();
    expect(document.getElementById('acc-rco-polizza')).toBeInTheDocument();
  });

  it('submit con tutti i campi compilati: creaAssociazione riceve referenti/assicurazioni', async () => {
    const spy = vi.spyOn(associazioniApi, 'creaAssociazione').mockResolvedValue(ASSOCIAZIONE_MOCK_COMPLETA);
    render(<AccreditamentoDelegaView entities={[]} stagioneId="st1" onRicarica={vi.fn()} persona={PERSONA_MOCK} />);

    await userEvent.click(screen.getByRole('button', { name: /richiedi nuova delega/i }));
    await userEvent.type(screen.getByLabelText(/denominazione ufficiale/i), 'ASD Nuova');
    await userEvent.type(screen.getByLabelText(/codice fiscale \/ p\.iva/i), '123');
    compilaCampiObbligatoriAssociazione();
    await userEvent.click(screen.getByRole('button', { name: /invia delega/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      referenteSicurezza: expect.objectContaining({
        nome: 'Luigi', cognome: 'Verdi', natoA: 'Pescara', natoIl: '1980-01-01',
        residenteVia: 'Via Milano', residenteCitta: 'Pescara', cellulare: '3331234567', cartaIdentita: 'AB1234567',
      }),
      referenteEmergenzeDae: expect.objectContaining({
        nome: 'Anna', cognome: 'Bianchi',
        daeMarca: 'Philips', daeMatricola: 'DAE001', daeScadenza: '2028-01-01',
      }),
      assicurazioneRct: expect.objectContaining({
        compagnia: 'Generali', numeroPolizza: 'POL123', massimale: '1000000.00', coperturaDal: '2026-01-01', coperturaAl: '2027-01-01',
      }),
    }));
  });

  it('invita delegato: chiama creaSubDelega con lo stagioneId dell\'abilitazione, non uno globale', async () => {
    const spy = vi.spyOn(delegheApi, 'creaSubDelega').mockResolvedValue({
      id: 'del1', personaFisicaId: 'p2', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 's1',
      titolo: 'delegato', ruolo: 'operatore', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: 'a1',
    });
    const onRicarica = vi.fn();
    render(<AccreditamentoDelegaView entities={[ENTITA_APPROVATA]} stagioneId="stagione-diversa-selezionata-in-header" onRicarica={onRicarica} persona={PERSONA_MOCK} />);

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
    render(<AccreditamentoDelegaView entities={[entitaOperatore]} stagioneId="st1" onRicarica={vi.fn()} persona={PERSONA_MOCK} />);

    await userEvent.click(screen.getByRole('button', { name: /invita delegato/i }));

    expect(screen.queryByRole('option', { name: /rappresentante/i })).not.toBeInTheDocument();
  });

  it('annullare un invito con ruolo "rappresentante" non deve far trapelare lo stato su un\'altra associazione', async () => {
    const entitaOperatore = { ...ENTITA_APPROVATA, id: 'a2', associazioneId: 'ass2', ruolo: 'operatore' as const, associazioneDenominazione: 'ASD Altra' };
    const spy = vi.spyOn(delegheApi, 'creaSubDelega').mockResolvedValue({
      id: 'del1', personaFisicaId: 'p2', associazioneId: 'ass2', istituzioneScolasticaId: null, stagioneId: 's1',
      titolo: 'delegato', ruolo: 'operatore', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: 'a2',
    });
    render(<AccreditamentoDelegaView entities={[ENTITA_APPROVATA, entitaOperatore]} stagioneId="st1" onRicarica={vi.fn()} persona={PERSONA_MOCK} />);

    // Apre il modale sull'associazione dove l'utente è 'rappresentante',
    // seleziona il ruolo 'rappresentante', poi annulla.
    const invitaButtons = screen.getAllByRole('button', { name: /invita delegato/i });
    await userEvent.click(invitaButtons[0]!);
    await userEvent.selectOptions(screen.getByLabelText(/ruolo/i), 'rappresentante');
    await userEvent.click(screen.getByRole('button', { name: /annulla/i }));

    // Riapre il modale su un'altra associazione dove l'utente è solo 'operatore'.
    await userEvent.click(screen.getAllByRole('button', { name: /invita delegato/i })[1]!);
    expect(screen.getByLabelText(/ruolo/i)).toHaveValue('operatore');
    expect(screen.queryByRole('option', { name: /rappresentante/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/codice fiscale/i), 'DLGDLG80A01H501U');
    await userEvent.type(screen.getByLabelText(/^nome/i), 'Nuovo');
    await userEvent.type(screen.getByLabelText(/^cognome/i), 'Delegato');
    await userEvent.click(screen.getByRole('button', { name: /invia invito/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ ruolo: 'operatore' }));
  });
});
