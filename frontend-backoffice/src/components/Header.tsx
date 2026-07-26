import React from 'react';
import { Season, Role } from '../types';
import { Calendar, UserCheck, Bell, Shield, HelpCircle } from 'lucide-react';

interface HeaderProps {
  seasons: Season[];
  selectedSeasonId: string;
  setSelectedSeasonId: (id: string) => void;
  role: Role;
  setRole: (role: Role) => void;
}

export const Header: React.FC<HeaderProps> = ({
  seasons,
  selectedSeasonId,
  setSelectedSeasonId,
  role,
  setRole
}) => {
  const currentSeason = seasons.find(s => s.id === selectedSeasonId) || seasons[0];

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
          {seasons.map(s => (
            <option key={s.id} value={s.id}>
              {s.nome} ({s.stato.toUpperCase()})
            </option>
          ))}
        </select>
        <span className="badge badge-info" style={{ textTransform: 'uppercase', fontSize: '0.725rem' }}>
          Fase {currentSeason.faseCorrenteNum} di 16
        </span>
      </div>

      {/* Right: Role switcher & User profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Role Toggle Button */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: '#F1F5F9',
          borderRadius: '20px',
          padding: '2px',
          border: '1px solid #E2E8F0'
        }}>
          <button
            onClick={() => setRole('operatore')}
            style={{
              padding: '0.3rem 0.75rem',
              borderRadius: '16px',
              border: 'none',
              fontSize: '0.775rem',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: role === 'operatore' ? 'var(--pa-blue-primary)' : 'transparent',
              color: role === 'operatore' ? 'white' : 'var(--pa-text-muted)',
              transition: 'all 0.15s ease'
            }}
          >
            Operatore
          </button>
          <button
            onClick={() => setRole('admin')}
            style={{
              padding: '0.3rem 0.75rem',
              borderRadius: '16px',
              border: 'none',
              fontSize: '0.775rem',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: role === 'admin' ? 'var(--pa-blue-dark)' : 'transparent',
              color: role === 'admin' ? 'white' : 'var(--pa-text-muted)',
              transition: 'all 0.15s ease'
            }}
          >
            Admin
          </button>
        </div>

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
            MR
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)', lineHeight: 1.1 }}>
              Mario Rossi
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
