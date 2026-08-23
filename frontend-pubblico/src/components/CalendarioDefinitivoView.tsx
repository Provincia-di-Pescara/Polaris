import React, { useEffect, useMemo, useState } from 'react';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import { settimanaTipoDefinitiva, type VoceSettimanaTipoDefinitiva } from '../api/settimanaTipoDefinitiva.ts';
import { ErroreRichiestaApi } from '../api/client.ts';

interface CalendarioDefinitivoProps {
  entities: EntitaRappresentata[];
  stagioneId: string | null;
  activeEntity: EntitaRappresentata | null;
}

const GIORNI: { numero: number; nome: string }[] = [
  { numero: 1, nome: 'Lunedì' },
  { numero: 2, nome: 'Martedì' },
  { numero: 3, nome: 'Mercoledì' },
  { numero: 4, nome: 'Giovedì' },
  { numero: 5, nome: 'Venerdì' },
  { numero: 6, nome: 'Sabato' },
  { numero: 7, nome: 'Domenica' },
];

const ETICHETTA_TIPO: Record<VoceSettimanaTipoDefinitiva['tipo'], string> = {
  singola: 'Singola',
  blocco_gara: 'Blocco Gara',
  blocco_allenamento: 'Blocco Allenamento',
};

const STILE_ERRORE: React.CSSProperties = {
  backgroundColor: 'var(--pa-danger-bg)',
  color: 'var(--pa-danger)',
  padding: '0.6rem 0.85rem',
  borderRadius: '6px',
};

function messaggioErrore(err: unknown, prefisso: string): string {
  return err instanceof ErroreRichiestaApi ? `${prefisso}: ${err.message}` : `${prefisso}.`;
}

export const CalendarioDefinitivoView: React.FC<CalendarioDefinitivoProps> = ({ entities, stagioneId, activeEntity }) => {
  const associazioneId = activeEntity?.associazioneId ?? null;

  const [fasce, setFasce] = useState<VoceSettimanaTipoDefinitiva[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState<boolean>(true);

  useEffect(() => {
    let annullato = false;
    if (!stagioneId) {
      setCaricamento(false);
      return;
    }
    setCaricamento(true);
    settimanaTipoDefinitiva(stagioneId)
      .then((esito) => {
        if (annullato) return;
        setFasce(esito.fasce);
        setErrore(null);
      })
      .catch((err) => {
        if (annullato) return;
        setFasce([]);
        setErrore(messaggioErrore(err, 'Settimana tipo definitiva non disponibile'));
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });
    return () => {
      annullato = true;
    };
  }, [stagioneId]);

  const fascePerGiorno = useMemo(() => {
    const mappa = new Map<number, VoceSettimanaTipoDefinitiva[]>();
    for (const fascia of fasce) {
      const lista = mappa.get(fascia.giornoSettimana) ?? [];
      lista.push(fascia);
      mappa.set(fascia.giornoSettimana, lista);
    }
    for (const lista of mappa.values()) {
      lista.sort((a, b) => a.orarioInizio.localeCompare(b.orarioInizio));
    }
    return mappa;
  }, [fasce]);

  if (!stagioneId) {
    return (
      <div className="pa-container">
        <div className="pa-card">Seleziona una stagione dall'intestazione.</div>
      </div>
    );
  }

  if (!activeEntity || !associazioneId) {
    return (
      <div className="pa-container">
        <div className="pa-card">
          Seleziona un'associazione con delega approvata.
          {entities.length === 0 && ' Non risultano associazioni rappresentate: richiedi prima un accreditamento.'}
        </div>
      </div>
    );
  }

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>Settimana Tipo Definitiva</h2>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Orario definitivo approvato (artt. B.29-B.31 Allegato B). "Efficace" indica che la convenzione con
          l'istituzione scolastica è stata perfezionata.
        </p>
      </div>

      {caricamento && <div className="pa-card">Caricamento…</div>}

      {errore && <div style={STILE_ERRORE}>{errore}</div>}

      {!caricamento && !errore && (
        <div className="pa-card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {GIORNI.map((giorno) => {
              const fasceGiorno = fascePerGiorno.get(giorno.numero) ?? [];
              return (
                <div
                  key={giorno.numero}
                  style={{
                    border: '1px solid var(--pa-border)',
                    borderRadius: '6px',
                    backgroundColor: '#F8FAFC',
                    minHeight: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      padding: '0.6rem',
                      backgroundColor: 'var(--pa-blue-dark)',
                      color: 'white',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      textAlign: 'center',
                      borderTopLeftRadius: '5px',
                      borderTopRightRadius: '5px',
                    }}
                  >
                    {giorno.nome}
                  </div>

                  <div style={{ padding: '0.6rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {fasceGiorno.length === 0 && (
                      <div style={{ fontSize: '0.75rem', color: '#94A3B8', textAlign: 'center', marginTop: '1rem', fontStyle: 'italic' }}>
                        Nessuna assegnazione
                      </div>
                    )}

                    {fasceGiorno.map((fascia) => {
                      const propria = fascia.associazioneId === associazioneId;
                      return (
                        <div
                          key={fascia.slotId}
                          style={{
                            backgroundColor: propria ? '#E8F8F5' : '#F1F5F9',
                            border: `1px solid ${propria ? '#A3E4D7' : '#E2E8F0'}`,
                            borderRadius: '6px',
                            padding: '0.5rem',
                            fontSize: '0.775rem',
                          }}
                        >
                          <div style={{ fontWeight: 700, color: propria ? 'var(--pa-success)' : 'var(--pa-blue-dark)' }}>
                            {fascia.orarioInizio} - {fascia.orarioFine}
                          </div>
                          <div style={{ fontWeight: 600, color: 'var(--pa-blue-dark)', marginTop: '2px' }}>
                            {fascia.impiantoDenominazione}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--pa-text-muted)' }}>{fascia.spazioDenominazione}</div>
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '4px', alignItems: 'center' }}>
                            <span style={{ fontWeight: propria ? 700 : 400 }}>
                              {fascia.associazioneDenominazione}
                              {propria && <span className="badge badge-info" style={{ marginLeft: '0.3rem' }}>Tua associazione</span>}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '4px' }}>
                            <span className="badge badge-neutral">{ETICHETTA_TIPO[fascia.tipo]}</span>
                            <span className={fascia.efficace ? 'badge badge-success' : 'badge badge-warning'}>
                              {fascia.efficace ? 'Efficace' : 'In attesa di convenzione'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
