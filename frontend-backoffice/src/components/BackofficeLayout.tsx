import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { listaStagioni, type Stagione } from '../api/stagioni.ts';

export function BackofficeLayout(): React.ReactElement {
  const [seasons, setSeasons] = useState<Stagione[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');

  useEffect(() => {
    let annullato = false;
    listaStagioni()
      .then((s) => {
        if (annullato) return;
        setSeasons(s);
        if (s.length > 0) {
          setSelectedSeasonId((prev) => prev || s[0]!.id);
        }
      })
      .catch(() => {
        // Errore di rete/backend irraggiungibile: la select rimane vuota, non
        // interrompe il rendering del layout. Nessun retry automatico qui.
      });
    return () => {
      annullato = true;
    };
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--pa-bg-gray)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header seasons={seasons} selectedSeasonId={selectedSeasonId} setSelectedSeasonId={setSelectedSeasonId} />
        <main style={{ flex: 1, padding: '1.75rem', overflowY: 'auto' }}>
          {/* Stagione selezionata dall'operatore in Header, propagata alle viste
              figlie via context di react-router (non un secondo fetch/stato locale
              duplicato — vedi ImpiantiSpaziView, che consuma questo stesso valore
              con useOutletContext invece di richiamare listaStagioni() per conto
              proprio). */}
          <Outlet context={selectedSeasonId} />
        </main>
      </div>
    </div>
  );
}
