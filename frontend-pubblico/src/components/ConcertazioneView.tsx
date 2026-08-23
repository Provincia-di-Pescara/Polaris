import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Send, Check, XCircle } from 'lucide-react';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import {
  propostaProvvisoria,
  creaProposta,
  listaProposteConcertazione,
  accettaProposta,
  annullaProposta,
  type VocePropostaProvvisoria,
  type TipoProposta,
  type StatoProposta,
  type Proposta,
  type DatiCreaProposta,
} from '../api/concertazione.ts';
import { ErroreRichiestaApi } from '../api/client.ts';

interface ConcertazioneProps {
  entities: EntitaRappresentata[];
  stagioneId: string | null;
  activeEntity: EntitaRappresentata | null;
}

interface RigaSlotForm {
  slotCedutoId: string;
  associazioneRiceventeId: string;
  slotRicevutoId: string;
}

function nuovaRiga(): RigaSlotForm {
  return { slotCedutoId: '', associazioneRiceventeId: '', slotRicevutoId: '' };
}

const GIORNI = ['—', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

const ETICHETTA_TIPO: Record<TipoProposta, string> = {
  scambio_bilaterale: 'Scambio bilaterale',
  scambio_multilaterale: 'Scambio multilaterale',
  cessione: 'Cessione',
  utilizzo_slot_libero: 'Utilizzo di uno slot libero',
  accorpamento: 'Accorpamento',
  ampliamento: 'Ampliamento',
};

const ETICHETTA_STATO: Record<StatoProposta, string> = {
  in_attesa_accettazione: 'In attesa di accettazione',
  accettata_da_tutti: 'Accettata, in attesa di validazione',
  validata: 'Validata',
  rigettata: 'Rigettata',
  annullata: 'Annullata',
};

const CLASSE_BADGE_STATO: Record<StatoProposta, string> = {
  in_attesa_accettazione: 'badge badge-warning',
  accettata_da_tutti: 'badge badge-info',
  validata: 'badge badge-success',
  rigettata: 'badge badge-danger',
  annullata: 'badge badge-neutral',
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

function etichettaGiornoOrario(v: VocePropostaProvvisoria): string {
  const giorno = GIORNI[v.giornoSettimana] ?? `Giorno ${v.giornoSettimana}`;
  return `${giorno} ${v.orarioInizio}–${v.orarioFine} (${v.durataMinuti} min)${v.pregiata ? ' · fascia pregiata' : ''}`;
}

function messaggioErrore(err: unknown, prefisso: string): string {
  return err instanceof ErroreRichiestaApi ? `${prefisso}: ${err.message}` : `${prefisso}.`;
}

export const ConcertazioneView: React.FC<ConcertazioneProps> = ({ entities, stagioneId, activeEntity }) => {
  const associazioneId = activeEntity?.associazioneId ?? null;

  const [bollettino, setBollettino] = useState<VocePropostaProvvisoria[]>([]);
  const [caricamentoBollettino, setCaricamentoBollettino] = useState<boolean>(true);
  // Messaggio mostrato verbatim: il caso atteso è un 409 ErroreStatoNonValidoPerTransizione
  // ("la concertazione non è ancora aperta per questa stagione"), ma qualunque
  // errore su questa fetch nasconde le sezioni sottostanti — senza bollettino
  // non c'è nulla di coerente da mostrare (né lookup slot, né form di proposta).
  const [erroreBollettino, setErroreBollettino] = useState<string | null>(null);

  const [proposte, setProposte] = useState<Proposta[]>([]);
  const [erroreProposte, setErroreProposte] = useState<string | null>(null);

  const [azioneInCorsoId, setAzioneInCorsoId] = useState<string | null>(null);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);

  const [tipo, setTipo] = useState<TipoProposta>('scambio_bilaterale');
  const [righe, setRighe] = useState<RigaSlotForm[]>([]);
  const [erroreForm, setErroreForm] = useState<string | null>(null);
  const [invioInCorso, setInvioInCorso] = useState<boolean>(false);
  const [messaggioSuccesso, setMessaggioSuccesso] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    if (!stagioneId || !associazioneId) {
      setCaricamentoBollettino(false);
      return;
    }
    setCaricamentoBollettino(true);
    propostaProvvisoria(stagioneId)
      .then((voci) => {
        if (annullato) return;
        setBollettino(voci);
        setErroreBollettino(null);
      })
      .catch((err) => {
        if (annullato) return;
        setBollettino([]);
        setErroreBollettino(
          err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto nel caricamento del bollettino.',
        );
      })
      .finally(() => {
        if (!annullato) setCaricamentoBollettino(false);
      });
    return () => {
      annullato = true;
    };
  }, [stagioneId, associazioneId]);

  // Tre azioni indipendenti (accetta/annulla/invia proposta) possono innescare
  // ciascuna una ricarica dell'elenco proposte, oltre all'effect al mount/cambio
  // stagione: il flag di cancellazione da solo protegge solo il proprio cleanup,
  // non l'ordine di arrivo tra fetch diverse — se una più lenta risolve DOPO
  // un'altra più recente, sovrascriverebbe silenziosamente la lista appena
  // aggiornata con dati superati. Stesso pattern "risposte fuori ordine" già in
  // EsitiIsfView.tsx (richiestaOsservazioniIdRef) / AuditSorteggioView / StatisticheView.
  const richiestaProposteIdRef = useRef(0);

  const caricaProposte = useCallback((estaAnnullato: () => boolean): void => {
    if (!stagioneId) return;
    const idRichiesta = ++richiestaProposteIdRef.current;
    listaProposteConcertazione(stagioneId)
      .then((lista) => {
        if (estaAnnullato() || idRichiesta !== richiestaProposteIdRef.current) return;
        setProposte(lista);
        setErroreProposte(null);
      })
      .catch((err) => {
        if (estaAnnullato() || idRichiesta !== richiestaProposteIdRef.current) return;
        setProposte([]);
        setErroreProposte(messaggioErrore(err, 'Elenco proposte non disponibile'));
      });
  }, [stagioneId]);

  useEffect(() => {
    if (!stagioneId || !associazioneId) {
      setProposte([]);
      setErroreProposte(null);
      return;
    }
    let annullato = false;
    caricaProposte(() => annullato);
    return () => {
      annullato = true;
    };
  }, [stagioneId, associazioneId, caricaProposte]);

  // Due mappe di lookup condivise da tutte le sezioni sotto, derivate dal
  // bollettino: mai ricalcolate ad ogni render.
  const mappaSlot = useMemo(() => {
    const m = new Map<string, VocePropostaProvvisoria>();
    bollettino.forEach((v) => m.set(v.slotId, v));
    return m;
  }, [bollettino]);

  const mappaAssociazioni = useMemo(() => {
    const m = new Map<string, string>();
    bollettino.forEach((v) => {
      if (!m.has(v.associazioneId)) m.set(v.associazioneId, v.associazioneDenominazione);
    });
    return m;
  }, [bollettino]);

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

  const etichettaSlotPerId = (slotId: string): string => {
    const voce = mappaSlot.get(slotId);
    if (!voce) return slotId;
    return `${voce.impiantoDenominazione} — ${voce.spazioDenominazione} · ${etichettaGiornoOrario(voce)}`;
  };

  const denominazionePerId = (id: string): string => mappaAssociazioni.get(id) ?? id;

  // Righe form: slot proprie disponibili come "slot da cedere".
  const vociProprie = bollettino.filter((v) => v.associazioneId === associazioneId);
  const associazioniDistinte = Array.from(mappaAssociazioni.entries());

  const aggiungiRiga = (): void => {
    setRighe((prec) => [...prec, nuovaRiga()]);
  };

  const rimuoviRiga = (indice: number): void => {
    setRighe((prec) => prec.filter((_, i) => i !== indice));
  };

  const aggiornaRiga = (indice: number, campo: keyof RigaSlotForm, valore: string): void => {
    setRighe((prec) =>
      prec.map((r, i) => {
        if (i !== indice) return r;
        // Cambiando l'associazione ricevente le opzioni di "slot ricevuto"
        // cambiano: una selezione precedente non più coerente va azzerata.
        if (campo === 'associazioneRiceventeId') return { ...r, associazioneRiceventeId: valore, slotRicevutoId: '' };
        return { ...r, [campo]: valore };
      }),
    );
  };

  // Simulazione ISF — UNICO calcolo client-side ammesso: mai inviato al
  // backend, mai autoritativo, solo stima informativa aggiornata ad ogni
  // modifica del form.
  const vaAttualeMinuti = vociProprie.reduce((tot, v) => tot + Number(v.valoreMinutiAssegnato), 0);
  const frProprioMinuti = vociProprie[0]?.fabbisognoRiconosciutoMinuti ?? null;
  const minutiCeduti = righe.reduce((tot, r) => {
    if (tipo === 'utilizzo_slot_libero' || !r.slotCedutoId) return tot;
    return tot + (mappaSlot.get(r.slotCedutoId)?.durataMinuti ?? 0);
  }, 0);
  const minutiRicevuti = righe.reduce((tot, r) => {
    if (!r.slotRicevutoId || r.associazioneRiceventeId !== associazioneId) return tot;
    return tot + (mappaSlot.get(r.slotRicevutoId)?.durataMinuti ?? 0);
  }, 0);
  const vaStimatoMinuti = vaAttualeMinuti - minutiCeduti + minutiRicevuti;
  const frProprioNumerico = frProprioMinuti === null ? Number.NaN : Number(frProprioMinuti);
  const isfStimato =
    Number.isFinite(frProprioNumerico) && frProprioNumerico > 0 ? vaStimatoMinuti / frProprioNumerico : null;
  const mostraSimulazione = vociProprie.length > 0;

  const validaForm = (): string | null => {
    if (righe.length === 0) return 'Aggiungi almeno una riga slot prima di inviare la proposta.';
    if (tipo !== 'utilizzo_slot_libero') {
      const indiceMancante = righe.findIndex((r) => !r.slotCedutoId);
      if (indiceMancante !== -1) return `Riga #${indiceMancante + 1}: seleziona lo slot da cedere.`;
    }
    return null;
  };

  const inviaProposta = async (): Promise<void> => {
    const errore = validaForm();
    if (errore) {
      setErroreForm(errore);
      return;
    }
    setErroreForm(null);
    setMessaggioSuccesso(null);
    setInvioInCorso(true);
    try {
      // Specchio del refine zod backend: associazioneCedenteId assente per
      // 'utilizzo_slot_libero', presente per tutti gli altri tipi. Ogni riga
      // del form può generare fino a due voci slot: la cessione del proprio
      // slot verso la ricevente e, se compilata, la ricezione di uno slot
      // della ricevente in cambio (bilaterale/multilaterale/accorpamento/
      // ampliamento) — per una cessione semplice si compila solo la prima.
      const slot: DatiCreaProposta['slot'] = [];
      righe.forEach((r) => {
        if (tipo !== 'utilizzo_slot_libero' && r.slotCedutoId) {
          slot.push({
            slotId: r.slotCedutoId,
            associazioneCedenteId: associazioneId,
            associazioneRiceventeId: r.associazioneRiceventeId,
          });
        }
        if (r.slotRicevutoId) {
          slot.push({
            slotId: r.slotRicevutoId,
            ...(tipo !== 'utilizzo_slot_libero' ? { associazioneCedenteId: r.associazioneRiceventeId } : {}),
            associazioneRiceventeId: associazioneId,
          });
        }
      });
      const creata = await creaProposta({ stagioneId, proponenteAssociazioneId: associazioneId, tipo, slot });
      setRighe([]);
      setMessaggioSuccesso(`Proposta creata con successo (id ${creata.id}).`);
      caricaProposte(() => false);
    } catch (err) {
      setErroreForm(
        err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante l\'invio della proposta.',
      );
    } finally {
      setInvioInCorso(false);
    }
  };

  const accetta = async (proposta: Proposta): Promise<void> => {
    setErroreAzione(null);
    setAzioneInCorsoId(proposta.id);
    try {
      await accettaProposta(proposta.id, associazioneId);
      caricaProposte(() => false);
    } catch (err) {
      setErroreAzione(
        err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante l\'accettazione della proposta.',
      );
    } finally {
      setAzioneInCorsoId(null);
    }
  };

  const annulla = async (proposta: Proposta): Promise<void> => {
    setErroreAzione(null);
    setAzioneInCorsoId(proposta.id);
    try {
      await annullaProposta(proposta.id);
      caricaProposte(() => false);
    } catch (err) {
      setErroreAzione(
        err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante l\'annullamento della proposta.',
      );
    } finally {
      setAzioneInCorsoId(null);
    }
  };

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
          Concertazione tra associazioni
        </h2>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Proposta provvisoria e scambi/cessioni tra associazioni per{' '}
          {activeEntity.associazioneDenominazione ?? 'l\'associazione selezionata'} (artt. B.23-B.28 Allegato B)
        </p>
      </div>

      {caricamentoBollettino && <div className="pa-card">Caricamento bollettino…</div>}

      {!caricamentoBollettino && erroreBollettino && <div className="pa-card" style={STILE_ERRORE}>{erroreBollettino}</div>}

      {!caricamentoBollettino && !erroreBollettino && (
        <>
          <div className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>
              Bollettino proposta provvisoria (art. B.23)
            </h3>

            {bollettino.length === 0 ? (
              <div>Nessuna voce nel bollettino per questa stagione.</div>
            ) : (
              <div className="pa-table-container">
                <table className="pa-table">
                  <thead>
                    <tr>
                      <th>Impianto &amp; Spazio Sportivo</th>
                      <th>Giorno / Orario</th>
                      <th>Associazione</th>
                      <th>FR</th>
                      <th>ISF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bollettino.map((v) => {
                      const propria = v.associazioneId === associazioneId;
                      return (
                        <tr key={v.slotId} style={propria ? { fontWeight: 700 } : undefined}>
                          <td>
                            <strong>{v.impiantoDenominazione}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>{v.spazioDenominazione}</div>
                          </td>
                          <td>{etichettaGiornoOrario(v)}</td>
                          <td>
                            {v.associazioneDenominazione}
                            {propria && <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>La tua associazione</span>}
                          </td>
                          <td>{v.fabbisognoRiconosciutoMinuti ?? '—'}</td>
                          <td>{v.isf ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>Le mie proposte</h3>

            {erroreProposte && <div style={STILE_ERRORE}>{erroreProposte}</div>}
            {erroreAzione && <div style={STILE_ERRORE}>{erroreAzione}</div>}

            {proposte.length === 0 ? (
              <div>Nessuna proposta di concertazione presente.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {proposte.map((p) => {
                  const propriaParte = p.parti.find((parte) => parte.associazioneId === associazioneId) ?? null;
                  const puoAccettare = p.stato === 'in_attesa_accettazione' && propriaParte !== null && propriaParte.accettatoIl === null;
                  // Il backend verifica proponentePersonaFisicaId === persona corrente
                  // (route /annulla), non solo l'associazione: due delegati della stessa
                  // associazione non sono intercambiabili, un secondo delegato che non
                  // ha proposto lui stesso otterrebbe sempre un 403. activeEntity.personaFisicaId
                  // è la persona fisica corrente (GET /pubblico/deleghe/mie è già filtrato
                  // per personaFisicaId = persona autenticata, vedi docs/claude/backend-node.md).
                  const puoAnnullare =
                    p.stato === 'in_attesa_accettazione' &&
                    p.proponenteAssociazioneId === associazioneId &&
                    p.proponentePersonaFisicaId === activeEntity.personaFisicaId;
                  return (
                    <div key={p.id} style={{ ...STILE_BOX, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="badge badge-primary">{ETICHETTA_TIPO[p.tipo]}</span>
                        <span className={CLASSE_BADGE_STATO[p.stato]}>{ETICHETTA_STATO[p.stato]}</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--pa-text-muted)' }}>
                          Proponente: {denominazionePerId(p.proponenteAssociazioneId)}
                        </span>
                      </div>

                      {p.stato === 'rigettata' && p.motivazioneRigetto && (
                        <div style={{ fontSize: '0.85rem' }}>
                          <strong>Motivazione rigetto:</strong> {p.motivazioneRigetto}
                        </div>
                      )}

                      <div style={{ fontSize: '0.82rem' }}>
                        <strong>Parti coinvolte:</strong>
                        <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                          {p.parti.map((parte) => (
                            <li key={parte.associazioneId}>
                              {denominazionePerId(parte.associazioneId)} —{' '}
                              {parte.accettatoIl !== null ? 'ha accettato' : 'non ha ancora accettato'}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div style={{ fontSize: '0.82rem' }}>
                        <strong>Slot coinvolti:</strong>
                        <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                          {p.slot.map((s, i) => (
                            <li key={`${s.slotId}-${i}`}>
                              {etichettaSlotPerId(s.slotId)} —{' '}
                              {s.associazioneCedenteId
                                ? `da ${denominazionePerId(s.associazioneCedenteId)} a ${denominazionePerId(s.associazioneRiceventeId)}`
                                : `verso ${denominazionePerId(s.associazioneRiceventeId)}`}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {(puoAccettare || puoAnnullare) && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          {puoAccettare && (
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              disabled={azioneInCorsoId === p.id}
                              onClick={() => accetta(p)}
                            >
                              <Check size={14} />
                              <span>Accetta</span>
                            </button>
                          )}
                          {puoAnnullare && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={azioneInCorsoId === p.id}
                              onClick={() => annulla(p)}
                            >
                              <XCircle size={14} />
                              <span>Annulla</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>Proponi nuova concertazione</h3>

            <div className="form-group">
              <label className="form-label" htmlFor="conc-tipo">Tipo proposta:</label>
              <select id="conc-tipo" className="form-control" value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoProposta)}>
                {(Object.keys(ETICHETTA_TIPO) as TipoProposta[]).map((t) => (
                  <option key={t} value={t}>{ETICHETTA_TIPO[t]}</option>
                ))}
              </select>
            </div>

            {tipo === 'utilizzo_slot_libero' && (
              <div style={{ backgroundColor: '#FEF9E7', border: '1px solid #F7DC6F', padding: '0.6rem 0.85rem', borderRadius: '6px', fontSize: '0.82rem' }}>
                Attenzione: gli slot proposti qui sotto provengono dal bollettino della proposta provvisoria, quindi
                risultano già assegnati. Una richiesta di "Utilizzo di uno slot libero" è valida solo su uno slot
                realmente libero — questo form non permette ancora di individuarli. La proposta potrebbe essere
                accettata subito (nessun'altra parte coinvolta) ma essere respinta in un secondo momento, in fase di
                validazione da parte dell'ufficio.
              </div>
            )}

            {righe.length === 0 && (
              <div style={{ color: 'var(--pa-text-muted)', fontSize: '0.85rem' }}>Nessuna riga slot aggiunta.</div>
            )}

            {righe.map((r, i) => (
              <div key={i} style={{ ...STILE_BOX, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: tipo === 'utilizzo_slot_libero' ? '1fr 1fr' : '1fr 1fr 1fr', gap: '1rem' }}>
                  {tipo !== 'utilizzo_slot_libero' && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" htmlFor={`conc-riga-ceduto-${i}`}>Slot da cedere:</label>
                      <select id={`conc-riga-ceduto-${i}`} className="form-control" value={r.slotCedutoId}
                        onChange={(e) => aggiornaRiga(i, 'slotCedutoId', e.target.value)}>
                        <option value="">Seleziona…</option>
                        {vociProprie.map((v) => (
                          <option key={v.slotId} value={v.slotId}>
                            {v.impiantoDenominazione} — {v.spazioDenominazione} · {etichettaGiornoOrario(v)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" htmlFor={`conc-riga-ricevente-${i}`}>Associazione ricevente:</label>
                    <select id={`conc-riga-ricevente-${i}`} className="form-control" value={r.associazioneRiceventeId}
                      onChange={(e) => aggiornaRiga(i, 'associazioneRiceventeId', e.target.value)}>
                      <option value="">Seleziona…</option>
                      {associazioniDistinte.map(([id, denom]) => (
                        <option key={id} value={id}>{denom}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" htmlFor={`conc-riga-ricevuto-${i}`}>Slot ricevuto:</label>
                    <select id={`conc-riga-ricevuto-${i}`} className="form-control" value={r.slotRicevutoId}
                      disabled={!r.associazioneRiceventeId}
                      onChange={(e) => aggiornaRiga(i, 'slotRicevutoId', e.target.value)}>
                      <option value="">Seleziona…</option>
                      {bollettino.filter((v) => v.associazioneId === r.associazioneRiceventeId).map((v) => (
                        <option key={v.slotId} value={v.slotId}>
                          {v.impiantoDenominazione} — {v.spazioDenominazione} · {etichettaGiornoOrario(v)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => rimuoviRiga(i)}>
                    <Trash2 size={14} /> Rimuovi riga
                  </button>
                </div>
              </div>
            ))}

            <div>
              <button type="button" className="btn btn-secondary" onClick={aggiungiRiga}>
                <Plus size={16} /> Aggiungi riga slot
              </button>
            </div>

            {mostraSimulazione && (
              <div style={{ backgroundColor: '#E8F8F5', border: '1px solid #A3E4D7', padding: '1rem', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--pa-success)' }}>
                  SIMULAZIONE ISF (stima informativa — il valore reale sarà confermato in fase di validazione)
                </div>
                <div style={{ fontSize: '0.85rem', color: '#16A085', marginTop: '4px' }}>
                  VA stimato: <strong>{vaStimatoMinuti}</strong> min (attuale {vaAttualeMinuti} min, -{minutiCeduti} ceduti, +{minutiRicevuti} ricevuti)
                  {isfStimato !== null && (
                    <> — ISF stimato: <strong>{isfStimato.toFixed(3)} ({(isfStimato * 100).toFixed(1)}%)</strong></>
                  )}
                </div>
              </div>
            )}

            {erroreForm && <div style={STILE_ERRORE}>{erroreForm}</div>}
            {messaggioSuccesso && (
              <div style={{ backgroundColor: '#E8F8F5', color: 'var(--pa-success)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
                {messaggioSuccesso}
              </div>
            )}

            <div>
              <button type="button" className="btn btn-primary" onClick={inviaProposta} disabled={invioInCorso}>
                <Send size={16} />
                <span>{invioInCorso ? 'Invio in corso…' : 'Invia proposta'}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
