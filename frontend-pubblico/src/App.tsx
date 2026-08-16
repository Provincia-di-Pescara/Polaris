import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.tsx';
import { LoginView } from './components/LoginView.tsx';
import { OidcCallbackView } from './components/OidcCallbackView.tsx';
import { Header } from './components/Header.tsx';
import { AccreditamentoDelegaView } from './components/AccreditamentoDelegaView';
import { WizardDomandaView } from './components/WizardDomandaView';
import { EsitiIsfView } from './components/EsitiIsfView';
import { ConcertazioneView } from './components/ConcertazioneView';
import { CalendarioDefinitivoView } from './components/CalendarioDefinitivoView';
import type { EntitaRappresentata } from './api/deleghe.ts';

const AppAutenticata: React.FC = () => {
  const { persona, entities, caricamento, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('accreditamento');
  const [activeEntity, setActiveEntity] = useState<EntitaRappresentata | null>(null);

  useEffect(() => {
    // Auto-seleziona solo tra le entità con delega approvata: una entità
    // in_attesa/respinta/revocata non deve mai diventare il contesto operativo
    // attivo di default (vedi anche il filtro nello switcher in Header.tsx).
    const entitaApprovate = entities.filter((e) => e.stato === 'approvata');
    if (entitaApprovate.length > 0 && !activeEntity) {
      setActiveEntity(entitaApprovate[0]!);
    }
  }, [entities, activeEntity]);

  if (caricamento) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Caricamento…</div>;
  }

  if (!persona) {
    return <LoginView />;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--pa-bg-gray)', display: 'flex', flexDirection: 'column' }}>
      <Header
        persona={persona}
        entities={entities}
        activeEntity={activeEntity}
        setActiveEntity={setActiveEntity}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={logout}
      />

      <main style={{ flex: 1, paddingBottom: '3rem' }}>
        {/* entities={[]}/onAddNewEntity no-op sono placeholder deliberati: la
            forma di RepresentedEntity (mock interno alla view) è incompatibile
            con EntitaRappresentata reale — un blocco futuro adatterà la view ai
            dati reali di AuthContext. Per ora la view resta sul proprio mock
            interno. */}
        {activeTab === 'accreditamento' && <AccreditamentoDelegaView entities={[]} onAddNewEntity={() => {}} />}
        {activeTab === 'domanda-wizard' && <WizardDomandaView />}
        {activeTab === 'esiti-isf' && <EsitiIsfView />}
        {activeTab === 'concertazione' && <ConcertazioneView />}
        {activeTab === 'calendario-definitivo' && <CalendarioDefinitivoView />}
      </main>

      <footer style={{
        backgroundColor: 'var(--pa-blue-dark)',
        color: 'rgba(255,255,255,0.7)',
        padding: '1.5rem',
        fontSize: '0.8rem',
        textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div><strong>POLARIS</strong> — Provincia di Pescara • Servizio Pubblico Spazi Sportivi Scolastici</div>
          <div>Conforme Linee Guida AgID & Italia Design System • Accessibilità WCAG 2.1 AA</div>
        </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  const [inCallback] = useState(window.location.pathname === '/oidc/callback');
  const [callbackCompletato, setCallbackCompletato] = useState(false);

  if (inCallback && !callbackCompletato) {
    return <OidcCallbackView onCompletato={() => setCallbackCompletato(true)} />;
  }

  return (
    <AuthProvider>
      <AppAutenticata />
    </AuthProvider>
  );
};
