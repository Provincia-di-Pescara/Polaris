import React, { useState } from 'react';
import { mockFacilities, mockSpaces, mockSlots } from '../mockData';
import { Facility, Space, Slot } from '../types';
import { Building2, Calendar, MapPin, Sparkles, Plus, Check, Clock, Info } from 'lucide-react';

export const ImpiantiSpaziView: React.FC = () => {
  const [facilities] = useState<Facility[]>(mockFacilities);
  const [selectedFacility, setSelectedFacility] = useState<Facility>(mockFacilities[0]);
  const [spaces] = useState<Space[]>(mockSpaces.filter(s => s.impiantoId === mockFacilities[0].id));
  const [selectedSpace, setSelectedSpace] = useState<Space>(mockSpaces[0]);
  const [slots] = useState<Slot[]>(mockSlots);

  const giorni: Array<'Lunedì' | 'Martedì' | 'Mercoledì' | 'Giovedì' | 'Venerdì' | 'Sabato' | 'Domenica'> = [
    'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'
  ];

  const orari = [
    '15:00 - 17:00',
    '17:00 - 19:00',
    '19:00 - 21:00'
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Impianti & Spazi Sportivi Provinciali</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Censimento palestre scolastiche, omologazioni sportive e configurazione fasce pregiate
          </p>
        </div>
        <button className="btn btn-primary">
          <Plus size={16} />
          <span>Nuova Palestra / Impianto</span>
        </button>
      </div>

      {/* Facility Selection & Space Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.25rem' }}>
        {/* Left Column: Facilities List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--pa-blue-dark)', textTransform: 'uppercase' }}>
            Palestre Provinciali ({facilities.length})
          </div>

          {facilities.map(f => {
            const isSelected = f.id === selectedFacility.id;
            return (
              <div
                key={f.id}
                onClick={() => setSelectedFacility(f)}
                className="pa-card"
                style={{
                  cursor: 'pointer',
                  borderLeft: isSelected ? '4px solid var(--pa-blue-primary)' : '1px solid var(--pa-border)',
                  backgroundColor: isSelected ? 'var(--pa-blue-light)' : 'white',
                  padding: '1rem'
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--pa-blue-dark)', fontSize: '0.925rem' }}>{f.nome}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.775rem', color: 'var(--pa-text-muted)', marginTop: '0.3rem' }}>
                  <MapPin size={14} color="var(--pa-blue-primary)" />
                  <span>{f.comune} • {f.indirizzo}</span>
                </div>
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem' }}>
                  <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                    {f.spaziCount} Spazio/i
                  </span>
                  <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>
                    {f.codice}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Selected Facility Details & Timetable */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Facility Details Banner */}
          <div className="pa-card" style={{ borderTop: '4px solid var(--pa-blue-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', color: 'var(--pa-blue-dark)' }}>{selectedFacility.nome}</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--pa-text-muted)', marginTop: '0.2rem' }}>
                  Istituto Scolastico Titolare: <strong>{selectedFacility.istitutoScolastico}</strong>
                </div>
              </div>
              <button className="btn btn-secondary btn-sm">Modifica Scheda</button>
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {selectedSpace && (
                <div style={{ backgroundColor: '#F8FAFC', padding: '0.65rem 1rem', borderRadius: '6px', border: '1px solid #E2E8F0', flex: 1 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)', fontWeight: 600 }}>SPAZIO ATTIVO SELEZIONATO</div>
                  <div style={{ fontWeight: 700, color: 'var(--pa-blue-dark)', fontSize: '0.95rem' }}>{selectedSpace.nomeSpazio}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)', marginTop: '0.25rem' }}>
                    Fondo: <strong>{selectedSpace.fondo}</strong> ({selectedSpace.copertura})
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem' }}>
                    {selectedSpace.omologazioni.map((omo, i) => (
                      <span key={i} className="badge badge-info" style={{ fontSize: '0.675rem' }}>
                        {omo}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Visual Timetable Grid */}
          <div className="pa-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={20} color="var(--pa-blue-primary)" />
                <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>
                  Griglia Oraria Settimanale & Fasce Pregiate
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <div style={{ width: '14px', height: '14px', backgroundColor: '#FEF9E7', border: '1px solid #F9E79F', borderRadius: '3px' }} />
                  <span>Fascia Pregiata (1.25x)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <div style={{ width: '14px', height: '14px', backgroundColor: '#E8F8F5', border: '1px solid #A3E4D7', borderRadius: '3px' }} />
                  <span>Slot Assegnato</span>
                </div>
              </div>
            </div>

            {/* Weekly Timetable */}
            <div className="pa-table-container">
              <table className="pa-table">
                <thead>
                  <tr>
                    <th style={{ width: '120px' }}>Fascia Oraria</th>
                    {giorni.map(giorno => (
                      <th key={giorno} style={{ textAlign: 'center' }}>{giorno}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orari.map((orario, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 700, color: 'var(--pa-blue-dark)', backgroundColor: '#F8FAFC' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Clock size={14} color="var(--pa-text-muted)" />
                          <span>{orario}</span>
                        </div>
                      </td>
                      {giorni.map(giorno => {
                        // Find matching mock slot
                        const matchSlot = slots.find(s => s.giornoSettimana === giorno && s.oraInizio === orario.split(' - ')[0]);
                        const isPregiata = idx >= 1; // 17:00-19:00 and 19:00-21:00 are fasce pregiate

                        return (
                          <td
                            key={giorno}
                            style={{
                              backgroundColor: matchSlot?.assegnatoA ? '#E8F8F5' : isPregiata ? '#FEF9E7' : 'white',
                              border: '1px solid #E2E8F0',
                              padding: '0.65rem',
                              height: '75px',
                              verticalAlign: 'top'
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                {isPregiata && (
                                  <span className="badge badge-warning" style={{ fontSize: '0.625rem', padding: '0.1rem 0.35rem' }}>
                                    PREGIATA
                                  </span>
                                )}
                                <span style={{ fontSize: '0.675rem', color: 'var(--pa-text-muted)' }}>120 min</span>
                              </div>

                              {matchSlot?.assegnatoA ? (
                                <div style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--pa-success)' }}>
                                  {matchSlot.assegnatoA}
                                  <div style={{ fontSize: '0.675rem', fontWeight: 500, color: '#16A085' }}>
                                    {matchSlot.tipoAssegnazione === 'blocco_gara' ? '🏆 Blocco Gara' : '🔄 Round-Robin'}
                                  </div>
                                </div>
                              ) : (
                                <div style={{ fontSize: '0.75rem', color: '#94A3B8', fontStyle: 'italic' }}>
                                  Libero per assegnazione
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
