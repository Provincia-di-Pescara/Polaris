import React, { useState } from 'react';
import { ApplicationWizardState } from '../types';
import { Calculator, ArrowRight, ArrowLeft, CheckCircle2, ShieldCheck, Trophy, Calendar, Sparkles } from 'lucide-react';

export const WizardDomandaView: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [form, setForm] = useState<ApplicationWizardState>({
    classeAttivita: 'A',
    squadreFederaliCount: 4,
    fdMinimoMinuti: 360,
    fdOttimaleMinuti: 480,
    richiedeBloccoGara: true,
    bloccoGaraImpiantoId: 'imp-01',
    bloccoGaraGiorno: 'Sabato',
    preferenzeImpianti: [
      'Palestra Liceo Galilei - Campo Principale',
      'Palasport I.T.C.T. A. Volta',
      'Palestra I.I.S. Alessandrini Montesilvano'
    ]
  });

  // Calculate FR live (Peso calculation: Classe A = 1, + 3 for >3 teams = 4. 4 * 60 = 240min calculated. FR = min(FD, 240))
  const pesoBase = form.classeAttivita === 'A' ? 1 : form.classeAttivita === 'B' ? 2 : 3;
  const incSquadre = form.squadreFederaliCount >= 4 ? 3 : form.squadreFederaliCount >= 2 ? 2 : 1;
  const pesoTotale = pesoBase + incSquadre;
  const frCalcolatoNormativo = pesoTotale * 60; // 60 min per punto
  const frFinaleRiconosciuto = Math.min(form.fdOttimaleMinuti, frCalcolatoNormativo);

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title */}
      <div>
        <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
          Presentazione Domanda Fabbisogno & Preferenze (Stagione 2026/2027)
        </h2>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Compilazione guidata a 4 step per ASD Pescara Volley (Fase 2 Allegato B)
        </p>
      </div>

      {/* Stepper Header */}
      <div className="stepper-container">
        <div className={`step-item ${currentStep === 1 ? 'active' : currentStep > 1 ? 'completed' : ''}`} onClick={() => setCurrentStep(1)}>
          <div className="step-circle">{currentStep > 1 ? '✓' : '1'}</div>
          <div className="step-label">Dati Attività & Squadre</div>
        </div>

        <div className={`step-item ${currentStep === 2 ? 'active' : currentStep > 2 ? 'completed' : ''}`} onClick={() => setCurrentStep(2)}>
          <div className="step-circle">{currentStep > 2 ? '✓' : '2'}</div>
          <div className="step-label">Fabbisogno (FD / FR)</div>
        </div>

        <div className={`step-item ${currentStep === 3 ? 'active' : currentStep > 3 ? 'completed' : ''}`} onClick={() => setCurrentStep(3)}>
          <div className="step-circle">{currentStep > 3 ? '✓' : '3'}</div>
          <div className="step-label">Blocco Giornata Gara</div>
        </div>

        <div className={`step-item ${currentStep === 4 ? 'active' : currentStep > 4 ? 'completed' : ''}`} onClick={() => setCurrentStep(4)}>
          <div className="step-circle">{currentStep > 4 ? '✓' : '4'}</div>
          <div className="step-label">Preferenze Palestre & Slot</div>
        </div>
      </div>

      {/* Step Body */}
      <div className="pa-card">
        {/* Step 1: Dati Attività */}
        {currentStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.5rem' }}>
              Step 1: Inquadramento Attività Sportiva (Allegato A - Art. A.4)
            </h3>

            <div className="form-group">
              <label className="form-label">Classe di Attività Sportiva Dichiarata:</label>
              <select
                value={form.classeAttivita}
                onChange={(e) => setForm({ ...form, classeAttivita: e.target.value as any })}
                className="form-control"
              >
                <option value="A">Classe A — Campionati Nazionali / Regionali di Vertice (Peso Base: 1)</option>
                <option value="B">Classe B — Campionati Regionali Giovanili (Peso Base: 2)</option>
                <option value="C">Classe C — Attività Promozionale e Amatoriale (Peso Base: 3)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Numero Squadre Iscritte a Campionati Federali Nazionali/Regionali:</label>
              <input
                type="number"
                min="1"
                max="15"
                value={form.squadreFederaliCount}
                onChange={(e) => setForm({ ...form, squadreFederaliCount: Number(e.target.value) })}
                className="form-control"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>
                Genera un incremento di peso normativo di +{incSquadre} punti (Art. A.4)
              </span>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--pa-blue-dark)' }}>Riepilogo Peso Normativo Calcolato:</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--pa-blue-primary)', marginTop: '2px' }}>
                {pesoTotale} Punti Peso ({pesoBase} Base + {incSquadre} Increm. Squadre)
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Fabbisogno */}
        {currentStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.5rem' }}>
              Step 2: Dichiarazione Fabbisogno Dichiarato (FD) & Calcolo FR
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Fabbisogno Minimo Settimanale (Minuti):</label>
                <input
                  type="number"
                  step="30"
                  value={form.fdMinimoMinuti}
                  onChange={(e) => setForm({ ...form, fdMinimoMinuti: Number(e.target.value) })}
                  className="form-control"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Es. 360 minuti = 6 ore settimanali</span>
              </div>

              <div className="form-group">
                <label className="form-label">Fabbisogno Ottimale Settimanale (FD) (Minuti):</label>
                <input
                  type="number"
                  step="30"
                  value={form.fdOttimaleMinuti}
                  onChange={(e) => setForm({ ...form, fdOttimaleMinuti: Number(e.target.value) })}
                  className="form-control"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Es. 480 minuti = 8 ore settimanali</span>
              </div>
            </div>

            {/* Live FR Calculation Display */}
            <div style={{ backgroundColor: '#E8F8F5', border: '1px solid #A3E4D7', padding: '1.25rem', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--pa-success)' }}>
                <Sparkles size={20} />
                <h4 style={{ margin: 0, color: 'var(--pa-success)' }}>Formula Normativa Fabbisogno Riconosciuto (FR)</h4>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#16A085', marginTop: '4px' }}>
                FR = min(FD, Peso × 60 min) = min({form.fdOttimaleMinuti}, {frCalcolatoNormativo}) =
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-success)', marginTop: '4px' }}>
                {frFinaleRiconosciuto} Minuti Settimanali Riconosciuti
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Blocchi Gara */}
        {currentStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.5rem' }}>
              Step 3: Richiesta Blocco Giornata di Gara (Art. B.12-B.14)
            </h3>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input
                type="checkbox"
                id="checkGara"
                checked={form.richiedeBloccoGara}
                onChange={(e) => setForm({ ...form, richiedeBloccoGara: e.target.checked })}
                style={{ width: '18px', height: '18px' }}
              />
              <label htmlFor="checkGara" style={{ fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', margin: 0 }}>
                Richiedi Blocco Gara Ufficiale (Coppia di 2 slot consecutivi nel fine settimana)
              </label>
            </div>

            {form.richiedeBloccoGara && (
              <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '8px', border: '1px solid #E2E8F0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Giorno di Gara Preferito:</label>
                  <select
                    value={form.bloccoGaraGiorno}
                    onChange={(e) => setForm({ ...form, bloccoGaraGiorno: e.target.value as any })}
                    className="form-control"
                  >
                    <option value="Sabato">Sabato Pomeriggio (16:00 - 20:00)</option>
                    <option value="Domenica">Domenica Mattina / Pomeriggio</option>
                  </select>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Palestra Titolare del Campo di Gara:</label>
                  <select className="form-control">
                    <option value="imp-01">Palestra Liceo Scientifico Galilei (FIPAV Serie B Omologato)</option>
                    <option value="imp-02">Palasport I.T.C.T. Volta</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Preferenze */}
        {currentStep === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.5rem' }}>
              Step 4: Ranking Preferenze Palestre & Slot Orari (Art. B.20)
            </h3>

            <p style={{ fontSize: '0.85rem', color: 'var(--pa-text-muted)' }}>
              Ordina le tue preferenze. Il motore Go utilizzerà questo ordine per spezzare i pareggi (tie-break preferenza):
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {form.preferenzeImpianti.map((pref, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.85rem 1rem',
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '6px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="badge badge-primary" style={{ borderRadius: '50%', width: '24px', height: '24px', justifyContent: 'center' }}>
                      {index + 1}
                    </span>
                    <strong style={{ color: 'var(--pa-blue-dark)', fontSize: '0.9rem' }}>{pref}</strong>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Priorità #{index + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', borderTop: '1px solid var(--pa-border)', paddingTop: '1rem' }}>
          <button
            onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
            disabled={currentStep === 1}
            className="btn btn-secondary"
          >
            <ArrowLeft size={16} />
            <span>Indietro</span>
          </button>

          {currentStep < 4 ? (
            <button
              onClick={() => setCurrentStep(prev => Math.min(4, prev + 1))}
              className="btn btn-primary"
            >
              <span>Avanti al Prossimo Step</span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={() => alert('Domanda Fabbisogno inviata con successo! Inoltrata al Motore Go.')}
              className="btn btn-success"
            >
              <CheckCircle2 size={16} />
              <span>Invia Domanda Definitiva</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
