import React from 'react';
import type { PersonaAutenticata } from '../api/auth.ts';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import { Landmark, ShieldCheck, User, Building, FileCheck2, Calculator, BarChart2, RefreshCw, Calendar, LogOut } from 'lucide-react';

interface HeaderProps {
  persona: PersonaAutenticata;
  entities: EntitaRappresentata[];
  activeEntity: EntitaRappresentata | null;
  setActiveEntity: (e: EntitaRappresentata) => void;
  activeTab: string;
  setActiveTab: (t: string) => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  persona,
  entities,
  activeEntity,
  setActiveEntity,
  activeTab,
  setActiveTab,
  onLogout
}) => {
  // Lo switcher lascia scegliere solo tra le entità con delega approvata: una
  // delega in_attesa/respinta/revocata non deve mai poter diventare il contesto
  // operativo attivo (vedi finding 5 review finale).
  const entitaApprovate = entities.filter(e => e.stato === 'approvata');
  return (
    <header style={{ backgroundColor: 'var(--pa-blue-dark)', color: 'white' }}>
      {/* Top Identity Bar */}
      <div style={{
        backgroundColor: '#001E3D',
        padding: '0.4rem 1.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.775rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: 0.85 }}>
          <Landmark size={14} color="var(--pa-accent)" />
          <span>Provincia di Pescara — Piattaforma Telematici Spazi Sportivi POLARIS</span>
        </div>

        {/* Authenticated User Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <span className="badge badge-info" style={{ backgroundColor: 'rgba(0, 197, 202, 0.2)', color: 'var(--pa-accent)', border: '1px solid var(--pa-accent)' }}>
            <ShieldCheck size={12} /> Identità Digitale Verificata
          </span>
          <span style={{ fontWeight: 600 }}>{persona.nome} {persona.cognome} (CF: {persona.codiceFiscale})</span>
          <button
            onClick={onLogout}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <LogOut size={14} />
            <span>Esci</span>
          </button>
        </div>
      </div>

      {/* Main Header Banner */}
      <div style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #00C5CA 0%, #0066CC 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
          }}>
            <Landmark size={26} color="white" />
          </div>
          <div>
            <h1 style={{ color: 'white', fontSize: '1.4rem', margin: 0 }}>POLARIS — Portale Spazi Sportivi</h1>
            <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '2px' }}>
              Assegnazione Palestre Scolastiche Provinciali • Stagione 2026/2027
            </div>
          </div>
        </div>

        {/* Active Represented Entity Switcher */}
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '8px',
          padding: '0.5rem 0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <Building size={20} color="var(--pa-accent)" />
          <div>
            <div style={{ fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', fontWeight: 600 }}>Stai Operando per:</div>
            {entitaApprovate.length === 0 ? (
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Nessuna associazione accreditata</div>
            ) : activeEntity ? (
              <select
                value={activeEntity.id}
                onChange={(e) => {
                  const found = entitaApprovate.find(ent => ent.id === e.target.value);
                  if (found) setActiveEntity(found);
                }}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: '0.925rem',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {entitaApprovate.map(ent => (
                  <option key={ent.id} value={ent.id} style={{ color: 'black' }}>
                    {ent.associazioneDenominazione ?? '—'} ({ent.stato})
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
      </div>

      {/* Portal Navigation Tabs */}
      <nav style={{
        display: 'flex',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '0 1.5rem',
        overflowX: 'auto'
      }}>
        {[
          { id: 'accreditamento', label: 'Deleghe & Rappresentanze', icon: FileCheck2 },
          { id: 'domanda-wizard', label: 'Presentazione Domanda', icon: Calculator },
          { id: 'esiti-isf', label: 'Esiti & Punteggio ISF', icon: BarChart2 },
          { id: 'concertazione', label: 'Concertazione Scambi (Fase 11)', icon: RefreshCw, badge: 'OFFERTA' },
          { id: 'calendario-definitivo', label: 'Settimana Tipo Assegnata', icon: Calendar }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.85rem 1.25rem',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: isActive ? '3px solid var(--pa-accent)' : '3px solid transparent',
                color: isActive ? 'white' : 'rgba(255,255,255,0.7)',
                fontWeight: isActive ? 700 : 500,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap'
              }}
            >
              <Icon size={17} color={isActive ? 'var(--pa-accent)' : 'currentColor'} />
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="badge badge-warning" style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
