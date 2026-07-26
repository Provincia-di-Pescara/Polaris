import React, { useState } from 'react';
import { RepresentedEntity } from '../types';
import { FileCheck2, Plus, Upload, CheckCircle2, Shield, Building2, FileText, AlertCircle } from 'lucide-react';

interface AccreditamentoDelegaProps {
  entities: RepresentedEntity[];
  onAddNewEntity: (newEnt: RepresentedEntity) => void;
}

export const AccreditamentoDelegaView: React.FC<AccreditamentoDelegaProps> = ({
  entities,
  onAddNewEntity
}) => {
  const [showModal, setShowModal] = useState(false);
  const [nomeEnte, setNomeEnte] = useState('');
  const [cfEnte, setCfEnte] = useState('');
  const [tipoEnte, setTipoEnte] = useState<'ASD' | 'SSD' | 'Istituto Scolastico'>('ASD');
  const [ruolo, setRuolo] = useState<'Legale Rappresentante' | 'Delegato'>('Legale Rappresentante');
  const [fileName, setFileName] = useState<string | null>(null);

  const handleSubmitNewDelega = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeEnte || !cfEnte) return;

    const newEnt: RepresentedEntity = {
      id: `ass-${Date.now()}`,
      nome: nomeEnte,
      codiceFiscale: cfEnte,
      tipo: tipoEnte,
      ruoloPersona: ruolo,
      statoAccreditamento: 'in_attesa',
      isAttiva: false
    };

    onAddNewEntity(newEnt);
    setShowModal(false);
    setNomeEnte('');
    setCfEnte('');
    setFileName(null);
  };

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title & Introduction */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
            Gestione Deleghe & Rappresentanza Legale
          </h2>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Accreditamento della tua persona fisica (SPID) a nome delle Associazioni Sportive o Scuole della Provincia
          </p>
        </div>

        <button onClick={() => setShowModal(true)} className="btn btn-primary">
          <Plus size={16} />
          <span>Richiedi Nuova Delega Rappresentanza</span>
        </button>
      </div>

      {/* Active Entities List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {entities.map(ent => (
          <div key={ent.id} className="pa-card" style={{ borderTop: '4px solid var(--pa-blue-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <Building2 size={24} color="var(--pa-blue-primary)" />
                <div>
                  <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>{ent.nome}</h3>
                  <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)' }}>P.IVA / CF: {ent.codiceFiscale}</div>
                </div>
              </div>

              {ent.statoAccreditamento === 'approvato' && (
                <span className="badge badge-success">
                  <CheckCircle2 size={12} /> Approvato
                </span>
              )}
              {ent.statoAccreditamento === 'in_attesa' && (
                <span className="badge badge-warning">
                  In Esame Operatore
                </span>
              )}
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '0.75rem', borderRadius: '6px', fontSize: '0.825rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--pa-text-muted)' }}>Ruolo Dichiarato:</span>
                <strong>{ent.ruoloPersona}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--pa-text-muted)' }}>Tipologia Ente:</span>
                <span className="badge badge-info">{ent.tipo}</span>
              </div>
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>
                {ent.statoAccreditamento === 'approvato' ? 'Abilitato alla presentazione domande' : 'Richiesta in attesa di validazione prov.'}
              </div>
              <button className="btn btn-secondary btn-sm">Dettagli Delega</button>
            </div>
          </div>
        ))}
      </div>

      {/* Normative Notice Box */}
      <div className="pa-card" style={{ backgroundColor: '#EBF5FB', borderLeft: '4px solid var(--pa-blue-primary)' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Shield size={24} color="var(--pa-blue-primary)" style={{ flexShrink: 0 }} />
          <div>
            <h4 style={{ color: 'var(--pa-blue-dark)', fontSize: '1rem' }}>Art. 3 Documento Principale — Tracciabilità Identità Digitale</h4>
            <p style={{ fontSize: '0.85rem', color: '#1B4F72', marginTop: '3px' }}>
              Ogni operazione eseguita nel portale viene associata sia all'identità SPID della persona fisica operante, sia all'associazione rappresentata. La delega caricata viene verificata dagli operatori della Provincia prima dell'ammissione alle domande.
            </p>
          </div>
        </div>
      </div>

      {/* New Delega Request Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--pa-blue-dark)' }}>Richiesta Nuova Delega Rappresentanza</h3>

            <form onSubmit={handleSubmitNewDelega}>
              <div className="form-group">
                <label className="form-label">Denominazione Ufficiale Associazione / Scuola:</label>
                <input
                  type="text"
                  required
                  value={nomeEnte}
                  onChange={(e) => setNomeEnte(e.target.value)}
                  placeholder="Es. ASD Pescara Basket, I.T.C.T. A. Volta"
                  className="form-control"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Codice Fiscale / P.IVA Ente:</label>
                  <input
                    type="text"
                    required
                    value={cfEnte}
                    onChange={(e) => setCfEnte(e.target.value)}
                    placeholder="Es. 92012340681"
                    className="form-control"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Tipologia Ente:</label>
                  <select
                    value={tipoEnte}
                    onChange={(e) => setTipoEnte(e.target.value as any)}
                    className="form-control"
                  >
                    <option value="ASD">ASD (Associazione Sportiva Dilettantistica)</option>
                    <option value="SSD">SSD (Società Sportiva Dilettantistica)</option>
                    <option value="Istituto Scolastico">Istituto Scolastico Provinciale</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Ruolo Ricoperto:</label>
                <select
                  value={ruolo}
                  onChange={(e) => setRuolo(e.target.value as any)}
                  className="form-control"
                >
                  <option value="Legale Rappresentante">Legale Rappresentante (Presidente / Dirigente)</option>
                  <option value="Delegato">Delegato con Procura Formalizzata</option>
                </select>
              </div>

              {/* Upload Document Box */}
              <div className="form-group">
                <label className="form-label">Carica Atto di Nomina / Delega con Firma (PDF):</label>
                <div
                  style={{
                    border: '2px dashed var(--pa-border)',
                    borderRadius: '8px',
                    padding: '1.25rem',
                    textAlign: 'center',
                    backgroundColor: '#FAFAFA',
                    cursor: 'pointer'
                  }}
                  onClick={() => setFileName('Atto_Delega_PescaraVolley_2026.pdf')}
                >
                  <Upload size={28} color="var(--pa-blue-primary)" style={{ margin: '0 auto 0.4rem' }} />
                  {fileName ? (
                    <div style={{ fontWeight: 700, color: 'var(--pa-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                      <CheckCircle2 size={16} /> {fileName} (Pronto per invio)
                    </div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Clicca qui per selezionare il file PDF</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>PDF max 10MB con documento d'identità allegato</div>
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary">
                  Invia Delega all'Operatore
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
