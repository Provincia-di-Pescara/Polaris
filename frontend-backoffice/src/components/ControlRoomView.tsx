import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import {
  eseguiIstruttoria,
  eseguiBlocchiGara,
  eseguiPrimaAssegnazione,
  eseguiRiassegnazioneResidua,
  approvaDefinitiva,
  listaElaborazioni,
  type Elaborazione,
  ErroreRichiestaApi,
} from '../api/motore.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { Cpu, Calculator, ShieldCheck, Play, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

type TipoAzione = 'istruttoria' | 'blocchi_gara' | 'prima_assegnazione' | 'riassegnazione_residua' | 'approva_definitiva';

export const ControlRoomView: React.FC = () => {
  const { utente } = useAuth();
  const puoEseguireAzioni = utente?.ruolo === 'admin';
  const stagioneId = useOutletContext<string>() ?? '';
  const [elaborazioni, setElaborazioni] = useState<Elaborazione[]>([]);
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);
  const [azioneInCorso, setAzioneInCorso] = useState<TipoAzione | null>(null);
  const [ultimoRisultato, setUltimoRisultato] = useState<string | null>(null);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);

  const ricarica = (): void => {
    if (!stagioneId) return;
    listaElaborazioni(stagioneId)
      .then(setElaborazioni)
      .catch((err) => setErroreCaricamento(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare le elaborazioni.'));
  };

  useEffect(ricarica, [stagioneId]);

  const eseguiAzione = async (tipo: TipoAzione): Promise<void> => {
    if (tipo === 'approva_definitiva') {
      const confermato = window.confirm(
        'Approvare la settimana tipo definitiva? Questa operazione transiziona la stagione a uno stato terminale e non è ri-eseguibile.',
      );
      if (!confermato) return;
    }
    setAzioneInCorso(tipo);
    setErroreAzione(null);
    setUltimoRisultato(null);
    try {
      switch (tipo) {
        case 'istruttoria': {
          const r = await eseguiIstruttoria(stagioneId);
          setUltimoRisultato(`Istruttoria completata: ${r.domandeCalcolate} domande calcolate.`);
          break;
        }
        case 'blocchi_gara': {
          const r = await eseguiBlocchiGara(stagioneId);
          setUltimoRisultato(`Blocchi gara: ${r.numeroAssegnazioni} assegnazioni, ${r.richiesteNonAssegnate} richieste non assegnate.`);
          break;
        }
        case 'prima_assegnazione': {
          const r = await eseguiPrimaAssegnazione(stagioneId);
          setUltimoRisultato(`Prima assegnazione: ${r.numeroAssegnazioni} assegnazioni in ${r.roundEseguiti} round.`);
          break;
        }
        case 'riassegnazione_residua': {
          const r = await eseguiRiassegnazioneResidua(stagioneId);
          setUltimoRisultato(`Riassegnazione residua: ${r.numeroAssegnazioni} assegnazioni in ${r.roundEseguiti} round.`);
          break;
        }
        case 'approva_definitiva': {
          const r = await approvaDefinitiva(stagioneId);
          setUltimoRisultato(`Settimana tipo definitiva approvata: ${r.convenzioniCreate} convenzioni create.`);
          break;
        }
      }
      ricarica();
    } catch (err) {
      setErroreAzione(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setAzioneInCorso(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Control Room Procedura & Algoritmo</h1>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>Orchestrazione della coda verso il motore Go — Provincia di Pescara</p>
      </div>

      {!stagioneId && <div style={{ color: 'var(--pa-text-muted)' }}>Seleziona una stagione nell'Header per iniziare.</div>}

      {stagioneId && (
        <>
          {puoEseguireAzioni && (
            <div className="pa-card" style={{ background: 'linear-gradient(135deg, #002B55 0%, #0056B3 100%)', color: 'white' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Cpu size={20} />
                <h3 style={{ color: 'white', margin: 0 }}>Azioni di Avanzamento Algoritmico</h3>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button onClick={() => eseguiAzione('istruttoria')} disabled={azioneInCorso !== null} className="btn btn-sm">
                  <Calculator size={16} /><span>Istruttoria</span>
                </button>
                <button onClick={() => eseguiAzione('blocchi_gara')} disabled={azioneInCorso !== null} className="btn btn-sm">
                  <ShieldCheck size={16} /><span>Blocchi Gara</span>
                </button>
                <button onClick={() => eseguiAzione('prima_assegnazione')} disabled={azioneInCorso !== null} className="btn btn-success btn-sm">
                  <Play size={16} /><span>{azioneInCorso === 'prima_assegnazione' ? 'Esecuzione...' : 'Prima Assegnazione'}</span>
                </button>
                <button onClick={() => eseguiAzione('riassegnazione_residua')} disabled={azioneInCorso !== null} className="btn btn-sm">
                  <Play size={16} /><span>Riassegnazione Residua</span>
                </button>
                <button onClick={() => eseguiAzione('approva_definitiva')} disabled={azioneInCorso !== null} className="btn btn-sm">
                  <CheckCircle2 size={16} /><span>Approva Definitiva</span>
                </button>
              </div>
              {ultimoRisultato && <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>{ultimoRisultato}</div>}
              {erroreAzione && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <AlertCircle size={16} /><span>{erroreAzione}</span>
                </div>
              )}
            </div>
          )}

          {erroreCaricamento && (
            <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
              {erroreCaricamento}
            </div>
          )}

          <div className="pa-card">
            <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', marginBottom: '1rem' }}>Storico Elaborazioni</h3>
            <div className="pa-table-container">
              <table className="pa-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Iniziata Il</th>
                    <th>Conclusa Il</th>
                    <th>Stato</th>
                    <th>Round Eseguiti</th>
                  </tr>
                </thead>
                <tbody>
                  {elaborazioni.map((e) => (
                    <tr key={e.id}>
                      <td>{e.tipo}</td>
                      <td>{e.iniziataIl}</td>
                      <td>{e.conclusaIl ?? '—'}</td>
                      <td>
                        {e.stato === 'completata' && <span className="badge badge-success"><CheckCircle2 size={12} /> Completata</span>}
                        {e.stato === 'in_corso' && <span className="badge badge-info"><Clock size={12} /> In Corso</span>}
                        {e.stato === 'fallita' && <span className="badge badge-danger">Fallita</span>}
                      </td>
                      <td>{e.numeroRoundEseguiti ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
