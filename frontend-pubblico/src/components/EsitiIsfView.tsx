import React, { useCallback, useEffect, useState } from 'react';
import { Info, Send } from 'lucide-react';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import {
  listaDomandePerAssociazione,
  elencoEsitiPubblicati,
  type Domanda,
  type EsitoPubblicato,
} from '../api/domande.ts';
import { listaAssegnazioni, type AssegnazioneLettura } from '../api/assegnazioni.ts';
import { listaOsservazioni, presentaOsservazione, type Osservazione } from '../api/osservazioni.ts';
import { ErroreRichiestaApi } from '../api/client.ts';

interface EsitiIsfProps {
  entities: EntitaRappresentata[];
  stagioneId: string | null;
  activeEntity: EntitaRappresentata | null;
}

const GIORNI = ['—', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

const ETICHETTA_TIPO: Record<AssegnazioneLettura['tipo'], string> = {
  singola: 'Assegnazione Singola',
  blocco_gara: 'Assegnato Blocco Gara',
  blocco_allenamento: 'Assegnato Blocco Allenamento',
};

const ETICHETTA_STATO_OSSERVAZIONE: Record<Osservazione['stato'], string> = {
  in_esame: 'In esame',
  accolta: 'Accolta',
  respinta: 'Respinta',
};

const CLASSE_BADGE_OSSERVAZIONE: Record<Osservazione['stato'], string> = {
  in_esame: 'badge badge-info',
  accolta: 'badge badge-success',
  respinta: 'badge badge-danger',
};

const STILE_ERRORE: React.CSSProperties = {
  backgroundColor: 'var(--pa-danger-bg)',
  color: 'var(--pa-danger)',
  padding: '0.6rem 0.85rem',
  borderRadius: '6px',
};

const STILE_BOX: React.CSSProperties = {
  backgroundColor: '#F8FAFC',
  padding: '1rem',
  borderRadius: '8px',
  border: '1px solid #E2E8F0',
};

const STILE_KPI_LABEL: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--pa-text-muted)', fontWeight: 600 };
const STILE_KPI_VALORE: React.CSSProperties = { fontSize: '1.8rem', fontWeight: 800, margin: '0.2rem 0' };
const STILE_KPI_NOTA: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--pa-text-muted)' };

function formattaData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT');
}

function messaggioErrore(err: unknown, prefisso: string): string {
  return err instanceof ErroreRichiestaApi ? `${prefisso}: ${err.message}` : `${prefisso}.`;
}

export const EsitiIsfView: React.FC<EsitiIsfProps> = ({ entities, stagioneId, activeEntity }) => {
  const associazioneId = activeEntity?.associazioneId ?? null;

  const [domanda, setDomanda] = useState<Domanda | null>(null);
  const [caricamentoDomanda, setCaricamentoDomanda] = useState<boolean>(true);
  const [erroreDomanda, setErroreDomanda] = useState<string | null>(null);

  // Fetch UNICA di elencoEsitiPubblicati: alimenta sia i KPI della sezione
  // "La mia domanda" (filtrando per domandaId) sia il tabellone pubblico.
  const [esiti, setEsiti] = useState<EsitoPubblicato[]>([]);
  const [erroreEsiti, setErroreEsiti] = useState<string | null>(null);

  const [assegnazioni, setAssegnazioni] = useState<AssegnazioneLettura[]>([]);
  const [erroreAssegnazioni, setErroreAssegnazioni] = useState<string | null>(null);

  const [osservazioni, setOsservazioni] = useState<Osservazione[]>([]);
  const [erroreOsservazioni, setErroreOsservazioni] = useState<string | null>(null);
  const [testoOsservazione, setTestoOsservazione] = useState<string>('');
  const [invioInCorso, setInvioInCorso] = useState<boolean>(false);
  const [erroreInvio, setErroreInvio] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    if (!associazioneId || !stagioneId) {
      setCaricamentoDomanda(false);
      return;
    }
    setCaricamentoDomanda(true);
    listaDomandePerAssociazione(associazioneId, stagioneId)
      .then((domande) => {
        if (annullato) return;
        // Il backend accetta già il filtro stagioneId, ma il filtro client
        // resta come rete di sicurezza (stesso pattern di WizardDomandaView).
        setDomanda(domande.find((d) => d.stagioneId === stagioneId) ?? null);
        setErroreDomanda(null);
      })
      .catch((err) => {
        if (annullato) return;
        setDomanda(null);
        setErroreDomanda(messaggioErrore(err, 'Impossibile leggere la domanda presentata'));
      })
      .finally(() => {
        if (!annullato) setCaricamentoDomanda(false);
      });
    return () => {
      annullato = true;
    };
  }, [associazioneId, stagioneId]);

  useEffect(() => {
    let annullato = false;
    if (!stagioneId) return;
    elencoEsitiPubblicati(stagioneId)
      .then((lista) => {
        if (annullato) return;
        setEsiti(lista);
        setErroreEsiti(null);
      })
      .catch((err) => {
        if (annullato) return;
        setEsiti([]);
        setErroreEsiti(messaggioErrore(err, 'Tabellone esiti non disponibile'));
      });
    return () => {
      annullato = true;
    };
  }, [stagioneId]);

  // Assegnazioni: solo se esiste una domanda già istruita. Con stato
  // 'presentata' l'istruttoria non è stata eseguita, quindi non ci può essere
  // alcuna assegnazione da mostrare e la chiamata sarebbe inutile.
  const domandaIstruita = domanda !== null && domanda.stato !== 'presentata';
  useEffect(() => {
    let annullato = false;
    if (!associazioneId || !stagioneId || !domandaIstruita) {
      setAssegnazioni([]);
      return;
    }
    listaAssegnazioni(associazioneId, stagioneId)
      .then((lista) => {
        if (annullato) return;
        setAssegnazioni(lista);
        setErroreAssegnazioni(null);
      })
      .catch((err) => {
        if (annullato) return;
        setAssegnazioni([]);
        setErroreAssegnazioni(messaggioErrore(err, 'Elenco slot assegnati non disponibile'));
      });
    return () => {
      annullato = true;
    };
  }, [associazioneId, stagioneId, domandaIstruita]);

  const domandaId = domanda?.id ?? null;
  const caricaOsservazioni = useCallback((estaAnnullato: () => boolean): void => {
    if (!domandaId) return;
    listaOsservazioni(domandaId)
      .then((lista) => {
        if (estaAnnullato()) return;
        setOsservazioni(lista);
        setErroreOsservazioni(null);
      })
      .catch((err) => {
        if (estaAnnullato()) return;
        setOsservazioni([]);
        setErroreOsservazioni(messaggioErrore(err, 'Elenco osservazioni non disponibile'));
      });
  }, [domandaId]);

  useEffect(() => {
    if (!domandaId) {
      setOsservazioni([]);
      return;
    }
    let annullato = false;
    caricaOsservazioni(() => annullato);
    return () => {
      annullato = true;
    };
  }, [domandaId, caricaOsservazioni]);

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

  const esitoProprio = domanda ? esiti.find((e) => e.domandaId === domanda.id) ?? null : null;
  const frFinaleMinuti = esitoProprio?.fabbisognoRiconosciuto?.frFinaleMinuti ?? null;

  // Unici due calcoli numerici della view, entrambi di sola visualizzazione:
  // mai reinviati al backend, mai usati per validare o bloccare qualcosa.
  // Il backend restituisce già solo le assegnazioni 'provvisoria'/'validata'
  // (assegnazioniLettura.ts), quindi la somma è direttamente il VA attivo.
  const valoreAssegnatoMinuti = assegnazioni.reduce((tot, a) => tot + Number(a.valoreMinuti), 0);
  const frNumerico = frFinaleMinuti === null ? Number.NaN : Number(frFinaleMinuti);
  const isf = Number.isFinite(frNumerico) && frNumerico > 0 ? valoreAssegnatoMinuti / frNumerico : null;

  const mostraOsservazioni =
    domanda !== null &&
    (domanda.stato === 'esclusa' || domanda.motivazioneEsclusione !== null) &&
    domanda.riesameStato !== 'deciso';

  const inviaOsservazione = async (): Promise<void> => {
    if (!domanda) return;
    setErroreInvio(null);
    setInvioInCorso(true);
    try {
      await presentaOsservazione(domanda.id, testoOsservazione);
      setTestoOsservazione('');
      caricaOsservazioni(() => false);
    } catch (err) {
      // Messaggio del backend mostrato verbatim: è il backend a decidere se lo
      // stato della domanda è osservabile o se il riesame è già deciso.
      setErroreInvio(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante l\'invio dell\'osservazione.');
    } finally {
      setInvioInCorso(false);
    }
  };

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
          Esiti Istruttoria &amp; Tabellone ISF
        </h2>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Coefficienti normativi e Indice di Soddisfazione Fabbisogno per{' '}
          {activeEntity.associazioneDenominazione ?? 'l\'associazione selezionata'} (artt. B.10-B.11 Allegato B)
        </p>
      </div>

      {erroreDomanda && <div style={STILE_ERRORE}>{erroreDomanda}</div>}

      <div className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>La mia domanda</h3>

        {caricamentoDomanda && <div>Caricamento domanda…</div>}

        {!caricamentoDomanda && !domanda && <div>Nessuna domanda presentata per questa stagione.</div>}

        {!caricamentoDomanda && domanda && domanda.stato === 'presentata' && (
          <div>Esito istruttoria non ancora pubblicato per questa domanda.</div>
        )}

        {!caricamentoDomanda && domanda && domanda.stato !== 'presentata' && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <span>Protocollo <strong>{domanda.numeroProtocollo}</strong></span>
              <span className={domanda.stato === 'ammessa' ? 'badge badge-success' : 'badge badge-danger'}>
                {domanda.stato === 'ammessa' ? 'Ammessa' : 'Esclusa'}
              </span>
              {domanda.riesameStato !== 'nessuno' && (
                <span className="badge badge-warning">
                  {domanda.riesameStato === 'richiesto' ? 'Riesame richiesto' : 'Riesame deciso'}
                </span>
              )}
            </div>

            {/* erroreEsiti è mostrato una sola volta, nella sezione tabellone
                sotto (stessa fetch condivisa): duplicarlo qui significherebbe
                lo stesso messaggio due volte nella stessa pagina. */}
            {!esitoProprio || !esitoProprio.fabbisognoRiconosciuto || !esitoProprio.coefficienti ? (
              <div style={STILE_BOX}>In attesa di calcolo coefficienti.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                <div className="pa-card">
                  <div style={STILE_KPI_LABEL}>Fabbisogno Riconosciuto (FR)</div>
                  <div style={{ ...STILE_KPI_VALORE, color: 'var(--pa-blue-primary)' }}>
                    {esitoProprio.fabbisognoRiconosciuto.frFinaleMinuti} minuti
                  </div>
                  <div style={STILE_KPI_NOTA}>
                    FD dichiarato: {esitoProprio.fabbisognoRiconosciuto.fdMinuti} • FR calcolato:{' '}
                    {esitoProprio.fabbisognoRiconosciuto.frCalcolatoMinuti}
                  </div>
                </div>

                <div className="pa-card">
                  <div style={STILE_KPI_LABEL}>Coefficiente di Ponderazione (CP)</div>
                  <div style={{ ...STILE_KPI_VALORE, color: 'var(--pa-blue-dark)' }}>{esitoProprio.coefficienti.cp}</div>
                  <div style={STILE_KPI_NOTA}>
                    CRS {esitoProprio.coefficienti.crs} • CAA {esitoProprio.coefficienti.caa} • CSD{' '}
                    {esitoProprio.coefficienti.csd}
                  </div>
                </div>

                <div className="pa-card">
                  <div style={STILE_KPI_LABEL}>Punteggio ISF</div>
                  <div style={{ ...STILE_KPI_VALORE, color: '#8E44AD' }}>
                    {isf === null ? '—' : `${isf.toFixed(3)} (${(isf * 100).toFixed(1)}%)`}
                  </div>
                  <div style={STILE_KPI_NOTA}>
                    ISF = VA / FR = {valoreAssegnatoMinuti} / {esitoProprio.fabbisognoRiconosciuto.frFinaleMinuti}
                  </div>
                </div>

                <div className="pa-card">
                  <div style={STILE_KPI_LABEL}>Slot Assegnati</div>
                  <div style={{ ...STILE_KPI_VALORE, color: 'var(--pa-success)' }}>
                    {assegnazioni.length} slot ({valoreAssegnatoMinuti} min)
                  </div>
                  <div style={STILE_KPI_NOTA}>Valore assegnato (VA) ponderato per fascia</div>
                </div>
              </div>
            )}

            {erroreAssegnazioni && <div style={STILE_ERRORE}>{erroreAssegnazioni}</div>}

            <h4 style={{ fontSize: '1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>Slot assegnati</h4>
            {assegnazioni.length === 0 ? (
              <div>Nessuno slot assegnato.</div>
            ) : (
              <div className="pa-table-container">
                <table className="pa-table">
                  <thead>
                    <tr>
                      <th>Impianto &amp; Spazio Sportivo</th>
                      <th>Giorno</th>
                      <th>Fascia Oraria</th>
                      <th>Durata &amp; Valore</th>
                      <th>Fascia</th>
                      <th>Stato Assegnazione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assegnazioni.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.impiantoDenominazione}</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>{a.spazioDenominazione}</div>
                        </td>
                        <td><strong>{GIORNI[a.giornoSettimana] ?? `Giorno ${a.giornoSettimana}`}</strong></td>
                        <td>{a.orarioInizio} - {a.orarioFine}</td>
                        <td>{a.durataMinuti} min • {a.valoreMinuti} min VA</td>
                        <td>
                          {a.pregiata ? (
                            <span className="badge badge-warning">Pregiata</span>
                          ) : (
                            <span className="badge badge-neutral">Ordinaria</span>
                          )}
                        </td>
                        <td>
                          <span className={a.stato === 'validata' ? 'badge badge-success' : 'badge badge-info'}>
                            {ETICHETTA_TIPO[a.tipo]}
                            {a.stato === 'provvisoria' ? ' (provvisoria)' : ''}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {mostraOsservazioni && domanda && (
        <div className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>
            Osservazioni e richiesta di riesame (art. B.11)
          </h3>

          {domanda.motivazioneEsclusione && (
            <div style={{ ...STILE_BOX, display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <Info size={18} style={{ flexShrink: 0, color: 'var(--pa-info)' }} />
              <div>
                <div style={{ fontWeight: 700 }}>Motivazione dell'esclusione</div>
                <div>{domanda.motivazioneEsclusione}</div>
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="esiti-osservazione-testo">Testo dell'osservazione:</label>
            <textarea
              id="esiti-osservazione-testo"
              className="form-control"
              rows={4}
              value={testoOsservazione}
              onChange={(e) => setTestoOsservazione(e.target.value)}
            />
          </div>

          {erroreInvio && <div style={STILE_ERRORE}>{erroreInvio}</div>}

          <div>
            <button type="button" className="btn btn-primary" onClick={inviaOsservazione} disabled={invioInCorso}>
              <Send size={16} />
              <span>{invioInCorso ? 'Invio in corso…' : 'Presenta osservazione'}</span>
            </button>
          </div>

          {erroreOsservazioni && <div style={STILE_ERRORE}>{erroreOsservazioni}</div>}

          <h4 style={{ fontSize: '1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>Osservazioni già presentate</h4>
          {osservazioni.length === 0 ? (
            <div>Nessuna osservazione presentata.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {osservazioni.map((o) => (
                <div key={o.id} style={{ ...STILE_BOX, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={CLASSE_BADGE_OSSERVAZIONE[o.stato]}>{ETICHETTA_STATO_OSSERVAZIONE[o.stato]}</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--pa-text-muted)' }}>
                      Presentata il {formattaData(o.presentataIl)}
                    </span>
                  </div>
                  <div>{o.testo}</div>
                  {o.decisioneMotivazione && (
                    <div style={{ fontSize: '0.85rem' }}>
                      <strong>Decisione:</strong> {o.decisioneMotivazione}
                      {o.decisaIl && (
                        <span style={{ color: 'var(--pa-text-muted)' }}> — {formattaData(o.decisaIl)}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>
          Tabellone pubblico esiti istruttoria (art. B.10)
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--pa-text-muted)', margin: 0 }}>
          L'ISF è visibile solo per la propria associazione: il valore assegnato (VA) delle altre associazioni non è
          un dato accessibile.
        </p>

        {erroreEsiti && <div style={STILE_ERRORE}>{erroreEsiti}</div>}

        {esiti.length === 0 ? (
          <div>Nessun esito ancora pubblicato per questa stagione.</div>
        ) : (
          <div className="pa-table-container">
            <table className="pa-table">
              <thead>
                <tr>
                  <th>Associazione</th>
                  <th>Stato</th>
                  <th>FR finale (minuti)</th>
                  <th>ISF</th>
                </tr>
              </thead>
              <tbody>
                {esiti.map((e) => {
                  const propria = e.associazioneId === associazioneId;
                  return (
                    <tr key={e.domandaId} style={propria ? { fontWeight: 700 } : undefined}>
                      <td>
                        {e.associazioneDenominazione}
                        {propria && <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>La tua associazione</span>}
                      </td>
                      <td>
                        <span
                          className={
                            e.stato === 'ammessa'
                              ? 'badge badge-success'
                              : e.stato === 'esclusa'
                                ? 'badge badge-danger'
                                : 'badge badge-neutral'
                          }
                        >
                          {e.stato}
                        </span>
                      </td>
                      <td>{e.fabbisognoRiconosciuto?.frFinaleMinuti ?? '—'}</td>
                      <td>{propria && isf !== null ? `${isf.toFixed(3)} (${(isf * 100).toFixed(1)}%)` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
