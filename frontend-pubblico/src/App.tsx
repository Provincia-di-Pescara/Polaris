import React, { useState } from 'react';
import { Header } from './components/Header';
import { AccreditamentoDelegaView } from './components/AccreditamentoDelegaView';
import { WizardDomandaView } from './components/WizardDomandaView';
import { EsitiIsfView } from './components/EsitiIsfView';
import { ConcertazioneView } from './components/ConcertazioneView';
import { CalendarioDefinitivoView } from './components/CalendarioDefinitivoView';
import { mockRepresentedEntities } from './mockData';
import { RepresentedEntity } from './types';

export const App: React.FC = () => {
  const [entities, setEntities] = useState<RepresentedEntity[]>(mockRepresentedEntities);
  const [activeEntity, setActiveEntity] = useState<RepresentedEntity>(mockRepresentedEntities[0]);
  const [activeTab, setActiveTab] = useState<string>('accreditamento');

  const handleAddNewEntity = (newEnt: RepresentedEntity) => {
    setEntities(prev => [newEnt, ...prev]);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--pa-bg-gray)', display: 'flex', flexDirection: 'column' }}>
      {/* Italia PA Banner Header */}
      <Header
        entities={entities}
        activeEntity={activeEntity}
        setActiveEntity={setActiveEntity}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Main Container */}
      <main style={{ flex: 1, paddingBottom: '3rem' }}>
        {activeTab === 'accreditamento' && (
          <AccreditamentoDelegaView
            entities={entities}
            onAddNewEntity={handleAddNewEntity}
          />
        )}
        {activeTab === 'domanda-wizard' && <WizardDomandaView />}
        {activeTab === 'esiti-isf' && <EsitiIsfView />}
        {activeTab === 'concertazione' && <ConcertazioneView />}
        {activeTab === 'calendario-definitivo' && <CalendarioDefinitivoView />}
      </main>

      {/* Institutional Footer */}
      <footer style={{
        backgroundColor: 'var(--pa-blue-dark)',
        color: 'rgba(255,255,255,0.7)',
        padding: '1.5rem',
        fontSize: '0.8rem',
        textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <strong>POLARIS</strong> — Provincia di Pescara • Servizio Pubblico Spazi Sportivi Scolastici
          </div>
          <div>
            Conforme Linee Guida AgID & Italia Design System • Accessibilità WCAG 2.1 AA
          </div>
        </div>
      </footer>
    </div>
  );
};
