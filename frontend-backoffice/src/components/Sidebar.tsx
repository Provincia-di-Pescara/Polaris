import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Layers,
  Building2,
  FileCheck2,
  Settings2,
  ShieldCheck,
  BarChart3,
  LogOut,
  Landmark,
  Users,
  DatabaseBackup,
  CalendarRange,
  Database,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.tsx';
import { listaDeleghe } from '../api/deleghe.ts';

interface VoceSemplice {
  tipo: 'link';
  id: string;
  label: string;
  icon: typeof Layers;
  roles: Array<'admin' | 'operatore'>;
  badge?: string;
}

interface VoceGruppo {
  tipo: 'gruppo';
  id: string;
  label: string;
  icon: typeof Layers;
  roles: Array<'admin' | 'operatore'>;
  figli: Array<{ id: string; label: string; icon: typeof Layers }>;
}

export const Sidebar: React.FC = () => {
  const { utente, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const role = utente!.ruolo;
  const currentTab = location.pathname === '/' ? 'control-room' : location.pathname.replace(/^\//, '');

  const [delegheInAttesa, setDelegheInAttesa] = useState(0);
  useEffect(() => {
    listaDeleghe({ stato: 'in_attesa' })
      .then((deleghe) => setDelegheInAttesa(deleghe.length))
      .catch(() => setDelegheInAttesa(0));
  }, []);

  const menuItems: Array<VoceSemplice | VoceGruppo> = [
    { tipo: 'link', id: 'control-room', label: 'Control Room Procedura', icon: Layers, roles: ['admin', 'operatore'] },
    { tipo: 'link', id: 'impianti-spazi', label: 'Impianti & Spazi Sportivi', icon: Building2, roles: ['admin', 'operatore'] },
    {
      tipo: 'link',
      id: 'deleghe-accreditamenti',
      label: 'Deleghe & Accreditamenti',
      icon: FileCheck2,
      roles: ['admin', 'operatore'],
      ...(delegheInAttesa > 0 ? { badge: String(delegheInAttesa) } : {}),
    },
    {
      tipo: 'gruppo',
      id: 'impostazioni',
      label: 'Impostazioni',
      icon: Settings2,
      roles: ['admin'],
      figli: [
        { id: 'parametri-sistema', label: 'Parametri di Sistema', icon: Settings2 },
        { id: 'impostazioni-oidc', label: 'OIDC (SPID/CIE)', icon: ShieldCheck },
        { id: 'utenti', label: 'Utenti Backoffice', icon: Users },
        { id: 'backup', label: 'Backup & Ripristino', icon: DatabaseBackup },
        { id: 'stagioni', label: 'Stagioni', icon: CalendarRange },
        { id: 'fonte-dati', label: 'Fonte Dati', icon: Database },
      ],
    },
    { tipo: 'link', id: 'audit-sorteggio', label: 'Audit Log & Sorteggi HMAC', icon: ShieldCheck, roles: ['admin', 'operatore'] },
    { tipo: 'link', id: 'statistiche', label: 'Analisi & Statistiche', icon: BarChart3, roles: ['admin', 'operatore'] },
  ];

  const idFigliImpostazioni = menuItems.find((v): v is VoceGruppo => v.tipo === 'gruppo')?.figli.map((f) => f.id) ?? [];
  const [impostazioniAperte, setImpostazioniAperte] = useState(idFigliImpostazioni.includes(currentTab));

  return (
    <aside style={{
      width: '270px',
      backgroundColor: 'var(--pa-blue-dark)',
      color: 'white',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      boxShadow: '4px 0 10px rgba(0,0,0,0.05)'
    }}>
      {/* Header Logo */}
      <div style={{
        padding: '1.5rem 1.25rem',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem'
      }}>
        <div style={{
          width: '42px',
          height: '42px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #00C5CA 0%, #0066CC 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
        }}>
          <Landmark size={24} color="white" />
        </div>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.05em', lineHeight: 1 }}>POLARIS</div>
          <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '2px', fontWeight: 500 }}>Provincia di Pescara</div>
        </div>
      </div>

      {/* Role Indicator Banner */}
      <div style={{
        margin: '1rem 1.25rem 0.5rem',
        padding: '0.5rem 0.75rem',
        borderRadius: '6px',
        backgroundColor: role === 'admin' ? 'rgba(0, 197, 202, 0.15)' : 'rgba(255, 255, 255, 0.1)',
        border: `1px solid ${role === 'admin' ? 'var(--pa-accent)' : 'rgba(255,255,255,0.2)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.8rem'
      }}>
        <span style={{ opacity: 0.8 }}>Ruolo Attivo:</span>
        <span style={{
          fontWeight: 700,
          color: role === 'admin' ? 'var(--pa-accent)' : '#F1F5F9',
          textTransform: 'uppercase',
          fontSize: '0.75rem'
        }}>
          {role === 'admin' ? 'Amministratore' : 'Operatore'}
        </span>
      </div>

      {/* Navigation Links */}
      <nav style={{ flex: 1, padding: '1rem 0.75rem' }}>
        {menuItems
          .filter(item => item.roles.includes(role))
          .map(item => {
            const Icon = item.icon;

            if (item.tipo === 'gruppo') {
              const gruppoAttivo = item.figli.some((f) => f.id === currentTab);
              return (
                <div key={item.id} style={{ marginBottom: '0.4rem' }}>
                  <button
                    type="button"
                    onClick={() => setImpostazioniAperte((v) => !v)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem 1rem',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: gruppoAttivo && !impostazioniAperte ? 'var(--pa-blue-primary)' : 'transparent',
                      color: gruppoAttivo ? 'white' : 'rgba(255,255,255,0.75)',
                      cursor: 'pointer',
                      fontWeight: gruppoAttivo ? 600 : 400,
                      fontSize: '0.875rem',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Icon size={18} />
                      <span>{item.label}</span>
                    </div>
                    {impostazioniAperte ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  {impostazioniAperte && (
                    <div style={{ paddingLeft: '1.1rem', marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {item.figli.map((figlio) => {
                        const FiglioIcon = figlio.icon;
                        const isActive = currentTab === figlio.id;
                        return (
                          <button
                            key={figlio.id}
                            type="button"
                            onClick={() => navigate(`/${figlio.id}`)}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.65rem',
                              padding: '0.6rem 0.85rem',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: isActive ? 'var(--pa-blue-primary)' : 'transparent',
                              color: isActive ? 'white' : 'rgba(255,255,255,0.65)',
                              cursor: 'pointer',
                              fontWeight: isActive ? 600 : 400,
                              fontSize: '0.82rem',
                              textAlign: 'left'
                            }}
                          >
                            <FiglioIcon size={15} />
                            <span>{figlio.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(`/${item.id}`)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  marginBottom: '0.4rem',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: isActive ? 'var(--pa-blue-primary)' : 'transparent',
                  color: isActive ? 'white' : 'rgba(255,255,255,0.75)',
                  cursor: 'pointer',
                  fontWeight: isActive ? 600 : 400,
                  fontSize: '0.875rem',
                  transition: 'all 0.15s ease',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.color = 'white';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.75)';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span style={{
                    backgroundColor: '#E74C3C',
                    color: 'white',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    borderRadius: '10px',
                    padding: '0.1rem 0.45rem'
                  }}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
      </nav>

      {/* Footer / Logout — la versione è nel footer di BackofficeLayout (dato
          reale da APP_VERSION, non duplicata qui). "Versione POLARIS v2.4.0" e
          "Engine Go: Connected" erano testo fisso ereditato dal mock originale,
          mai stati dati veri — rimossi (bug trovato in produzione 2026-08-23). */}
      <div style={{
        padding: '1rem 1.25rem',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        fontSize: '0.75rem',
        color: 'rgba(255,255,255,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem'
      }}>
        <button
          onClick={() => logout()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginTop: '0.5rem',
            padding: '0.5rem 0.6rem',
            borderRadius: '6px',
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.75)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            textAlign: 'left'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = 'white';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'rgba(255,255,255,0.75)';
          }}
        >
          <LogOut size={16} />
          <span>Esci</span>
        </button>
      </div>
    </aside>
  );
};
