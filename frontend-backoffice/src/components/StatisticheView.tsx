import React from 'react';
import { BarChart3, TrendingUp, PieChart, Building2, Users, Clock } from 'lucide-react';

export const StatisticheView: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Analisi & Statistiche Assegnazione</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Metriche di saturazione impianti, equità di distribuzione e soddisfazione fabbisogni (ISF)
        </p>
      </div>

      {/* Analytics KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Tasso Utilizzo Impianti</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-dark)', margin: '0.2rem 0' }}>87,4%</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-success)' }}>+4.2% rispetto a stagione precedente</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Fasce Pregiate Assegnate</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-primary)', margin: '0.2rem 0' }}>94,1%</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Tetto massimo concentrazione rispetatto</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>ISF Medio Associazioni</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#8E44AD', margin: '0.2rem 0' }}>0,842 (84,2%)</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-success)' }}>Soglia equità soddisfatta</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Soci & Atleti Coinvolti</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-success)', margin: '0.2rem 0' }}>~3.450</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>In tutta la Provincia di Pescara</div>
        </div>
      </div>

      {/* Visual Chart Mockups */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <div className="pa-card">
          <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>
            Distribuzione Ore Assegnate per Disciplina
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                <span>Pallavolo (FIPAV)</span>
                <strong>1.680 min (38.8%)</strong>
              </div>
              <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: '38.8%', height: '100%', backgroundColor: 'var(--pa-blue-primary)' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                <span>Pallacanestro (FIP)</span>
                <strong>1.440 min (33.3%)</strong>
              </div>
              <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: '33.3%', height: '100%', backgroundColor: '#00C5CA' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                <span>Calcio a 5 (FIGC)</span>
                <strong>720 min (16.6%)</strong>
              </div>
              <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: '16.6%', height: '100%', backgroundColor: '#8E44AD' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                <span>Ginnastica & Altre</span>
                <strong>480 min (11.3%)</strong>
              </div>
              <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: '11.3%', height: '100%', backgroundColor: '#F39C12' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="pa-card">
          <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>
            Saturazione Palestre per Comune
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                <span>Comune di Pescara (2 Impianti)</span>
                <strong>92% Occupazione</strong>
              </div>
              <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: '92%', height: '100%', backgroundColor: 'var(--pa-success)' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                <span>Comune di Montesilvano (1 Impianto)</span>
                <strong>88% Occupazione</strong>
              </div>
              <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: '88%', height: '100%', backgroundColor: 'var(--pa-success)' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                <span>Comune di Spoltore (1 Impianto)</span>
                <strong>75% Occupazione</strong>
              </div>
              <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: '75%', height: '100%', backgroundColor: 'var(--pa-info)' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                <span>Comune di Penne (1 Impianto)</span>
                <strong>65% Occupazione</strong>
              </div>
              <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: '65%', height: '100%', backgroundColor: 'var(--pa-info)' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
