import React, { useEffect, useState } from 'react';
import {
  listaBackup,
  eseguiBackupManuale,
  elencoTabelle,
  eseguiRipristino,
  scaricaBackup,
  type VoceBackup,
} from '../api/backup.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { DatabaseBackup, Download, RotateCcw, AlertTriangle, X } from 'lucide-react';

const STILE_ERRORE: React.CSSProperties = {
  backgroundColor: 'var(--pa-danger-bg)',
  color: 'var(--pa-danger)',
  padding: '0.6rem 0.85rem',
  borderRadius: '6px',
  fontSize: '0.85rem',
};

const ETICHETTA_ORIGINE: Record<VoceBackup['origine'], { testo: string; classe: string }> = {
  schedulato: { testo: 'Schedulato', classe: 'badge badge-info' },
  manuale: { testo: 'Manuale', classe: 'badge badge-secondary' },
};

function formattaData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT');
}

function formattaDimensione(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  const kb = byte / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

const TESTO_CONFERMA = 'RIPRISTINA';

export const BackupView: React.FC = () => {
  const [backup, setBackup] = useState<VoceBackup[]>([]);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  // Flusso di ripristino: apertura -> caricamento elenco tabelle del dump ->
  // scelta esclusioni -> conferma testuale (azione distruttiva: sovrascrive
  // il DB corrente sulle tabelle non escluse).
  const [ripristinoTarget, setRipristinoTarget] = useState<VoceBackup | null>(null);
  const [tabelleDisponibili, setTabelleDisponibili] = useState<string[]>([]);
  const [tabelleEscluse, setTabelleEscluse] = useState<Set<string>>(new Set());
  const [caricamentoTabelle, setCaricamentoTabelle] = useState(false);
  const [testoConferma, setTestoConferma] = useState('');

  const ricarica = (): void => {
    listaBackup()
      .then(setBackup)
      .catch((err) => setErroreCaricamento(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare i backup.'));
  };

  useEffect(ricarica, []);

  const resetMessaggi = (): void => {
    setErrore(null);
    setMessaggio(null);
  };

  const handleEseguiBackup = async (): Promise<void> => {
    resetMessaggi();
    setInCorso(true);
    try {
      await eseguiBackupManuale();
      setMessaggio('Backup manuale completato.');
      ricarica();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante il backup.');
    } finally {
      setInCorso(false);
    }
  };

  const handleScarica = async (voce: VoceBackup): Promise<void> => {
    resetMessaggi();
    try {
      await scaricaBackup(voce.nome);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante il download.');
    }
  };

  const apriRipristino = async (voce: VoceBackup): Promise<void> => {
    resetMessaggi();
    setRipristinoTarget(voce);
    setTabelleEscluse(new Set());
    setTestoConferma('');
    setCaricamentoTabelle(true);
    try {
      const tabelle = await elencoTabelle(voce.nome);
      setTabelleDisponibili(tabelle);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile leggere le tabelle del backup.');
      setRipristinoTarget(null);
    } finally {
      setCaricamentoTabelle(false);
    }
  };

  const chiudiRipristino = (): void => {
    setRipristinoTarget(null);
    setTabelleDisponibili([]);
    setTabelleEscluse(new Set());
    setTestoConferma('');
  };

  const toggleTabellaEsclusa = (tabella: string): void => {
    setTabelleEscluse((prev) => {
      const nuovo = new Set(prev);
      if (nuovo.has(tabella)) nuovo.delete(tabella);
      else nuovo.add(tabella);
      return nuovo;
    });
  };

  const handleConfermaRipristino = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!ripristinoTarget || testoConferma !== TESTO_CONFERMA) return;
    resetMessaggi();
    setInCorso(true);
    try {
      const esito = await eseguiRipristino(ripristinoTarget.nome, Array.from(tabelleEscluse));
      setMessaggio(
        `Ripristino completato: ${esito.tabelleRipristinate.length} tabelle ripristinate` +
          (esito.tabelleEscluse.length > 0 ? `, ${esito.tabelleEscluse.length} escluse.` : '.'),
      );
      chiudiRipristino();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante il ripristino.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Backup & Ripristino</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Backup schedulato giornaliero (sempre full) + backup manuale on-demand. Il ripristino può escludere
            singole tabelle, rispettando le dipendenze (FK).
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleEseguiBackup} disabled={inCorso}>
          <DatabaseBackup size={16} />
          <span>{inCorso ? 'Backup in corso…' : 'Esegui backup ora'}</span>
        </button>
      </div>

      {erroreCaricamento && <div style={STILE_ERRORE}>{erroreCaricamento}</div>}
      {messaggio && (
        <div style={{ backgroundColor: 'var(--pa-success-bg)', color: 'var(--pa-success)', padding: '0.6rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem' }}>
          {messaggio}
        </div>
      )}
      {errore && !ripristinoTarget && <div style={STILE_ERRORE}>{errore}</div>}

      <div className="pa-card">
        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Origine</th>
                <th>Dimensione</th>
                <th>Creato il</th>
                <th>Formato</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {backup.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--pa-text-muted)' }}>Nessun backup disponibile.</td>
                </tr>
              )}
              {backup.map((voce) => (
                <tr key={voce.nome}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{voce.nome}</td>
                  <td><span className={ETICHETTA_ORIGINE[voce.origine].classe}>{ETICHETTA_ORIGINE[voce.origine].testo}</span></td>
                  <td>{formattaDimensione(voce.dimensioneByte)}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>{formattaData(voce.creatoIl)}</td>
                  <td>
                    {voce.formatoValido ? (
                      <span className="badge badge-success">Valido</span>
                    ) : (
                      <span className="badge badge-danger" title="Non riconosciuto come dump pg_dump -Fc">Non valido</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleScarica(voce)} disabled={!voce.formatoValido}>
                        <Download size={14} />
                        <span>Scarica</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => apriRipristino(voce)}
                        disabled={inCorso || !voce.formatoValido}
                      >
                        <RotateCcw size={14} />
                        <span>Ripristina</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ripristinoTarget && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem', width: '520px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Ripristina backup</h3>
              <button type="button" onClick={chiudiRipristino} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--pa-text-muted)', marginBottom: '1rem' }}>
              {ripristinoTarget.nome}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.6rem',
                alignItems: 'flex-start',
                backgroundColor: 'var(--pa-danger-bg)',
                color: 'var(--pa-danger)',
                padding: '0.75rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                marginBottom: '1rem',
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
              <span>
                Operazione distruttiva: sovrascrive i dati correnti nelle tabelle non escluse (pg_restore --clean).
                Non reversibile se non con un nuovo ripristino da un backup precedente.
              </span>
            </div>

            {caricamentoTabelle ? (
              <p style={{ color: 'var(--pa-text-muted)' }}>Caricamento elenco tabelle…</p>
            ) : (
              <form onSubmit={handleConfermaRipristino} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                    Tabelle da escludere dal ripristino ({tabelleEscluse.size} di {tabelleDisponibili.length})
                  </p>
                  <div
                    style={{
                      maxHeight: '220px',
                      overflowY: 'auto',
                      border: '1px solid var(--pa-border)',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                    }}
                  >
                    {tabelleDisponibili.map((tabella) => (
                      <label key={tabella} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                        <input
                          type="checkbox"
                          checked={tabelleEscluse.has(tabella)}
                          onChange={() => toggleTabellaEsclusa(tabella)}
                        />
                        {tabella}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="ripristino-conferma" className="form-label">
                    Digita <strong>{TESTO_CONFERMA}</strong> per confermare
                  </label>
                  <input
                    id="ripristino-conferma"
                    className="form-control"
                    value={testoConferma}
                    onChange={(e) => setTestoConferma(e.target.value)}
                    autoComplete="off"
                    required
                  />
                </div>

                {errore && <div style={STILE_ERRORE}>{errore}</div>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={chiudiRipristino} disabled={inCorso}>
                    Annulla
                  </button>
                  <button type="submit" className="btn btn-danger" disabled={inCorso || testoConferma !== TESTO_CONFERMA}>
                    {inCorso ? 'Ripristino in corso…' : 'Ripristina'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
