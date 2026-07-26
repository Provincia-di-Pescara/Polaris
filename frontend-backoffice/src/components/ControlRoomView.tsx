import React, { useState } from 'react';
import { mockProcedurePhases, mockDomande } from '../mockData';
import { Domanda } from '../types';
import { 
  Play, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Cpu, 
  Calculator, 
  Sparkles, 
  ArrowRight,
  ShieldCheck,
  FileSpreadsheet
} from 'lucide-react';

export const ControlRoomView: React.FC = () => {
  const [phases, setPhases] = useState(mockProcedurePhases);
  const [domande, setDomande] = useState<Domanda[]>(mockDomande);
  const [activeStep, setActiveStep] = useState<number>(8); // Fase 8 current
  const [isExecuting, setIsExecuting] = useState<string | null>(null);
  const [executionLog, setExecutionLog] = useState<string[]>([]);

  const handleExecuteEngine = (type: 'istruttoria' | 'blocchi_gara' | 'round_robin') => {
    setIsExecuting(type);
    let actionName = '';
    if (type === 'istruttoria') actionName = 'Calcolo Istruttoria (Fase 4)';
    if (type === 'blocchi_gara') actionName = 'Assegnazione Blocchi Gara (Fase 6)';
    if (type === 'round_robin') actionName = 'Algoritmo Round-Robin (Fase 8)';

    setExecutionLog(prev => [`[${new Date().toLocaleTimeString()}] Avvio microservizio Go Engine: ${actionName}...`, ...prev]);

    setTimeout(() => {
      setExecutionLog(prev => [
        `[${new Date().toLocaleTimeString()}] ✅ HTTP 200 OK — Risposta deterministica dal Motore Go.`,
        `[${new Date().toLocaleTimeString()}] Parametri congelati con versione allegato_parametrico v2.0.`,
        ...prev
      ]);
      setIsExecuting(null);

      if (type === 'round_robin') {
        // Mark step 8 complete
        setPhases(prev => prev.map(p => p.num === 8 ? { ...p, stato: 'completata' } : p.num === 9 ? { ...p, stato: 'in_corso' } : p));
        setActiveStep(9);
      }
    }, 1500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title & Engine Connection Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Control Room Procedura & Algoritmo</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Orchestrazione automatizzata delle 16 Fasi dell'Allegato B — Provincia di Pescara
          </p>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          backgroundColor: '#E8F8F5',
          border: '1px solid #A3E4D7',
          padding: '0.5rem 1rem',
          borderRadius: '8px',
          fontSize: '0.85rem'
        }}>
          <Cpu size={20} color="var(--pa-success)" />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--pa-success)' }}>Motore Go (v1.26) Attivo</div>
            <div style={{ fontSize: '0.75rem', color: '#16A085' }}>Rete Interna Docker • Deterministico</div>
          </div>
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Domande Ammesse</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-dark)', margin: '0.2rem 0' }}>12 ASD / SSD</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-success)', fontWeight: 600 }}>100% Ammissibilità Istruttoria</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Fabbisogno Riconosciuto (FR)</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-primary)', margin: '0.2rem 0' }}>4.320 Min/Sett</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Ponderazione Minuti Grezzi</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>ISF Medio Calcolato</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#8E44AD', margin: '0.2rem 0' }}>0,842 (84,2%)</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Indice Soddisfazione Fabbisogno</div>
        </div>

        <div className="pa-card">
          <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>Blocchi Gara Assegnati</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-success)', margin: '0.2rem 0' }}>8 Slot (4 Blocchi)</div>
          <div style={{ fontSize: '0.75rem', color: '#16A085', fontWeight: 600 }}>4 Verbali HMAC Generati</div>
        </div>
      </div>

      {/* Action Simulation Triggers Bar */}
      <div className="pa-card" style={{ background: 'linear-gradient(135deg, #002B55 0%, #0056B3 100%)', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={20} color="var(--pa-accent)" />
              <h3 style={{ color: 'white', margin: 0, fontSize: '1.1rem' }}>Azioni di Avanzamento Algoritmico</h3>
            </div>
            <p style={{ fontSize: '0.825rem', opacity: 0.85, marginTop: '2px' }}>
              Richiama direttamente le funzioni deterministiche del motore Go (senza discrezionalità umana)
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => handleExecuteEngine('istruttoria')}
              disabled={isExecuting !== null}
              className="btn btn-sm"
              style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'white', borderColor: 'rgba(255,255,255,0.3)' }}
            >
              <Calculator size={16} />
              <span>Istruttoria (Fase 4)</span>
            </button>

            <button
              onClick={() => handleExecuteEngine('blocchi_gara')}
              disabled={isExecuting !== null}
              className="btn btn-sm"
              style={{ backgroundColor: 'rgba(255,255,255,0.25)', color: 'white', borderColor: 'rgba(255,255,255,0.4)' }}
            >
              <ShieldCheck size={16} />
              <span>Blocchi Gara (Fase 6)</span>
            </button>

            <button
              onClick={() => handleExecuteEngine('round_robin')}
              disabled={isExecuting !== null}
              className="btn btn-success btn-sm"
              style={{ padding: '0.5rem 1.25rem', boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }}
            >
              <Play size={16} />
              <span>{isExecuting === 'round_robin' ? 'Esecuzione in Corso...' : 'Esegui Round-Robin (Fase 8)'}</span>
            </button>
          </div>
        </div>

        {/* Execution Log Stream */}
        {executionLog.length > 0 && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '6px',
            fontFamily: 'monospace',
            fontSize: '0.775rem',
            maxHeight: '90px',
            overflowY: 'auto'
          }}>
            {executionLog.map((log, i) => (
              <div key={i} style={{ color: log.includes('✅') ? '#2ECC71' : 'var(--pa-accent)', marginBottom: '2px' }}>
                {log}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 16 Phases Procedure Stepper */}
      <div className="pa-card">
        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--pa-blue-dark)' }}>
          Percorso Procedurale (Allegato B — Artt. B.1-B.39)
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.85rem' }}>
          {phases.map((phase) => {
            const isCurrent = phase.num === activeStep;
            const isCompleted = phase.stato === 'completata';
            return (
              <div
                key={phase.num}
                onClick={() => setActiveStep(phase.num)}
                style={{
                  border: isCurrent ? '2px solid var(--pa-blue-primary)' : '1px solid var(--pa-border)',
                  borderRadius: '8px',
                  padding: '0.85rem',
                  backgroundColor: isCurrent ? 'var(--pa-blue-light)' : isCompleted ? '#F8FAFC' : 'white',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: isCurrent ? 'var(--pa-blue-primary)' : isCompleted ? 'var(--pa-success)' : 'var(--pa-text-muted)'
                  }}>
                    FASE {phase.num}
                  </span>
                  {isCompleted ? (
                    <CheckCircle2 size={16} color="var(--pa-success)" />
                  ) : isCurrent ? (
                    <span className="badge badge-info">IN CORSO</span>
                  ) : (
                    <Clock size={16} color="#CBD5E1" />
                  )}
                </div>

                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--pa-blue-dark)', lineHeight: 1.2 }}>
                  {phase.titolo}
                </div>
                <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)', marginTop: '0.35rem' }}>
                  {phase.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Calculated Applications & Parameters Table */}
      <div className="pa-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)' }}>Esiti Istruttoria & Parametri Calcolati</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>
              Parametri $CRS \times CAA \times CSD = CP$ calcolati in `decimal` con arrotondamento a 3 cifre
            </p>
          </div>
          <button className="btn btn-secondary btn-sm">
            <FileSpreadsheet size={16} />
            <span>Esporta Report Verbale</span>
          </button>
        </div>

        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Associazione Sportiva (ASD/SSD)</th>
                <th>Classe</th>
                <th>Squadre</th>
                <th>FD Min / Ott</th>
                <th>FR Calcolato</th>
                <th>Coeff. CP</th>
                <th>Punteggio ISF</th>
                <th>Stato Blocco Gara</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              {domande.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--pa-blue-dark)' }}>{d.associazioneNome}</div>
                    <div style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>ID: {d.associazioneId}</div>
                  </td>
                  <td><span className="badge badge-neutral">Classe {d.classeAttivita}</span></td>
                  <td><strong>{d.squadreFederaliCount}</strong> squadre</td>
                  <td>{d.fdMinimoMinuti}m / {d.fdOttimaleMinuti}m</td>
                  <td><strong style={{ color: 'var(--pa-blue-primary)' }}>{d.frCalcolatoMinuti} min</strong></td>
                  <td>
                    <span title={`CRS: ${d.crs} × CAA: ${d.caa} × CSD: ${d.csd}`}>
                      <strong>{d.cp.toFixed(3)}</strong>
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 800, color: '#8E44AD' }}>
                      {(d.isf * 100).toFixed(1)}%
                    </div>
                  </td>
                  <td>
                    {d.richiedeBloccoGara ? (
                      <span className="badge badge-success">Assegnato B.14</span>
                    ) : (
                      <span className="badge badge-neutral">Non Richiesto</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
                      Dettaglio Formule
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
