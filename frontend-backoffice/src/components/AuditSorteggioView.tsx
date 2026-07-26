import React, { useState } from 'react';
import { mockAuditLogs, mockHMACVerbali } from '../mockData';
import { AuditLogItem, HMACSorteggioVerbale } from '../types';
import { ShieldCheck, Lock, Search, RefreshCw, KeyRound, CheckCircle2, FileCode, Hash, Award } from 'lucide-react';

export const AuditSorteggioView: React.FC = () => {
  const [logs] = useState<AuditLogItem[]>(mockAuditLogs);
  const [verbali] = useState<HMACSorteggioVerbale[]>(mockHMACVerbali);
  const [selectedVerbale, setSelectedVerbale] = useState<HMACSorteggioVerbale | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);

  const handleVerifyHMAC = () => {
    setIsVerifying(true);
    setVerifiedSuccess(false);

    setTimeout(() => {
      setIsVerifying(false);
      setVerifiedSuccess(true);
    }, 1200);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title */}
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Audit Log & Verbali Sorteggio Tracciato HMAC</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Tracciabilità legale delle operazioni di scrittura (Art. B.39) e riproducibilità deterministica dai terzi (Art. B.38)
        </p>
      </div>

      {/* HMAC Sorteggio Highlight Card */}
      <div className="pa-card" style={{ borderTop: '4px solid var(--pa-accent)', backgroundColor: '#F0FDFA' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <KeyRound size={20} color="#0D9488" />
              <h3 style={{ margin: 0, color: '#0F766E', fontSize: '1.1rem' }}>Verbali di Sorteggio Deterministi (HMAC-SHA256)</h3>
            </div>
            <p style={{ fontSize: '0.825rem', color: '#115E59', marginTop: '4px' }}>
              Il seme generato via CSPRNG viene congelato prima dell'elaborazione. Terzi ed enti esterni possono ricalcolare e verificare i verbali bit-per-bit.
            </p>
          </div>

          <button
            onClick={() => setSelectedVerbale(verbali[0])}
            className="btn btn-primary"
            style={{ backgroundColor: '#0D9488', borderColor: '#0F766E' }}
          >
            <ShieldCheck size={16} />
            <span>Ispeziona & Verifica Verbale #0042</span>
          </button>
        </div>
      </div>

      {/* Main Tabs: Audit Log Table */}
      <div className="pa-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>
            Registro Tracciabilità Scritture (`log_operazioni`)
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <span className="badge badge-info">Retention: 30 Giorni</span>
          </div>
        </div>

        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Data & Ora</th>
                <th>Attore Registrato</th>
                <th>Ruolo</th>
                <th>Operazione</th>
                <th>Dettagli Operazione</th>
                <th>Indirizzo IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td><div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{log.timestamp}</div></td>
                  <td><strong>{log.attore}</strong></td>
                  <td><span className="badge badge-neutral">{log.ruoloAttore}</span></td>
                  <td><span className="badge badge-info">{log.tipoOperazione}</span></td>
                  <td style={{ fontSize: '0.825rem' }}>{log.descrizione}</td>
                  <td><code style={{ fontSize: '0.75rem' }}>{log.ipAddress}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* HMAC Verification Modal */}
      {selectedVerbale && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '750px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--pa-blue-dark)' }}>Ispezione & Verifica Verbale di Sorteggio</h3>
                <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)' }}>ID: {selectedVerbale.id} • Articolo: {selectedVerbale.articoloRiferimento}</div>
              </div>
              <button onClick={() => setSelectedVerbale(null)} className="btn btn-secondary btn-sm">Chiudi</button>
            </div>

            {/* Seme & Hash info */}
            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--pa-text-muted)', marginBottom: '0.25rem' }}>
                SEME CSPRNG (32 Byte Hex - Pubblicato Prima dell'Algoritmo):
              </div>
              <code style={{ fontSize: '0.75rem', color: 'var(--pa-blue-primary)', wordBreak: 'break-all', display: 'block', backgroundColor: 'white', padding: '0.4rem', border: '1px solid #CBD5E1', borderRadius: '4px' }}>
                {selectedVerbale.semeHex}
              </code>

              <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--pa-text-muted)', marginBottom: '0.25rem' }}>
                HASH VERBALE INTEGRITÀ (`hash_verbale` SHA-256):
              </div>
              <code style={{ fontSize: '0.75rem', color: '#8E44AD', wordBreak: 'break-all', display: 'block', backgroundColor: 'white', padding: '0.4rem', border: '1px solid #CBD5E1', borderRadius: '4px' }}>
                {selectedVerbale.hashVerbaleHex}
              </code>
            </div>

            {/* Candidates HMAC Table */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--pa-blue-dark)', marginBottom: '0.5rem' }}>
                Ranking Calcolato (HMAC-SHA256 Minore = Vincitore)
              </div>
              <div className="pa-table-container">
                <table className="pa-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Associazione Candidata</th>
                      <th>HMAC-SHA256(seme ‖ id)</th>
                      <th>Esito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedVerbale.candidati.map(c => (
                      <tr key={c.associazioneId} style={{ backgroundColor: c.rank === 1 ? '#E8F8F5' : 'white' }}>
                        <td><strong>#{c.rank}</strong></td>
                        <td><strong>{c.associazioneNome}</strong></td>
                        <td><code style={{ fontSize: '0.725rem' }}>{c.hmacHex.substring(0, 24)}...</code></td>
                        <td>
                          {c.rank === 1 ? (
                            <span className="badge badge-success">
                              <Award size={12} /> Vincitore Sorteggio
                            </span>
                          ) : (
                            <span className="badge badge-neutral">Non Selezionato</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Verification trigger */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--pa-border)', paddingTop: '1rem' }}>
              <div>
                {verifiedSuccess && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--pa-success)', fontWeight: 700, fontSize: '0.875rem' }}>
                    <CheckCircle2 size={18} />
                    <span>Ricalcolo 100% Corrispondente — Verbale Autentico</span>
                  </div>
                )}
              </div>

              <button
                onClick={handleVerifyHMAC}
                disabled={isVerifying}
                className="btn btn-primary"
              >
                <RefreshCw size={16} className={isVerifying ? 'spin' : ''} />
                <span>{isVerifying ? 'Ricalcolo in corso...' : 'Ricalcola & Verifica HMAC'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
