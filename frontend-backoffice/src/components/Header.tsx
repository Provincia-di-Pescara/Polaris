import React, { useState } from 'react';
import { creaStagione, type Stagione } from '../api/stagioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { Calendar, Bell, Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.tsx';

interface HeaderProps {
  seasons: Stagione[];
  selectedSeasonId: string;
  setSelectedSeasonId: (id: string) => void;
  // Richiamato con l'id della stagione appena creata: il chiamante (BackofficeLayout)
  // ricarica la lista e la seleziona — nessuno stato di "stagioni" duplicato qui.
  onStagioneCreata: (nuovoId: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  seasons,
  selectedSeasonId,
  setSelectedSeasonId,
  onStagioneCreata,
}) => {
  const { utente } = useAuth();
  const role = utente!.ruolo;

  const [formAperto, setFormAperto] = useState(false);
  const [nome, setNome] = useState('');
  const [dataInizio, setDataInizio] = useState('');
  const [dataFine, setDataFine] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const handleCreaStagione = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      const nuova = await creaStagione({ nome, dataInizio, dataFine });
      setNome('');
      setDataInizio('');
      setDataFine('');
      setFormAperto(false);
      onStagioneCreata(nuova.id);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante la creazione.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <header style={{
      height: '64px',
      backgroundColor: 'white',
      borderBottom: '1px solid var(--pa-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 1.75rem',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      {/* Left: Season selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--pa-blue-dark)', fontWeight: 600, fontSize: '0.9rem' }}>
          <Calendar size={18} color="var(--pa-blue-primary)" />
          <span>Stagione Operativa:</span>
        </div>
        <select
          value={selectedSeasonId}
          onChange={(e) => setSelectedSeasonId(e.target.value)}
          className="form-control"
          style={{
            width: 'auto',
            fontWeight: 600,
            padding: '0.4rem 0.8rem',
            borderColor: 'var(--pa-blue-primary)',
            color: 'var(--pa-blue-dark)',
            cursor: 'pointer'
          }}
        >
          {seasons.length === 0 && <option value="">Nessuna stagione</option>}
          {seasons.map(s => (
            <option key={s.id} value={s.id}>
              {s.nome} ({s.stato.toUpperCase()})
            </option>
          ))}
        </select>

        {role === 'admin' && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFormAperto((v) => !v)}
            title="Nuova stagione"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Plus size={16} />
            <span>Nuova stagione</span>
          </button>
        )}
      </div>

      {formAperto && (
        <form
          onSubmit={handleCreaStagione}
          style={{
            position: 'absolute',
            top: '64px',
            left: '1.75rem',
            zIndex: 200,
            backgroundColor: 'white',
            border: '1px solid var(--pa-border)',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            width: '320px',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--pa-blue-dark)' }}>Nuova stagione sportiva</div>

          <div className="form-group">
            <label className="form-label" htmlFor="header-stagione-nome">Nome</label>
            <input
              id="header-stagione-nome"
              className="form-control"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="header-stagione-inizio">Data inizio</label>
            <input
              id="header-stagione-inizio"
              type="date"
              className="form-control"
              value={dataInizio}
              onChange={(e) => setDataInizio(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="header-stagione-fine">Data fine</label>
            <input
              id="header-stagione-fine"
              type="date"
              className="form-control"
              value={dataFine}
              onChange={(e) => setDataFine(e.target.value)}
              required
            />
          </div>

          {errore && (
            <div style={{
              backgroundColor: 'var(--pa-danger-bg)',
              color: 'var(--pa-danger)',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
            }}>
              {errore}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary" disabled={inCorso}>
              {inCorso ? 'Creazione…' : 'Crea'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setFormAperto(false)}>
              Annulla
            </button>
          </div>
        </form>
      )}

      {/* Right: User profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Notifications Icon */}
        <div style={{ position: 'relative', cursor: 'pointer' }}>
          <Bell size={20} color="var(--pa-text-muted)" />
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#E74C3C'
          }} />
        </div>

        {/* User Card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', borderLeft: '1px solid #E2E8F0', paddingLeft: '1.25rem' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: 'var(--pa-blue-light)',
            color: 'var(--pa-blue-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '0.85rem'
          }}>
            {utente!.email.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)', lineHeight: 1.1 }}>
              {utente!.email}
            </span>
            <span style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)', marginTop: '2px' }}>
              {role === 'admin' ? 'Amministratore Sistema' : 'Funzionario Servizio Sport'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
