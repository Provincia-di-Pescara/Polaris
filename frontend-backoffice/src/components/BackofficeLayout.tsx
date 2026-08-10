import React, { useState } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { mockSeasons } from '../mockData.ts';

export function BackofficeLayout(): React.ReactElement {
  const [seasons] = useState(mockSeasons);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(mockSeasons[0].id);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--pa-bg-gray)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header seasons={seasons} selectedSeasonId={selectedSeasonId} setSelectedSeasonId={setSelectedSeasonId} />
        <main style={{ flex: 1, padding: '1.75rem', overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
