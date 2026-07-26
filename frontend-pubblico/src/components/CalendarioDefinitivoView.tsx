import React from 'react';
import { Calendar, Download, Printer, Clock, MapPin, Trophy } from 'lucide-react';

export const CalendarioDefinitivoView: React.FC = () => {
  const giorni = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title & Export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
            Settimana Tipo Assegnata — Stagione 2026/2027
          </h2>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Orario definitivo approvato con Provvedimento Dirigenziale (Fase 14 Allegato B)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary btn-sm">
            <Printer size={16} />
            <span>Stampa Orario</span>
          </button>
          <button className="btn btn-primary btn-sm">
            <Download size={16} />
            <span>Esporta Calendario (iCal / PDF)</span>
          </button>
        </div>
      </div>

      {/* Weekly Grid */}
      <div className="pa-card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
          {giorni.map(giorno => {
            const isLunedì = giorno === 'Lunedì';
            const isSabato = giorno === 'Sabato';

            return (
              <div
                key={giorno}
                style={{
                  border: '1px solid var(--pa-border)',
                  borderRadius: '6px',
                  backgroundColor: '#F8FAFC',
                  minHeight: '220px',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <div style={{
                  padding: '0.6rem',
                  backgroundColor: 'var(--pa-blue-dark)',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  textAlign: 'center',
                  borderTopLeftRadius: '5px',
                  borderTopRightRadius: '5px'
                }}>
                  {giorno}
                </div>

                <div style={{ padding: '0.6rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {isLunedì && (
                    <div style={{
                      backgroundColor: '#E8F8F5',
                      border: '1px solid #A3E4D7',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      fontSize: '0.775rem'
                    }}>
                      <div style={{ fontWeight: 700, color: 'var(--pa-success)' }}>17:00 - 19:00</div>
                      <div style={{ fontWeight: 600, color: 'var(--pa-blue-dark)', marginTop: '2px' }}>Palestra Galilei</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--pa-text-muted)' }}>Allenamento 1a Squadra</div>
                    </div>
                  )}

                  {isSabato && (
                    <div style={{
                      backgroundColor: '#FEF9E7',
                      border: '1px solid #F9E79F',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      fontSize: '0.775rem'
                    }}>
                      <div style={{ fontWeight: 700, color: 'var(--pa-warning)' }}>16:00 - 20:00</div>
                      <div style={{ fontWeight: 600, color: 'var(--pa-blue-dark)', marginTop: '2px' }}>Palestra Galilei</div>
                      <div style={{ fontSize: '0.7rem', color: '#B7950B', fontWeight: 600 }}>🏆 Blocco Gara FIPAV</div>
                    </div>
                  )}

                  {!isLunedì && !isSabato && (
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8', textAlign: 'center', marginTop: '1rem', fontStyle: 'italic' }}>
                      Nessuna assegnazione
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
