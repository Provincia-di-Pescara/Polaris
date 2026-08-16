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
