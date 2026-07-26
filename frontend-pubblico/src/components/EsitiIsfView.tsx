import React from 'react';
import { BarChart2, Trophy, CheckCircle2, FileText, Info, Award } from 'lucide-react';

export const EsitiIsfView: React.FC = () => {
  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
          Esiti Istruttoria & Tabellone ISF (Fasi 4 - 7 - 10)
        </h2>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Risultati deterministici dei coefficienti normativi e punteggio Indice di Soddisfazione Fabbisogno per ASD Pescara Volley
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Fabbisogno Riconosciuto (FR)</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-primary)', margin: '0.2rem 0' }}>420 Minuti</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-success)' }}>7 Ore Settimanali</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Coefficiente Ponderazione (CP)</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-dark)', margin: '0.2rem 0' }}>1,200</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>$CRS(1.20) \times CAA(1.00) \times CSD(1.00)$</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Punteggio ISF Attuale</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#8E44AD', margin: '0.2rem 0' }}>0,857 (85,7%)</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-success)' }}>ISF = VA / FR = 360 / 420</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Slot Provvisori Assegnati</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-success)', margin: '0.2rem 0' }}>3 Slot (360 min)</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Incluso Blocco Gara Sabato</div>
        </div>
      </div>

      {/* Breakdown Table */}
      <div className="pa-card">
        <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>
          Dettaglio Slot Assegnati Provvisoriamente (Fase 10)
        </h3>

        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Impianto & Spazio Sportivo</th>
                <th>Giorno</th>
                <th>Fascia Oraria</th>
                <th>Durata & Tipo</th>
                <th>Moltiplicatore</th>
                <th>Stato Assegnazione</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Palestra Liceo Scientifico Galilei</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Campo Principale Parquet</div>
                </td>
                <td><strong>Lunedì</strong></td>
                <td>17:00 - 19:00</td>
                <td>120 min • Allenamento</td>
                <td><span className="badge badge-warning">1.25x Pregiata</span></td>
                <td><span className="badge badge-success">Assegnato Round-Robin</span></td>
              </tr>
              <tr>
                <td>
                  <strong>Palestra Liceo Scientifico Galilei</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Campo Principale Parquet</div>
                </td>
                <td><strong>Sabato</strong></td>
                <td>16:00 - 18:00</td>
                <td>120 min • Gara FIPAV</td>
                <td><span className="badge badge-warning">1.25x Pregiata</span></td>
                <td><span className="badge badge-success">Assegnato Blocco Gara B.14</span></td>
              </tr>
              <tr>
                <td>
                  <strong>Palestra Liceo Scientifico Galilei</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Campo Principale Parquet</div>
                </td>
                <td><strong>Sabato</strong></td>
                <td>18:00 - 20:00</td>
                <td>120 min • Gara FIPAV</td>
                <td><span className="badge badge-warning">1.25x Pregiata</span></td>
                <td><span className="badge badge-success">Assegnato Blocco Gara B.14</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
