import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ControlRoomView } from './components/ControlRoomView';
import { ImpiantiSpaziView } from './components/ImpiantiSpaziView';
import { DelegheAccreditamentiView } from './components/DelegheAccreditamentiView';
import { ParametriSistemaView } from './components/ParametriSistemaView';
import { AuditSorteggioView } from './components/AuditSorteggioView';
import { StatisticheView } from './components/StatisticheView';
import { mockSeasons } from './mockData';
import { Role } from './types';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('control-room');
  const [seasons] = useState(mockSeasons);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(mockSeasons[0].id);
  const [role, setRole] = useState<Role>('admin');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--pa-bg-gray)' }}>
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        role={role}
      />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Sticky Header */}
        <Header
          seasons={seasons}
          selectedSeasonId={selectedSeasonId}
          setSelectedSeasonId={setSelectedSeasonId}
          role={role}
          setRole={setRole}
        />

        {/* Tab Content Body */}
        <main style={{ flex: 1, padding: '1.75rem', overflowY: 'auto' }}>
          {currentTab === 'control-room' && <ControlRoomView />}
          {currentTab === 'impianti-spazi' && <ImpiantiSpaziView />}
          {currentTab === 'deleghe-accreditamenti' && <DelegheAccreditamentiView />}
          {currentTab === 'parametri-sistema' && <ParametriSistemaView />}
          {currentTab === 'audit-sorteggio' && <AuditSorteggioView />}
          {currentTab === 'statistiche' && <StatisticheView />}
        </main>
      </div>
    </div>
  );
};
