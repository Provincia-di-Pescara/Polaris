import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import {
  listaLogOperazioni,
  listaSorteggiPerStagione,
  trovaSorteggio,
  verificaHmac,
  type OperazioneConAttore,
  type SorteggioSintetico,
  type SorteggioDettaglio,
  ErroreRichiestaApi,
} from '../api/audit.ts';
import { ShieldCheck, KeyRound, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';

interface EsitoVerificaCandidato {
  associazioneId: string;
  hmacRicalcolato: string;
  corrisponde: boolean;
}

// Verdetto complessivo: un verbale è genuino solo se TUTTE e tre le condizioni
// valgono (art. B.38, algoritmo `hmac-sha256-rank-asc`) — non basta che ogni HMAC
// per-candidato corrisponda, un `rank`/vincitore scambiato con HMAC genuini
// produrrebbe comunque un esito manomesso non rilevato dal solo confronto per-riga.
interface VerificaGlobale {
  tuttiGliHmacCorrispondono: boolean;
  ordineRankCorretto: boolean;
  vincitoreCorrettoInRank1: boolean;
}

function verificaValida(v: VerificaGlobale): boolean {
  return v.tuttiGliHmacCorrispondono && v.ordineRankCorretto && v.vincitoreCorrettoInRank1;
}

export const AuditSorteggioView: React.FC = () => {
  const stagioneId = useOutletContext<string>() ?? '';
  const [log, setLog] = useState<OperazioneConAttore[]>([]);
  const [sorteggi, setSorteggi] = useState<SorteggioSintetico[]>([]);
  const [dettaglio, setDettaglio] = useState<SorteggioDettaglio | null>(null);
  const [esitiVerifica, setEsitiVerifica] = useState<EsitoVerificaCandidato[] | null>(null);
  const [verificaGlobale, setVerificaGlobale] = useState<VerificaGlobale | null>(null);
  const [verificaInCorso, setVerificaInCorso] = useState(false);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [filtroEntita, setFiltroEntita] = useState('');
  const [filtroAzione, setFiltroAzione] = useState('');

  // Debounce (~300ms) sui filtri testuali per non lanciare una fetch a ogni
  // tasto premuto, più una guardia anti-risposta-in-ritardo: se una fetch più
  // recente (filtri cambiati di nuovo, o smontaggio del componente) è partita
  // prima che questa risolva, il risultato viene scartato invece di sovrascrivere
  // `log` con dati ormai obsoleti (nessun AbortController: `apiFetch` non espone
  // un modo semplice per iniettare un AbortSignal, la guardia booleana basta qui).
  useEffect(() => {
    let scartata = false;
    const timer = setTimeout(() => {
      listaLogOperazioni({ entitaTipo: filtroEntita || undefined, azione: filtroAzione || undefined })
        .then((righe) => {
          if (!scartata) setLog(righe);
        })
        .catch((err) => {
          if (!scartata) setErroreCaricamento(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare il log operazioni.');
        });
    }, 300);
    return () => {
      scartata = true;
      clearTimeout(timer);
    };
  }, [filtroEntita, filtroAzione]);

  useEffect(() => {
    if (!stagioneId) return;
    listaSorteggiPerStagione(stagioneId)
      .then(setSorteggi)
      .catch(() => setErroreCaricamento('Impossibile caricare i verbali di sorteggio.'));
  }, [stagioneId]);

  const apriVerbale = (id: string): void => {
    setEsitiVerifica(null);
    setVerificaGlobale(null);
    trovaSorteggio(id).then(setDettaglio).catch(() => setErroreCaricamento('Impossibile caricare il verbale.'));
  };

  const eseguiVerifica = async (): Promise<void> => {
    if (!dettaglio) return;
    setVerificaInCorso(true);
    try {
      const esiti = await Promise.all(
        dettaglio.candidati.map(async (c) => {
          const ricalcolato = await verificaHmac(dettaglio.semeHex, c.associazioneId);
          return { associazioneId: c.associazioneId, hmacRicalcolato: ricalcolato, corrisponde: ricalcolato === c.hmacHex };
        }),
      );
      setEsitiVerifica(esiti);

      // Ranking rank-asc art. B.38: ordina i candidati per HMAC RICALCOLATO
      // (non quello salvato — un verbale manomesso potrebbe avere un rank salvato
      // coerente con l'HMAC salvato ma non con quello vero) e confronta la
      // posizione risultante col `rank` dichiarato nel verbale.
      const ordinatiPerHmacRicalcolato = [...esiti].sort((a, b) => (a.hmacRicalcolato < b.hmacRicalcolato ? -1 : a.hmacRicalcolato > b.hmacRicalcolato ? 1 : 0));
      const ordineRankCorretto = ordinatiPerHmacRicalcolato.every((e, indice) => {
        const candidato = dettaglio.candidati.find((c) => c.associazioneId === e.associazioneId);
        return candidato?.rank === indice + 1;
      });

      const candidatoRank1 = dettaglio.candidati.find((c) => c.rank === 1);
      const vincitoreCorrettoInRank1 = candidatoRank1?.associazioneId === dettaglio.vincitoreAssociazioneId;

      setVerificaGlobale({
        tuttiGliHmacCorrispondono: esiti.every((e) => e.corrisponde),
        ordineRankCorretto,
        vincitoreCorrettoInRank1,
      });
    } finally {
      setVerificaInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Audit Log & Verbali Sorteggio Tracciato HMAC</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Tracciabilità delle scritture (Art. B.39) e riproducibilità deterministica da terzi (Art. B.38)
        </p>
      </div>

      {erroreCaricamento && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {erroreCaricamento}
        </div>
      )}

      <div className="pa-card" style={{ borderTop: '4px solid var(--pa-accent)', backgroundColor: '#F0FDFA' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <KeyRound size={20} color="#0D9488" />
          <h3 style={{ margin: 0, color: '#0F766E' }}>Verbali di Sorteggio (HMAC-SHA256)</h3>
        </div>
        {!stagioneId && <div style={{ fontSize: '0.85rem', color: 'var(--pa-text-muted)' }}>Seleziona una stagione nell'Header.</div>}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {sorteggi.map((s) => (
            <button key={s.id} onClick={() => apriVerbale(s.id)} className="btn btn-secondary btn-sm">
              {s.articoloRiferimento} — {s.contesto}
            </button>
          ))}
        </div>
      </div>

      <div className="pa-card">
        <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '0.75rem' }}>Registro Tracciabilità Scritture (`log_operazioni`)</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input
            aria-label="Filtra per entità"
            className="form-control"
            placeholder="entità (es. domande)"
            value={filtroEntita}
            onChange={(e) => setFiltroEntita(e.target.value)}
          />
          <input
            aria-label="Filtra per azione"
            className="form-control"
            placeholder="azione (es. ammetti_domanda)"
            value={filtroAzione}
            onChange={(e) => setFiltroAzione(e.target.value)}
          />
        </div>
        <div className="pa-table-container">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Data & Ora</th>
                <th>Attore</th>
                <th>Operazione</th>
                <th>Entità</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td>{l.avvenutaIl}</td>
                  <td><strong>{l.attoreNome}</strong></td>
                  <td><span className="badge badge-info">{l.azione}</span></td>
                  <td>{l.entitaTipo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {dettaglio && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '750px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Verbale — {dettaglio.articoloRiferimento}</h3>
              <button onClick={() => setDettaglio(null)} className="btn btn-secondary btn-sm">Chiudi</button>
            </div>

            <div style={{ backgroundColor: '#F8FAFC', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700 }}>SEME CSPRNG:</div>
              <code style={{ fontSize: '0.75rem', wordBreak: 'break-all', display: 'block' }}>{dettaglio.semeHex}</code>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, marginTop: '0.5rem' }}>HASH VERBALE (tamper-evidence):</div>
              <code style={{ fontSize: '0.75rem', wordBreak: 'break-all', display: 'block' }}>{dettaglio.hashVerbale}</code>
            </div>

            <table className="pa-table" style={{ marginBottom: '1.25rem' }}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Associazione</th>
                  <th>HMAC salvato</th>
                  <th>Esito verifica</th>
                </tr>
              </thead>
              <tbody>
                {dettaglio.candidati.map((c) => {
                  const esito = esitiVerifica?.find((e) => e.associazioneId === c.associazioneId);
                  return (
                    <tr key={c.associazioneId}>
                      <td>#{c.rank}</td>
                      <td>{c.associazioneId}</td>
                      <td><code style={{ fontSize: '0.7rem' }}>{c.hmacHex.substring(0, 24)}...</code></td>
                      <td>
                        {esito && esito.corrisponde && (
                          <span className="badge badge-success"><CheckCircle2 size={12} /> Verificato</span>
                        )}
                        {esito && !esito.corrisponde && (
                          <span className="badge badge-danger"><XCircle size={12} /> Non corrisponde</span>
                        )}
                        {!esito && <span className="badge badge-neutral">Non ancora verificato</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <button onClick={eseguiVerifica} disabled={verificaInCorso} className="btn btn-primary">
              <RefreshCw size={16} className={verificaInCorso ? 'spin' : ''} />
              <span>{verificaInCorso ? 'Ricalcolo in corso...' : 'Ricalcola & Verifica HMAC'}</span>
            </button>
            {verificaGlobale && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                {verificaValida(verificaGlobale) ? (
                  <span style={{ color: 'var(--pa-success)', fontWeight: 700 }}><ShieldCheck size={16} /> Ricalcolo verificato: tutti gli HMAC corrispondono, l'ordinamento rank-asc è corretto e il vincitore combacia con il rank 1.</span>
                ) : (
                  <span style={{ color: 'var(--pa-danger)', fontWeight: 700 }}>
                    Attenzione: verbale potenzialmente manomesso —
                    {!verificaGlobale.tuttiGliHmacCorrispondono && ' uno o più HMAC ricalcolati non corrispondono;'}
                    {!verificaGlobale.ordineRankCorretto && " l'ordine dei rank non corrisponde al ranking HMAC ricalcolato;"}
                    {!verificaGlobale.vincitoreCorrettoInRank1 && ' il vincitore dichiarato non è il candidato di rank 1.'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
