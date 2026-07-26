import React, { useState } from 'react';
import { mockConcertazioneProposals } from '../mockData';
import { ConcertazioneProposal } from '../types';
import { RefreshCw, ArrowLeftRight, Check, X, ShieldAlert, Sparkles, Send } from 'lucide-react';

export const ConcertazioneView: React.FC = () => {
  const [proposals, setProposals] = useState<ConcertazioneProposal[]>(mockConcertazioneProposals);
  const [showNewProposalModal, setShowNewProposalModal] = useState(false);

  const handleAccept = (id: string) => {
    setProposals(prev => prev.map(p => p.id === id ? { ...p, stato: 'accettato' } : p));
  };

  const handleReject = (id: string) => {
    setProposals(prev => prev.map(p => p.id === id ? { ...p, stato: 'rifiutato' } : p));
  };

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
            Piattaforma di Concertazione & Scambio Slot (Fase 11 - Art. B.24-B.26)
          </h2>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Modulo per proposte bilaterali di scambio slot tra associazioni concorrenti con simulazione ISF live
          </p>
        </div>

        <button onClick={() => setShowNewProposalModal(true)} className="btn btn-primary">
          <ArrowLeftRight size={16} />
          <span>Proponi Nuovo Scambio Slot</span>
        </button>
      </div>

      {/* Notice Card */}
      <div className="pa-card" style={{ backgroundColor: '#EBF5FB', borderLeft: '4px solid var(--pa-blue-primary)' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Sparkles size={24} color="var(--pa-blue-primary)" style={{ flexShrink: 0 }} />
          <div>
            <h4 style={{ color: 'var(--pa-blue-dark)', margin: 0 }}>Risoluzione Concorrente FIFO & Validazione Automated (Art. B.27)</h4>
            <p style={{ fontSize: '0.825rem', color: '#1B4F72', marginTop: '2px' }}>
              Le proposte concordate da entrambe le associazioni vengono validate serialmente in ordine FIFO. Il motore Go verifica la compatibilità temporale e l'assenza di sovrapposizioni a livello DB con lock ottimistico.
            </p>
          </div>
        </div>
      </div>

      {/* Active Proposals Table */}
      <div className="pa-card">
        <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>
          Proposte di Scambio Ricevute ed Inviate
        </h3>

        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Associazione Proponente</th>
                <th>Slot Offerto</th>
                <th>Slot Richiesto in Cambio</th>
                <th>Impatto ISF Stimato</th>
                <th>Stato Proposta</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(p => (
                <tr key={p.id}>
                  <td><strong>{p.associazioneProponente}</strong></td>
                  <td>
                    <div style={{ fontSize: '0.825rem', color: 'var(--pa-blue-primary)', fontWeight: 600 }}>{p.slotOfferto}</div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.825rem', color: 'var(--pa-blue-dark)', fontWeight: 600 }}>{p.slotRichiesto}</div>
                  </td>
                  <td>
                    <span className="badge badge-success">
                      +{(p.impattoIsfRicevente * 100).toFixed(1)}% ISF
                    </span>
                  </td>
                  <td>
                    {p.stato === 'in_attesa' && <span className="badge badge-warning">In Attesa Tua Risposta</span>}
                    {p.stato === 'accettato' && <span className="badge badge-success">Accettato & Validato</span>}
                    {p.stato === 'rifiutato' && <span className="badge badge-danger">Rifiutato</span>}
                  </td>
                  <td>
                    {p.stato === 'in_attesa' && (
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button onClick={() => handleAccept(p.id)} className="btn btn-success btn-sm" style={{ padding: '0.2rem 0.5rem' }}>
                          <Check size={14} /> Accetta
                        </button>
                        <button onClick={() => handleReject(p.id)} className="btn btn-danger btn-sm" style={{ padding: '0.2rem 0.5rem' }}>
                          <X size={14} /> Rifiuta
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Proposal Modal */}
      {showNewProposalModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--pa-blue-dark)' }}>Proponi Scambio Slot ad Altra ASD</h3>

            <div className="form-group">
              <label className="form-label">Seleziona Associazione Destinataria dello Scambio:</label>
              <select className="form-control">
                <option value="ass-02">ASD Basket Pescara 1976</option>
                <option value="ass-03">SSD Montesilvano Calcio a 5</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Tuo Slot da Cedere / Offrire:</label>
              <select className="form-control">
                <option value="s1">Lunedì 17:00 - 19:00 @ Palestra Galilei</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Slot Desiderato dell'Altra Associazione:</label>
              <select className="form-control">
                <option value="s2">Martedì 17:00 - 19:00 @ Palestra Galilei</option>
              </select>
            </div>

            <div style={{ backgroundColor: '#E8F8F5', padding: '0.85rem', borderRadius: '6px', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--pa-success)' }}>SIMULAZIONE IMPATTO ISF:</div>
              <div style={{ fontSize: '0.85rem', color: '#16A085', marginTop: '2px' }}>
                Accettando lo scambio il tuo ISF passerà da <strong>0,857</strong> a <strong>0,892 (+3.5%)</strong>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={() => setShowNewProposalModal(false)} className="btn btn-secondary">
                Annulla
              </button>
              <button
                onClick={() => {
                  alert('Proposta di scambio inviata all\'associazione partner!');
                  setShowNewProposalModal(false);
                }}
                className="btn btn-primary"
              >
                <Send size={16} />
                <span>Invia Proposta di Scambio</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
