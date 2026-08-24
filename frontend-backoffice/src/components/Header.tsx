import React from 'react';
import { useNavigate } from 'react-router';
import type { Stagione } from '../api/stagioni.ts';
import { Calendar, Bell, Settings2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.tsx';

interface HeaderProps {
  seasons: Stagione[];
  selectedSeasonId: string;
  setSelectedSeasonId: (id: string) => void;
}

// Creazione/modifica/eliminazione stagioni vivono in StagioniView.tsx (sotto
// Impostazioni) -- questo header resta solo un selettore rapido, niente
// form di creazione inline (era un popup posizionato in modo fragile, oltre
// a duplicare la logica ora anche in StagioniView.tsx).
export const Header: React.FC<HeaderProps> = ({
  seasons,
  selectedSeasonId,
  setSelectedSeasonId,
}) => {
  const { utente } = useAuth();
  const role = utente!.ruolo;
  const navigate = useNavigate();

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
            onClick={() => navigate('/stagioni')}
            title="Gestisci stagioni"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Settings2 size={16} />
            <span>Gestisci stagioni</span>
          </button>
        )}
      </div>

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
