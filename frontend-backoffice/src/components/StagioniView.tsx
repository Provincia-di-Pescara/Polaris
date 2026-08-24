import React, { useEffect, useState } from 'react';
import {
  listaStagioni,
  creaStagione,
  aggiornaStagione,
  eliminaStagione,
  type Stagione,
  type DatiCreaStagione,
} from '../api/stagioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { CalendarPlus, Pencil, Trash2, X } from 'lucide-react';

const STILE_ERRORE: React.CSSProperties = {
  backgroundColor: 'var(--pa-danger-bg)',
  color: 'var(--pa-danger)',
  padding: '0.6rem 0.85rem',
  borderRadius: '6px',
  fontSize: '0.85rem',
};

const ETICHETTA_STATO: Record<string, string> = {
  censimento: 'Censimento',
  bando_aperto: 'Bando aperto',
  istruttoria: 'Istruttoria',
  pubblicazione_istruttoria: 'Pubblicazione istruttoria',
  blocchi_gara: 'Blocchi gara',
  prima_assegnazione: 'Prima assegnazione',
  concertazione: 'Concertazione',
  definitiva: 'Definitiva',
  chiusa: 'Chiusa',
};

function formattaData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('it-IT');
}

// Euristica lato client, non l'unica fonte di verità: il backend rifiuta
// comunque con 409 (anche a stato='censimento') se esistono dati load-bearing
// collegati (slot/domande/elaborazioni/proposte) -- non replichiamo qui quella
// query, sarebbe uno stato duplicato da tenere sincronizzato per un guadagno
// minimo (un tentativo di modifica bloccato mostra comunque il 409 reale).
function modificabile(s: Stagione): boolean {
  return s.stato === 'censimento';
}

export const StagioniView: React.FC = () => {
  const [stagioni, setStagioni] = useState<Stagione[]>([]);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const [formNuovoAperto, setFormNuovoAperto] = useState(false);
  const [datiNuovo, setDatiNuovo] = useState<DatiCreaStagione>({ nome: '', dataInizio: '', dataFine: '' });

  const [modifica, setModifica] = useState<Stagione | null>(null);
  const [datiModifica, setDatiModifica] = useState<DatiCreaStagione>({ nome: '', dataInizio: '', dataFine: '' });

  const ricarica = (): void => {
    listaStagioni()
      .then(setStagioni)
      .catch(() => setErroreCaricamento('Impossibile caricare le stagioni.'));
  };

  useEffect(ricarica, []);

  const resetMessaggi = (): void => {
    setErrore(null);
    setMessaggio(null);
  };

  const handleCreaStagione = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    resetMessaggi();
    setInCorso(true);
    try {
      await creaStagione(datiNuovo);
      setDatiNuovo({ nome: '', dataInizio: '', dataFine: '' });
      setFormNuovoAperto(false);
      setMessaggio('Stagione creata.');
      ricarica();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante la creazione.');
    } finally {
      setInCorso(false);
    }
  };

  const apriModifica = (s: Stagione): void => {
    resetMessaggi();
    setModifica(s);
    setDatiModifica({ nome: s.nome, dataInizio: s.dataInizio, dataFine: s.dataFine });
  };

  const handleSalvaModifica = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!modifica) return;
    resetMessaggi();
    setInCorso(true);
    try {
      await aggiornaStagione(modifica.id, datiModifica);
      setModifica(null);
      setMessaggio('Stagione aggiornata.');
      ricarica();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante il salvataggio.');
    } finally {
      setInCorso(false);
    }
  };

  const handleElimina = async (s: Stagione): Promise<void> => {
    const confermato = window.confirm(`Eliminare la stagione "${s.nome}"? L'operazione non è reversibile.`);
    if (!confermato) return;
    resetMessaggi();
    setInCorso(true);
    try {
      await eliminaStagione(s.id);
      setMessaggio('Stagione eliminata.');
      ricarica();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante l\'eliminazione.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Stagioni</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Modifica ed eliminazione disponibili solo in stato "Censimento" e senza slot/domande/elaborazioni già
            collegati -- oltre quel punto la stagione guida il flusso procedurale reale e non è più correggibile qui.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            resetMessaggi();
            setFormNuovoAperto(true);
          }}
        >
          <CalendarPlus size={16} />
          <span>Nuova stagione</span>
        </button>
      </div>

      {erroreCaricamento && <div style={STILE_ERRORE}>{erroreCaricamento}</div>}
      {messaggio && (
        <div style={{ backgroundColor: 'var(--pa-success-bg, #E8F8F0)', color: 'var(--pa-success, #1E8449)', padding: '0.6rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem' }}>
          {messaggio}
        </div>
      )}
      {errore && !formNuovoAperto && !modifica && <div style={STILE_ERRORE}>{errore}</div>}

      <div className="pa-card">
        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Data inizio</th>
                <th>Data fine</th>
                <th>Stato</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {stagioni.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--pa-text-muted)' }}>Nessuna stagione.</td>
                </tr>
              )}
              {stagioni.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 700 }}>{s.nome}</td>
                  <td>{formattaData(s.dataInizio)}</td>
                  <td>{formattaData(s.dataFine)}</td>
                  <td><span className="badge badge-info">{ETICHETTA_STATO[s.stato] ?? s.stato}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => apriModifica(s)}
                        disabled={inCorso || !modificabile(s)}
                        title={modificabile(s) ? undefined : `Non modificabile (stato: ${ETICHETTA_STATO[s.stato] ?? s.stato})`}
                      >
                        <Pencil size={14} />
                        <span>Modifica</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleElimina(s)}
                        disabled={inCorso || !modificabile(s)}
                        title={modificabile(s) ? undefined : `Non eliminabile (stato: ${ETICHETTA_STATO[s.stato] ?? s.stato})`}
                      >
                        <Trash2 size={14} />
                        <span>Elimina</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {formNuovoAperto && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem', width: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Nuova stagione</h3>
              <button type="button" onClick={() => setFormNuovoAperto(false)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreaStagione} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label htmlFor="stagione-nuova-nome" className="form-label">Nome</label>
                <input id="stagione-nuova-nome" className="form-control" value={datiNuovo.nome}
                  onChange={(e) => setDatiNuovo((p) => ({ ...p, nome: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label htmlFor="stagione-nuova-inizio" className="form-label">Data inizio</label>
                <input id="stagione-nuova-inizio" type="date" className="form-control" value={datiNuovo.dataInizio}
                  onChange={(e) => setDatiNuovo((p) => ({ ...p, dataInizio: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label htmlFor="stagione-nuova-fine" className="form-label">Data fine</label>
                <input id="stagione-nuova-fine" type="date" className="form-control" value={datiNuovo.dataFine}
                  onChange={(e) => setDatiNuovo((p) => ({ ...p, dataFine: e.target.value }))} required />
              </div>

              {errore && <div style={STILE_ERRORE}>{errore}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setFormNuovoAperto(false)} disabled={inCorso}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary" disabled={inCorso}>
                  {inCorso ? 'Creazione…' : 'Crea'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modifica && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ padding: '1.5rem', width: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Modifica stagione</h3>
              <button type="button" onClick={() => setModifica(null)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSalvaModifica} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label htmlFor="stagione-modifica-nome" className="form-label">Nome</label>
                <input id="stagione-modifica-nome" className="form-control" value={datiModifica.nome}
                  onChange={(e) => setDatiModifica((p) => ({ ...p, nome: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label htmlFor="stagione-modifica-inizio" className="form-label">Data inizio</label>
                <input id="stagione-modifica-inizio" type="date" className="form-control" value={datiModifica.dataInizio}
                  onChange={(e) => setDatiModifica((p) => ({ ...p, dataInizio: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label htmlFor="stagione-modifica-fine" className="form-label">Data fine</label>
                <input id="stagione-modifica-fine" type="date" className="form-control" value={datiModifica.dataFine}
                  onChange={(e) => setDatiModifica((p) => ({ ...p, dataFine: e.target.value }))} required />
              </div>

              {errore && <div style={STILE_ERRORE}>{errore}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setModifica(null)} disabled={inCorso}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary" disabled={inCorso}>
                  {inCorso ? 'Salvataggio…' : 'Salva'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
