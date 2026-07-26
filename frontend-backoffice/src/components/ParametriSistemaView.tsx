import React, { useState } from 'react';
import { mockParametricVersions } from '../mockData';
import { ParametricVersion } from '../types';
import { Settings2, Plus, ShieldAlert, History, Save, CheckCircle2, Lock } from 'lucide-react';

export const ParametriSistemaView: React.FC = () => {
  const [versions, setVersions] = useState<ParametricVersion[]>(mockParametricVersions);
  const activeVersion = versions.find(v => v.isAttiva) || versions[0];
  const [isEditing, setIsEditing] = useState(false);

  // Form State
  const [form, setForm] = useState({
    moltiplicatoreMinutiPeso: activeVersion.moltiplicatoreMinutiPeso,
    pesoFascePregiate: activeVersion.pesoFascePregiate,
    limiteMinutiSettimanali: activeVersion.limiteMinutiSettimanali,
    limiteSlotImpianto: activeVersion.limiteSlotImpianto,
    limiteFascePregiate: activeVersion.limiteFascePregiate,
    limiteGiornateGara: activeVersion.limiteGiornateGara,
    tolleranzaIsfParita: activeVersion.tolleranzaIsfParita,
    sogliaMancatoUtilizzoDiffida: activeVersion.sogliaMancatoUtilizzoDiffida,
    sogliaMancatoUtilizzoDecadenza: activeVersion.sogliaMancatoUtilizzoDecadenza
  });

  const handleSaveNewVersion = () => {
    const nextVerNum = versions.length + 1;
    const newVersion: ParametricVersion = {
      id: nextVerNum,
      versione: `v${nextVerNum}.0 (Nuova Versione Admin)`,
      validaDal: new Date().toISOString().split('T')[0],
      creataDa: 'admin@provincia.pescara.it',
      ...form,
      isAttiva: true
    };

    setVersions(prev => [
      newVersion,
      ...prev.map(v => ({ ...v, isAttiva: false }))
    ]);
    setIsEditing(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title & Immutable Rule Notice */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Parametri di Sistema (`allegato_parametrico`)</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Valori normativi modificabili esclusivamente dall'Amministratore e versionati su DB
          </p>
        </div>

        <button
          onClick={() => setIsEditing(true)}
          disabled={isEditing}
          className="btn btn-primary"
        >
          <Plus size={16} />
          <span>Pubblica Nuova Versione Parametrica</span>
        </button>
      </div>

      {/* Notice Card */}
      <div className="pa-card" style={{ backgroundColor: '#FEF9E7', borderLeft: '4px solid #F39C12' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Lock size={22} color="#D68910" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, color: '#B7950B' }}>Garanzia di Riproducibilità Storica (Art. B.1 - Allegato B)</div>
            <div style={{ fontSize: '0.825rem', color: '#7D6608', marginTop: '2px' }}>
              I parametri non vengono mai sovrascritti <em>in place</em>. Ogni nuova modifica genera un nuovo record versionato. Le elaborazioni storiche rimangono sempre legate alla versione vigente al momento del loro calcolo.
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Active Settings Form vs History */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.25rem' }}>
        {/* Left: Active Version Form */}
        <div className="pa-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div>
              <span className="badge badge-success" style={{ marginBottom: '0.35rem' }}>Versione Attiva Ora</span>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', margin: 0 }}>{activeVersion.versione}</h3>
              <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)' }}>
                Valida dal: {activeVersion.validaDal} • Modificata da: {activeVersion.creataDa}
              </div>
            </div>

            {isEditing && (
              <button onClick={handleSaveNewVersion} className="btn btn-success">
                <Save size={16} />
                <span>Salva e Pubblica</span>
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">🔧 Moltiplicatore Minuti / Peso (Art. A.5):</label>
              <input
                type="number"
                disabled={!isEditing}
                value={form.moltiplicatoreMinutiPeso}
                onChange={(e) => setForm({ ...form, moltiplicatoreMinutiPeso: Number(e.target.value) })}
                className="form-control"
              />
              <span style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>Minuti per punto di peso riconosciuto (default: 60)</span>
            </div>

            <div className="form-group">
              <label className="form-label">🔧 Peso Ponderazione Fasce Pregiate (Art. A.9):</label>
              <input
                type="number"
                step="0.05"
                disabled={!isEditing}
                value={form.pesoFascePregiate}
                onChange={(e) => setForm({ ...form, pesoFascePregiate: Number(e.target.value) })}
                className="form-control"
              />
              <span style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>Moltiplicatore valore su VA/ISF (default: 1.25)</span>
            </div>

            <div className="form-group">
              <label className="form-label">🔧 Limite Minuti Settimanali (Art. B.19):</label>
              <input
                type="number"
                disabled={!isEditing}
                value={form.limiteMinutiSettimanali}
                onChange={(e) => setForm({ ...form, limiteMinutiSettimanali: Number(e.target.value) })}
                className="form-control"
              />
              <span style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>Minuti grezzi massimi per associazione (default: 600)</span>
            </div>

            <div className="form-group">
              <label className="form-label">🔧 Limite Slot Stesso Impianto:</label>
              <input
                type="number"
                disabled={!isEditing}
                value={form.limiteSlotImpianto}
                onChange={(e) => setForm({ ...form, limiteSlotImpianto: Number(e.target.value) })}
                className="form-control"
              />
              <span style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>Numero massimo slot nello stesso impianto (default: 4)</span>
            </div>

            <div className="form-group">
              <label className="form-label">🔧 Tolleranza Parità ISF (Art. B.20):</label>
              <input
                type="number"
                step="0.001"
                disabled={!isEditing}
                value={form.tolleranzaIsfParita}
                onChange={(e) => setForm({ ...form, tolleranzaIsfParita: Number(e.target.value) })}
                className="form-control"
              />
              <span style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>Soglia differenza ISF per considerarsi pari (default: 0.005)</span>
            </div>

            <div className="form-group">
              <label className="form-label">🔧 Soglia Sanzione Mancato Utilizzo:</label>
              <input
                type="number"
                disabled={!isEditing}
                value={form.sogliaMancatoUtilizzoDecadenza}
                onChange={(e) => setForm({ ...form, sogliaMancatoUtilizzoDecadenza: Number(e.target.value) })}
                className="form-control"
              />
              <span style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>Numero assenze ingiustificate per decadenza (default: 3)</span>
            </div>
          </div>
        </div>

        {/* Right: History Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'var(--pa-blue-dark)' }}>
            <History size={18} color="var(--pa-blue-primary)" />
            <span>Storico Versioni ({versions.length})</span>
          </div>

          {versions.map(v => (
            <div
              key={v.id}
              className="pa-card"
              style={{
                borderLeft: v.isAttiva ? '4px solid var(--pa-success)' : '1px solid var(--pa-border)',
                padding: '0.85rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.875rem', color: 'var(--pa-blue-dark)' }}>{v.versione}</strong>
                {v.isAttiva ? (
                  <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>ATTIVA</span>
                ) : (
                  <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>ARCHIVIATA</span>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)', marginTop: '0.35rem' }}>
                Moltiplicatore: {v.moltiplicatoreMinutiPeso}m • Tetto: {v.limiteMinutiSettimanali}m
              </div>
              <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.2rem' }}>
                Valida dal {v.validaDal}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
