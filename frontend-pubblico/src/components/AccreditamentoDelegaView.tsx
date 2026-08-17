import React, { useState } from 'react';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import { creaAssociazione, caricaDocumento, type DatiCreaAssociazione } from '../api/associazioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { CheckCircle2, Shield, Building2, Plus } from 'lucide-react';

interface AccreditamentoDelegaProps {
  entities: EntitaRappresentata[];
  stagioneId: string | null;
  onRicarica: () => void;
}

const TIPO_DOCUMENTO_OPZIONI: Array<{ value: 'statuto' | 'atto_costitutivo' | 'altro'; label: string }> = [
  { value: 'statuto', label: 'Statuto' },
  { value: 'atto_costitutivo', label: 'Atto Costitutivo' },
  { value: 'altro', label: 'Altro' },
];

export const AccreditamentoDelegaView: React.FC<AccreditamentoDelegaProps> = ({ entities, stagioneId, onRicarica }) => {
  const [showModal, setShowModal] = useState(false);
  const [denominazione, setDenominazione] = useState('');
  const [codiceFiscalePartitaIva, setCodiceFiscalePartitaIva] = useState('');
  const [rnaNumeroIscrizione, setRnaNumeroIscrizione] = useState('');
  const [dataCostituzione, setDataCostituzione] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<'statuto' | 'atto_costitutivo' | 'altro'>('statuto');
  const [file, setFile] = useState<File | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [avvisoUploadFallito, setAvvisoUploadFallito] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const resetForm = (): void => {
    setDenominazione('');
    setCodiceFiscalePartitaIva('');
    setRnaNumeroIscrizione('');
    setDataCostituzione('');
    setFile(null);
    setTipoDocumento('statuto');
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!stagioneId) {
      setErrore('Nessuna stagione selezionata: seleziona una stagione dall\'intestazione prima di procedere.');
      return;
    }
    setErrore(null);
    setAvvisoUploadFallito(null);
    setInCorso(true);
    try {
      const dati: DatiCreaAssociazione = {
        denominazione,
        codiceFiscalePartitaIva,
        stagioneId,
        ...(rnaNumeroIscrizione ? { rnaNumeroIscrizione } : {}),
        ...(dataCostituzione ? { dataCostituzione } : {}),
      };
      const associazione = await creaAssociazione(dati);
      if (file) {
        try {
          await caricaDocumento(associazione.id, file, tipoDocumento);
        } catch (errUpload) {
          // L'associazione è comunque creata: un fallimento dell'upload non deve
          // sembrare un fallimento totale dell'operazione.
          setAvvisoUploadFallito(
            errUpload instanceof ErroreRichiestaApi
              ? `Associazione creata, ma il caricamento del documento è fallito: ${errUpload.message}`
              : 'Associazione creata, ma il caricamento del documento è fallito. Puoi ritentare in seguito.',
          );
        }
      }
      onRicarica();
      setShowModal(false);
      resetForm();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante la richiesta di accreditamento.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
            Gestione Deleghe & Rappresentanza Legale
          </h2>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Accreditamento della tua persona fisica (SPID) a nome delle Associazioni Sportive della Provincia
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">
          <Plus size={16} />
          <span>Richiedi Nuova Delega Rappresentanza</span>
        </button>
      </div>

      {avvisoUploadFallito && (
        <div style={{ backgroundColor: '#FEF9E7', color: '#B7950B', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {avvisoUploadFallito}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {entities.length === 0 && (
          <div className="pa-card" style={{ color: 'var(--pa-text-muted)' }}>
            Nessuna associazione accreditata. Usa "Richiedi Nuova Delega Rappresentanza" per iniziare.
          </div>
        )}
        {entities.map(ent => (
          <div key={ent.id} className="pa-card" style={{ borderTop: '4px solid var(--pa-blue-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <Building2 size={24} color="var(--pa-blue-primary)" />
                <div>
                  <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>{ent.associazioneDenominazione ?? '—'}</h3>
                  <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)' }}>P.IVA / CF: {ent.associazioneCodiceFiscalePartitaIva ?? '—'}</div>
                </div>
              </div>
              {ent.stato === 'approvata' && <span className="badge badge-success"><CheckCircle2 size={12} /> Approvato</span>}
              {ent.stato === 'in_attesa' && <span className="badge badge-warning">In Esame Operatore</span>}
              {ent.stato === 'respinta' && <span className="badge badge-danger">Respinto</span>}
              {ent.stato === 'revocata' && <span className="badge badge-danger">Revocato</span>}
            </div>
            <div style={{ backgroundColor: '#F8FAFC', padding: '0.75rem', borderRadius: '6px', fontSize: '0.825rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--pa-text-muted)' }}>Ruolo:</span>
                <strong>{ent.titolo === 'legale_rappresentante' ? 'Legale Rappresentante' : 'Delegato'} ({ent.ruolo})</strong>
              </div>
            </div>
            {/* L'azione "Invita delegato" per le entità approvata arriva nel Task 4. */}
          </div>
        ))}
      </div>

      <div className="pa-card" style={{ backgroundColor: '#EBF5FB', borderLeft: '4px solid var(--pa-blue-primary)' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Shield size={24} color="var(--pa-blue-primary)" style={{ flexShrink: 0 }} />
          <div>
            <h4 style={{ color: 'var(--pa-blue-dark)', fontSize: '1rem' }}>Art. 3 Documento Principale — Tracciabilità Identità Digitale</h4>
            <p style={{ fontSize: '0.85rem', color: '#1B4F72', marginTop: '3px' }}>
              Ogni operazione eseguita nel portale viene associata sia all'identità SPID della persona fisica operante, sia all'associazione rappresentata. La delega viene verificata dagli operatori della Provincia prima dell'ammissione alle domande.
            </p>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--pa-blue-dark)' }}>Richiesta Nuova Delega Rappresentanza</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-denominazione">Denominazione Ufficiale Associazione:</label>
                <input id="acc-denominazione" type="text" required value={denominazione}
                  onChange={(e) => setDenominazione(e.target.value)} placeholder="Es. ASD Pescara Basket" className="form-control" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-cf">Codice Fiscale / P.IVA:</label>
                  <input id="acc-cf" type="text" required value={codiceFiscalePartitaIva}
                    onChange={(e) => setCodiceFiscalePartitaIva(e.target.value)} placeholder="Es. 92012340681" className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="acc-rna">Numero Iscrizione RNA (opzionale):</label>
                  <input id="acc-rna" type="text" value={rnaNumeroIscrizione}
                    onChange={(e) => setRnaNumeroIscrizione(e.target.value)} className="form-control" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-data-costituzione">Data Costituzione (opzionale):</label>
                <input id="acc-data-costituzione" type="date" value={dataCostituzione}
                  onChange={(e) => setDataCostituzione(e.target.value)} className="form-control" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-tipo-doc">Tipo Documento (opzionale):</label>
                <select id="acc-tipo-doc" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value as typeof tipoDocumento)} className="form-control">
                  {TIPO_DOCUMENTO_OPZIONI.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="acc-file">Carica Documento (PDF, opzionale):</label>
                <input id="acc-file" type="file" accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="form-control" />
                {file && (
                  <div style={{ fontWeight: 700, color: 'var(--pa-success)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem' }}>
                    <CheckCircle2 size={16} /> {file.name}
                  </div>
                )}
              </div>
              {errore && (
                <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginTop: '0.75rem' }}>
                  {errore}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button type="button" onClick={() => { setShowModal(false); resetForm(); setErrore(null); }} className="btn btn-secondary">Annulla</button>
                <button type="submit" className="btn btn-primary" disabled={inCorso}>
                  {inCorso ? 'Invio in corso…' : 'Invia Delega all\'Operatore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
