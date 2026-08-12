import React, { useEffect, useState } from 'react';
import {
  listaDeleghe,
  approvaDelega,
  respingiDelega,
  revocaDelega,
  listaDocumenti,
  scaricaDocumentoBlob,
  type AbilitazioneConDettagli,
  type DocumentoAssociazioneMeta,
  ErroreRichiestaApi,
} from '../api/deleghe.ts';
import { Check, X, Eye, User, Building } from 'lucide-react';

export const DelegheAccreditamentiView: React.FC = () => {
  const [deleghe, setDeleghe] = useState<AbilitazioneConDettagli[]>([]);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [selezionata, setSelezionata] = useState<AbilitazioneConDettagli | null>(null);
  const [documenti, setDocumenti] = useState<DocumentoAssociazioneMeta[]>([]);
  const [urlDocumentoAttivo, setUrlDocumentoAttivo] = useState<string | null>(null);
  const [motivazione, setMotivazione] = useState('');
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [filtro, setFiltro] = useState<'tutte' | 'in_attesa' | 'approvata'>('tutte');

  const ricarica = (): void => {
    listaDeleghe(filtro === 'tutte' ? {} : { stato: filtro })
      .then(setDeleghe)
      .catch(() => setErroreCaricamento('Impossibile caricare le deleghe.'));
  };

  useEffect(ricarica, [filtro]);

  const apriValutazione = (d: AbilitazioneConDettagli): void => {
    setSelezionata(d);
    setMotivazione('');
    setErroreAzione(null);
    setDocumenti([]);
    setUrlDocumentoAttivo(null);
    if (d.associazioneId) {
      listaDocumenti(d.associazioneId).then(setDocumenti).catch(() => setDocumenti([]));
    }
  };

  const apriDocumento = async (id: string): Promise<void> => {
    try {
      const url = await scaricaDocumentoBlob(id);
      setUrlDocumentoAttivo(url);
    } catch {
      setErroreAzione('Impossibile scaricare il documento.');
    }
  };

  const handleApprova = async (): Promise<void> => {
    if (!selezionata) return;
    setInCorso(true);
    setErroreAzione(null);
    try {
      await approvaDelega(selezionata.id);
      setSelezionata(null);
      ricarica();
    } catch (err) {
      setErroreAzione(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  const handleRespingi = async (): Promise<void> => {
    if (!selezionata) return;
    setInCorso(true);
    setErroreAzione(null);
    try {
      await respingiDelega(selezionata.id, motivazione);
      setSelezionata(null);
      ricarica();
    } catch (err) {
      setErroreAzione(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  const handleRevoca = async (id: string): Promise<void> => {
    setInCorso(true);
    setErroreAzione(null);
    try {
      await revocaDelega(id);
      setSelezionata(null);
      ricarica();
    } catch (err) {
      setErroreAzione(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Gestione Deleghe & Accreditamenti (Art. 3 Doc. Principale)</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Verifica operatore delle associazioni delle persone fisiche (autenticate via SPID/CIE) alle ASD/SSD titolari
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setFiltro('tutte')} className={`btn btn-sm ${filtro === 'tutte' ? 'btn-primary' : 'btn-secondary'}`}>
            Tutte
          </button>
          <button onClick={() => setFiltro('in_attesa')} className={`btn btn-sm ${filtro === 'in_attesa' ? 'btn-primary' : 'btn-secondary'}`}>
            In Attesa
          </button>
          <button onClick={() => setFiltro('approvata')} className={`btn btn-sm ${filtro === 'approvata' ? 'btn-primary' : 'btn-secondary'}`}>
            Approvate
          </button>
        </div>
      </div>

      {erroreCaricamento && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {erroreCaricamento}
        </div>
      )}

      <div className="pa-card">
        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Persona Fisica</th>
                <th>Associazione</th>
                <th>Ruolo</th>
                <th>Stato</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              {deleghe.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <User size={16} color="var(--pa-blue-primary)" />
                      <div>
                        <div style={{ fontWeight: 700 }}>{d.personaFisicaCognome} {d.personaFisicaNome}</div>
                        <div style={{ fontSize: '0.725rem', color: 'var(--pa-text-muted)' }}>CF: {d.personaFisicaCodiceFiscale}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Building size={16} color="var(--pa-text-muted)" />
                      <div style={{ fontWeight: 700 }}>{d.associazioneDenominazione ?? '—'}</div>
                    </div>
                  </td>
                  <td><span className="badge badge-info">{d.ruolo}</span></td>
                  <td>
                    {d.stato === 'approvata' && <span className="badge badge-success">Approvata</span>}
                    {d.stato === 'in_attesa' && <span className="badge badge-warning">In Attesa</span>}
                    {d.stato === 'respinta' && <span className="badge badge-danger">Respinta</span>}
                    {d.stato === 'revocata' && <span className="badge badge-neutral">Revocata</span>}
                  </td>
                  <td>
                    <button onClick={() => apriValutazione(d)} className="btn btn-primary btn-sm">
                      Valuta Delega
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selezionata && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Valutazione Delega</h3>
              <button onClick={() => setSelezionata(null)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700 }}>{selezionata.personaFisicaCognome} {selezionata.personaFisicaNome}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>{selezionata.associazioneDenominazione}</div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Documenti caricati</div>
              {documenti.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>Nessun documento.</div>}
              {documenti.map((doc) => (
                <button key={doc.id} onClick={() => apriDocumento(doc.id)} className="btn btn-secondary btn-sm" style={{ marginRight: '0.5rem' }}>
                  <Eye size={14} />
                  <span>{doc.tipo}</span>
                </button>
              ))}
              {urlDocumentoAttivo && (
                <iframe src={urlDocumentoAttivo} title="Documento associazione" style={{ width: '100%', height: '360px', marginTop: '0.75rem', border: '1px solid var(--pa-border)' }} />
              )}
            </div>

            <div className="form-group">
              <label htmlFor="delega-motivazione" className="form-label">Motivazione (per rigetto):</label>
              <textarea
                id="delega-motivazione"
                value={motivazione}
                onChange={(e) => setMotivazione(e.target.value)}
                className="form-control"
                style={{ height: '80px' }}
              />
            </div>

            {erroreAzione && (
              <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginTop: '0.5rem' }}>
                {erroreAzione}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => handleRevoca(selezionata.id)} className="btn btn-secondary" disabled={inCorso}>
                Revoca
              </button>
              <button onClick={handleRespingi} className="btn btn-danger" disabled={inCorso}>
                <X size={16} />
                <span>Respingi Delega</span>
              </button>
              <button onClick={handleApprova} className="btn btn-success" disabled={inCorso}>
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
