import React, { useEffect, useState } from 'react';
import {
  listaUtenti,
  creaUtente,
  aggiornaUtente,
  cambiaStatoUtente,
  richiediResetPassword,
  type UtenteBackoffice,
  type DatiCreaUtente,
  type DatiAggiornaUtente,
} from '../api/utenti.ts';
import { ErroreRichiestaApi } from '../api/client.ts';
import { UserPlus, X, RotateCcw } from 'lucide-react';

const STILE_ERRORE: React.CSSProperties = {
  backgroundColor: 'var(--pa-danger-bg)',
  color: 'var(--pa-danger)',
  padding: '0.6rem 0.85rem',
  borderRadius: '6px',
  fontSize: '0.85rem',
};

const ETICHETTA_STATO: Record<UtenteBackoffice['stato'], { testo: string; classe: string }> = {
  attivo: { testo: 'Attivo', classe: 'badge badge-success' },
  disattivato: { testo: 'Disattivato', classe: 'badge badge-danger' },
  in_attesa_verifica: { testo: 'Invito in attesa', classe: 'badge badge-warning' },
};

function formattaData(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT');
}

export const UtentiView: React.FC = () => {
  const [utenti, setUtenti] = useState<UtenteBackoffice[]>([]);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);

  const [formNuovoAperto, setFormNuovoAperto] = useState(false);
  const [nuovoEmail, setNuovoEmail] = useState('');
  const [nuovoNome, setNuovoNome] = useState('');
  const [nuovoCognome, setNuovoCognome] = useState('');
  const [nuovoRuolo, setNuovoRuolo] = useState<'admin' | 'operatore'>('operatore');

  const [modifica, setModifica] = useState<UtenteBackoffice | null>(null);
  const [modificaNome, setModificaNome] = useState('');
  const [modificaCognome, setModificaCognome] = useState('');
  const [modificaRuolo, setModificaRuolo] = useState<'admin' | 'operatore'>('operatore');

  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const ricarica = (): void => {
    listaUtenti()
      .then(setUtenti)
      .catch((err) => setErroreCaricamento(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare gli utenti.'));
  };

  useEffect(ricarica, []);

  const resetMessaggi = (): void => {
    setErrore(null);
    setMessaggio(null);
  };

  const handleCreaUtente = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    resetMessaggi();
    setInCorso(true);
    try {
      const dati: DatiCreaUtente = { email: nuovoEmail, nome: nuovoNome, cognome: nuovoCognome, ruolo: nuovoRuolo };
      await creaUtente(dati);
      setNuovoEmail('');
      setNuovoNome('');
      setNuovoCognome('');
      setNuovoRuolo('operatore');
      setFormNuovoAperto(false);
      setMessaggio('Utente creato, email di invito inviata.');
      ricarica();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante la creazione.');
    } finally {
      setInCorso(false);
    }
  };

  const apriModifica = (u: UtenteBackoffice): void => {
    resetMessaggi();
    setModifica(u);
    setModificaNome(u.nome);
    setModificaCognome(u.cognome);
    setModificaRuolo(u.ruolo);
  };

  const handleSalvaModifica = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!modifica) return;
    resetMessaggi();
    setInCorso(true);
    try {
      const dati: DatiAggiornaUtente = { nome: modificaNome, cognome: modificaCognome, ruolo: modificaRuolo };
      await aggiornaUtente(modifica.id, dati);
      setModifica(null);
      ricarica();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante il salvataggio.');
    } finally {
      setInCorso(false);
    }
  };

  const handleCambiaStato = async (u: UtenteBackoffice): Promise<void> => {
    const nuovoStato = u.stato === 'attivo' ? 'disattivato' : 'attivo';
    const confermato = window.confirm(
      nuovoStato === 'disattivato'
        ? `Disattivare l'account di ${u.nome} ${u.cognome}? Non potrà più accedere.`
        : `Riattivare l'account di ${u.nome} ${u.cognome}?`,
    );
    if (!confermato) return;
    resetMessaggi();
    setInCorso(true);
    try {
      await cambiaStatoUtente(u.id, nuovoStato);
      ricarica();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  const handleResetPassword = async (u: UtenteBackoffice): Promise<void> => {
    const confermato = window.confirm(
      `Inviare un nuovo link di attivazione/reset a ${u.email}? Le sue sessioni attive verranno disconnesse.`,
    );
    if (!confermato) return;
    resetMessaggi();
    setInCorso(true);
    try {
      await richiediResetPassword(u.id);
      setMessaggio(`Nuovo link inviato a ${u.email}.`);
      ricarica();
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Utenti Backoffice</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Account amministratori/operatori del backoffice (login locale, non SPID/CIE)
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
          <UserPlus size={16} />
          <span>Nuovo utente</span>
        </button>
      </div>

      {erroreCaricamento && <div style={STILE_ERRORE}>{erroreCaricamento}</div>}
      {messaggio && (
        <div style={{ backgroundColor: 'var(--pa-success-bg)', color: 'var(--pa-success)', padding: '0.6rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem' }}>
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
                <th>Email</th>
                <th>Ruolo</th>
                <th>Stato</th>
                <th>Ultimo accesso</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {utenti.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--pa-text-muted)' }}>Nessun utente.</td>
                </tr>
              )}
              {utenti.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 700 }}>{u.cognome} {u.nome}</td>
                  <td>{u.email}</td>
                  <td><span className="badge badge-info">{u.ruolo}</span></td>
                  <td><span className={ETICHETTA_STATO[u.stato].classe}>{ETICHETTA_STATO[u.stato].testo}</span></td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--pa-text-muted)' }}>{formattaData(u.ultimoAccessoIl)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => apriModifica(u)} disabled={inCorso}>
                        Modifica
                      </button>
                      <button
                        type="button"
                        className={u.stato === 'attivo' ? 'btn btn-danger btn-sm' : 'btn btn-success btn-sm'}
                        onClick={() => handleCambiaStato(u)}
                        disabled={inCorso}
                      >
                        {u.stato === 'attivo' ? 'Disattiva' : 'Riattiva'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleResetPassword(u)}
                        disabled={inCorso}
                        title="Invia nuovo link di attivazione/reset"
                      >
                        <RotateCcw size={14} />
                        <span>Reset invito</span>
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
              <h3 style={{ margin: 0 }}>Nuovo utente</h3>
              <button type="button" onClick={() => setFormNuovoAperto(false)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreaUtente} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label htmlFor="utente-nuovo-nome" className="form-label">Nome</label>
                <input id="utente-nuovo-nome" className="form-control" value={nuovoNome} onChange={(e) => setNuovoNome(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="utente-nuovo-cognome" className="form-label">Cognome</label>
                <input id="utente-nuovo-cognome" className="form-control" value={nuovoCognome} onChange={(e) => setNuovoCognome(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="utente-nuovo-email" className="form-label">Email</label>
                <input
                  id="utente-nuovo-email"
                  type="email"
                  className="form-control"
                  value={nuovoEmail}
                  onChange={(e) => setNuovoEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="utente-nuovo-ruolo" className="form-label">Ruolo</label>
                <select
                  id="utente-nuovo-ruolo"
                  className="form-control"
                  value={nuovoRuolo}
                  onChange={(e) => setNuovoRuolo(e.target.value as 'admin' | 'operatore')}
                >
                  <option value="operatore">Operatore</option>
                  <option value="admin">Amministratore</option>
                </select>
              </div>

              {errore && <div style={STILE_ERRORE}>{errore}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setFormNuovoAperto(false)} disabled={inCorso}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary" disabled={inCorso}>
                  {inCorso ? 'Creazione…' : 'Crea e invia invito'}
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
              <h3 style={{ margin: 0 }}>Modifica utente</h3>
              <button type="button" onClick={() => setModifica(null)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--pa-text-muted)', marginBottom: '1rem' }}>{modifica.email}</div>

            <form onSubmit={handleSalvaModifica} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label htmlFor="utente-modifica-nome" className="form-label">Nome</label>
                <input id="utente-modifica-nome" className="form-control" value={modificaNome} onChange={(e) => setModificaNome(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="utente-modifica-cognome" className="form-label">Cognome</label>
                <input id="utente-modifica-cognome" className="form-control" value={modificaCognome} onChange={(e) => setModificaCognome(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="utente-modifica-ruolo" className="form-label">Ruolo</label>
                <select
                  id="utente-modifica-ruolo"
                  className="form-control"
                  value={modificaRuolo}
                  onChange={(e) => setModificaRuolo(e.target.value as 'admin' | 'operatore')}
                >
                  <option value="operatore">Operatore</option>
                  <option value="admin">Amministratore</option>
                </select>
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
