import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header.tsx';
import type { EntitaRappresentata } from '../api/deleghe.ts';

const PERSONA = { sub: 'p1', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi' };
const ENTITA: EntitaRappresentata = {
  id: 'a1', personaFisicaId: 'p1', associazioneId: 'ass1', istituzioneScolasticaId: null, stagioneId: 's1',
  titolo: 'legale_rappresentante', ruolo: 'rappresentante', stato: 'approvata', motivazione: null, creataDaAbilitazioneId: null,
  personaFisicaNome: 'Mario', personaFisicaCognome: 'Rossi', personaFisicaCodiceFiscale: 'RSSMRA80A01H501U',
  associazioneDenominazione: 'ASD Test', associazioneCodiceFiscalePartitaIva: '01234567890',
};

describe('Header', () => {
  it('mostra la persona reale, non hardcoded', () => {
    render(
      <Header persona={PERSONA} entities={[ENTITA]} activeEntity={ENTITA} setActiveEntity={vi.fn()}
        activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={vi.fn()} />,
    );
    expect(screen.getByText(/Mario Rossi/)).toBeInTheDocument();
    expect(screen.queryByText(/Marco Rossi/)).not.toBeInTheDocument();
  });

  it('nessuna entità: mostra lo stato vuoto invece dello switcher', () => {
    render(
      <Header persona={PERSONA} entities={[]} activeEntity={null} setActiveEntity={vi.fn()}
        activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={vi.fn()} />,
    );
    expect(screen.getByText(/nessuna associazione accreditata/i)).toBeInTheDocument();
  });

  it('entità non approvata (es. revocata): non selezionabile nello switcher, stato vuoto mostrato', () => {
    const entitaRevocata: EntitaRappresentata = { ...ENTITA, id: 'a2', stato: 'revocata' };
    render(
      <Header persona={PERSONA} entities={[entitaRevocata]} activeEntity={null} setActiveEntity={vi.fn()}
        activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={vi.fn()} />,
    );
    expect(screen.getByText(/nessuna associazione accreditata/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('entità mista (approvata + revocata): lo switcher offre solo quella approvata', () => {
    const entitaRevocata: EntitaRappresentata = { ...ENTITA, id: 'a2', associazioneDenominazione: 'ASD Revocata', stato: 'revocata' };
    render(
      <Header persona={PERSONA} entities={[ENTITA, entitaRevocata]} activeEntity={ENTITA} setActiveEntity={vi.fn()}
        activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={vi.fn()} />,
    );
    expect(screen.getByText(/ASD Test/)).toBeInTheDocument();
    expect(screen.queryByText(/ASD Revocata/)).not.toBeInTheDocument();
  });

  it('bottone logout chiama onLogout', async () => {
    const onLogout = vi.fn();
    render(
      <Header persona={PERSONA} entities={[ENTITA]} activeEntity={ENTITA} setActiveEntity={vi.fn()}
        activeTab="accreditamento" setActiveTab={vi.fn()} onLogout={onLogout} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /esci|logout/i }));
    expect(onLogout).toHaveBeenCalled();
  });
});
