import React, { useState } from 'react';
import { mockDelegateRequests } from '../mockData';
import { DelegateRequest } from '../types';
import { FileCheck2, Check, X, Eye, FileText, ShieldAlert, User, Building, Calendar } from 'lucide-react';

export const DelegheAccreditamentiView: React.FC = () => {
  const [requests, setRequests] = useState<DelegateRequest[]>(mockDelegateRequests);
  const [selectedReq, setSelectedReq] = useState<DelegateRequest | null>(null);
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<'tutte' | 'in_attesa' | 'approvata'>('tutte');

  const handleApprove = (id: string) => {
    setRequests(prev => prev.map(r => r.id === id ? {
      ...r,
      stato: 'approvata',
      noteOperatore: note || 'Delega approvata a seguito di verifica documenti statutari e affiliazione FSN/EPS.'
    } : r));
    setSelectedReq(null);
    setNote('');
  };

  const handleReject = (id: string) => {
    setRequests(prev => prev.map(r => r.id === id ? {
      ...r,
      stato: 'respinta',
      noteOperatore: note || 'Documentazione incompleta o difforme.'
    } : r));
    setSelectedReq(null);
    setNote('');
  };

  const filteredRequests = requests.filter(r => {
    if (filter === 'in_attesa') return r.stato === 'in_attesa';
    if (filter === 'approvata') return r.stato === 'approvata';
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title & Filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Gestione Deleghe & Accreditamenti (Art. 3 Doc. Principale)</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Verifica operatore delle associazioni delle persone fisiche (autenticate via SPID/CIE) alle ASD/SSD titolari
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setFilter('tutte')}
            className={`btn btn-sm ${filter === 'tutte' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Tutte ({requests.length})
          </button>
          <button
            onClick={() => setFilter('in_attesa')}
            className={`btn btn-sm ${filter === 'in_attesa' ? 'btn-primary' : 'btn-secondary'}`}
          >
            In Attesa ({requests.filter(r => r.stato === 'in_attesa').length})
          </button>
          <button
            onClick={() => setFilter('approvata')}
            className={`btn btn-sm ${filter === 'approvata' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Approvate ({requests.filter(r => r.stato === 'approvata').length})
          </button>
        </div>
      </div>

      {/* Requests Table */}
      <div className="pa-card">
        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Persona Fisica (SPID/CIE)</th>
                <th>Associazione Sportiva / Ente</th>
                <th>Ruolo Dichiarato</th>
                <th>Data Inserimento</th>
                <th>Documentazione</th>
                <th>Stato Istruttoria</th>
                <th>Azione Operatore</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map(req => (
                <tr key={req.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <User size={16} color="var(--pa-blue-primary)" />
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--pa-blue-dark)' }}>{req.personaFisica}</div>
                        <div style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>CF: {req.codiceFiscale}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Building size={16} color="var(--pa-text-muted)" />
                      <div>
                        <div style={{ fontWeight: 700 }}>{req.associazioneNome}</div>
                        <div style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>
                          P.IVA/CF: {req.codiceFiscaleAssociazione} ({req.tipoAssociazione})
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-info">{req.ruoloRichiesto}</span>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>{req.dataRichiesta}</div>
                  </td>
                  <td>
                    <button
                      onClick={() => setSelectedReq(req)}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                    >
                      <Eye size={14} />
                      <span>Vedi PDF Documento</span>
                    </button>
                  </td>
                  <td>
                    {req.stato === 'approvata' && <span className="badge badge-success">Approvata</span>}
                    {req.stato === 'in_attesa' && <span className="badge badge-warning">In Attesa Esame</span>}
                    {req.stato === 'respinta' && <span className="badge badge-danger">Respinta</span>}
                  </td>
                  <td>
                    <button
                      onClick={() => setSelectedReq(req)}
                      className="btn btn-primary btn-sm"
                    >
                      Valuta Delega
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspector / Evaluation Modal */}
      {selectedReq && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, color: 'var(--pa-blue-dark)' }}>Valutazione Delega Rappresentanza</h3>
              <button
                onClick={() => setSelectedReq(null)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--pa-text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ backgroundColor: '#F8FAFC', padding: '0.85rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--pa-text-muted)' }}>PERSONA FISICA</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--pa-blue-dark)', marginTop: '2px' }}>{selectedReq.personaFisica}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>CF: {selectedReq.codiceFiscale}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>Email: {selectedReq.email}</div>
              </div>

              <div style={{ backgroundColor: '#F8FAFC', padding: '0.85rem', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--pa-text-muted)' }}>ENTE RAPPRESENTATO</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--pa-blue-dark)', marginTop: '2px' }}>{selectedReq.associazioneNome}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>CF Ente: {selectedReq.codiceFiscaleAssociazione}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>Ruolo: {selectedReq.ruoloRichiesto}</div>
              </div>
            </div>

            {/* Document Preview Placeholder */}
            <div style={{
              border: '2px dashed var(--pa-border)',
              borderRadius: '8px',
              padding: '1.5rem',
              textAlign: 'center',
              backgroundColor: '#FAFAFA',
              marginBottom: '1.25rem'
            }}>
              <FileText size={36} color="var(--pa-blue-primary)" style={{ margin: '0 auto 0.5rem' }} />
              <div style={{ fontWeight: 700, color: 'var(--pa-blue-dark)' }}>Nomina_Rappresentante_2026.pdf</div>
              <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)' }}>Documento firmato digitalmente con marca temporale</div>
            </div>

            {/* Note input */}
            <div className="form-group">
              <label className="form-label">Note o Motivazione dell'Operatore (per Audit Log):</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Inserisci eventuali annotazioni di verifica verbale o motivazioni..."
                className="form-control"
                style={{ height: '80px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => setSelectedReq(null)} className="btn btn-secondary">
                Annulla
              </button>
              <button onClick={() => handleReject(selectedReq.id)} className="btn btn-danger">
                <X size={16} />
                <span>Respingi Delega</span>
              </button>
              <button onClick={() => handleApprove(selectedReq.id)} className="btn btn-success">
                <Check size={16} />
                <span>Approva Delega</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
