import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { BarChart3, TrendingUp, PieChart, Building2, Users, Clock } from 'lucide-react';
import {
  leggiStatisticheStagione,
  type StatisticheStagione,
  ErroreRichiestaApi,
} from '../api/statistiche.ts';

function formatPct(valore: string | null): string {
  if (valore === null) return 'N/D';
  return `${(parseFloat(valore) * 100).toFixed(1)}%`;
}

function formatMinuti(valore: string): string {
  return `${Math.round(parseFloat(valore)).toLocaleString('it-IT')} min`;
}

const COLORI_DISCIPLINA = ['var(--pa-blue-primary)', '#00C5CA', '#8E44AD', '#F39C12', '#27AE60', '#E74C3C'];

export const StatisticheView: React.FC = () => {
  const stagioneId = useOutletContext<string>() ?? '';
  const [statistiche, setStatistiche] = useState<StatisticheStagione | null>(null);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);

  useEffect(() => {
    if (!stagioneId) return;
    setCaricamento(true);
    setErroreCaricamento(null);
    setStatistiche(null);
    leggiStatisticheStagione(stagioneId)
      .then(setStatistiche)
      .catch((err) => setErroreCaricamento(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare le statistiche.'))
      .finally(() => setCaricamento(false));
  }, [stagioneId]);

  const totaleMinutiDisciplina = statistiche
    ? statistiche.distribuzioneMinutiPerDisciplina.reduce((acc, v) => acc + parseFloat(v.minuti), 0)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Analisi & Statistiche Assegnazione</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Metriche di saturazione impianti, equità di distribuzione e soddisfazione fabbisogni (ISF)
        </p>
      </div>

      {!stagioneId && <div style={{ color: 'var(--pa-text-muted)' }}>Seleziona una stagione nell'Header per iniziare.</div>}
      {stagioneId && caricamento && <div style={{ color: 'var(--pa-text-muted)' }}>Caricamento statistiche...</div>}
      {erroreCaricamento && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {erroreCaricamento}
        </div>
      )}

      {stagioneId && statistiche && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <div className="pa-card">
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>
                <Building2 size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                Tasso Utilizzo Impianti
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-dark)', margin: '0.2rem 0' }}>
                {formatPct(statistiche.tassoUtilizzoImpiantiPct)}
              </div>
            </div>

            <div className="pa-card">
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>
                <TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                Fasce Pregiate Assegnate
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-blue-primary)', margin: '0.2rem 0' }}>
                {formatPct(statistiche.fascePregiateAssegnatePct)}
              </div>
            </div>

            <div className="pa-card">
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>
                <BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                ISF Medio Associazioni
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#8E44AD', margin: '0.2rem 0' }}>
                {statistiche.isfMedioAssociazioni === null ? 'N/D' : `${statistiche.isfMedioAssociazioni} (${formatPct(statistiche.isfMedioAssociazioni)})`}
              </div>
            </div>

            <div className="pa-card">
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>
                <Users size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                Soci & Atleti Coinvolti
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-success)', margin: '0.2rem 0' }}>
                {statistiche.sociAtletiCoinvolti.toLocaleString('it-IT')}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <div className="pa-card">
              <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>
                <PieChart size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                Distribuzione Minuti Assegnati per Disciplina
              </h3>
              {statistiche.distribuzioneMinutiPerDisciplina.length === 0 && (
                <div style={{ color: 'var(--pa-text-muted)', fontSize: '0.85rem' }}>Nessuna assegnazione attiva in questa stagione.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {statistiche.distribuzioneMinutiPerDisciplina.map((v, i) => {
                  const pct = totaleMinutiDisciplina > 0 ? (parseFloat(v.minuti) / totaleMinutiDisciplina) * 100 : 0;
                  return (
                    <div key={v.disciplinaCodice}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                        <span>{v.disciplinaDenominazione}</span>
                        <strong>{formatMinuti(v.minuti)} ({pct.toFixed(1)}%)</strong>
                      </div>
                      <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: COLORI_DISCIPLINA[i % COLORI_DISCIPLINA.length] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pa-card">
              <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>
                <Clock size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                Saturazione Palestre per Impianto
              </h3>
              {statistiche.saturazionePerImpianto.length === 0 && (
                <div style={{ color: 'var(--pa-text-muted)', fontSize: '0.85rem' }}>Nessuno slot definito per questa stagione.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {statistiche.saturazionePerImpianto.map((v) => (
                  <div key={v.impiantoId}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '0.25rem' }}>
                      <span>{v.impiantoDenominazione}</span>
                      <strong>{formatPct(v.tassoUtilizzoPct)} Occupazione</strong>
                    </div>
                    <div style={{ height: '10px', backgroundColor: '#E2E8F0', borderRadius: '5px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: v.tassoUtilizzoPct === null ? '0%' : `${parseFloat(v.tassoUtilizzoPct) * 100}%`,
                          height: '100%',
                          backgroundColor: 'var(--pa-success)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
