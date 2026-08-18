import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, CheckCircle2, Plus, Trash2, Sparkles, ArrowUp, ArrowDown, Layers } from 'lucide-react';
import type { EntitaRappresentata } from '../api/deleghe.ts';
import { listaDiscipline, type Disciplina } from '../api/discipline.ts';
import { listaClassiAttivita, type ClasseAttivita } from '../api/classiAttivita.ts';
import { listaSlot, type SlotDisponibile } from '../api/slot.ts';
import {
  creaDomanda,
  listaDomandePerAssociazione,
  anteprimaFabbisogno,
  type Domanda,
  type DatiCreaDomanda,
  type AnteprimaFabbisogno,
  type LivelloCampionato,
  type RichiestaGiornataGara,
} from '../api/domande.ts';
import { ErroreRichiestaApi } from '../api/client.ts';

interface WizardDomandaProps {
  entities: EntitaRappresentata[];
  stagioneId: string | null;
  activeEntity: EntitaRappresentata | null;
}

const LIVELLI_CAMPIONATO: Array<{ value: LivelloCampionato; label: string }> = [
  { value: 'provinciale', label: 'Provinciale' },
  { value: 'regionale', label: 'Regionale' },
  { value: 'interregionale', label: 'Interregionale' },
  { value: 'nazionale', label: 'Nazionale' },
];

const GIORNI = ['—', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

// Specchio esatto di REGEX_MINUTI in backend-node/src/pubblicoSchema.ts
// (coerente con NUMERIC(10,3) di domande.fabbisogno_*_minuti). Non va
// reinventata: una regex più permissiva qui produrrebbe un 400 al submit,
// una più stretta rifiuterebbe valori che il backend accetta.
const REGEX_MINUTI = /^\d{1,7}(\.\d{1,3})?$/;

function etichettaSlot(s: SlotDisponibile): string {
  const giorno = GIORNI[s.giornoSettimana] ?? `Giorno ${s.giornoSettimana}`;
  return `${s.impiantoDenominazione} — ${s.spazioDenominazione} · ${giorno} ${s.orarioInizio}–${s.orarioFine} (${s.durataMinuti} min)${s.pregiata ? ' · fascia pregiata' : ''}`;
}

// Data/ora di presentazione leggibile; se il backend restituisse un valore non
// parsabile si mostra la stringa originale invece di "Invalid Date".
function formattaData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT');
}

// Riga vuota di richiesta giornata gara: `necessitaImpiantoOmologato` parte a
// true (default normativo art. B.12-15 — una giornata gara ufficiale richiede
// di norma un impianto omologato per la federazione dichiarata).
function nuovaRichiestaGara(): RichiestaGiornataGara {
  return { federazione: '', campionato: '', categoria: '', requisitiTecnici: '', necessitaImpiantoOmologato: true };
}

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

export const WizardDomandaView: React.FC<WizardDomandaProps> = ({ entities, stagioneId, activeEntity }) => {
  const associazioneId = activeEntity?.associazioneId ?? null;

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [erroreStep, setErroreStep] = useState<string | null>(null);

  // Guardia "già presentata" (domande_associazione_stagione_uq: una sola
  // domanda per associazione/stagione, mai modificabile dopo la presentazione).
  const [verificaInCorso, setVerificaInCorso] = useState<boolean>(true);
  const [domandaEsistente, setDomandaEsistente] = useState<Domanda | null>(null);
  const [erroreVerifica, setErroreVerifica] = useState<string | null>(null);

  // Step 1
  const [discipline, setDiscipline] = useState<Disciplina[]>([]);
  const [classiAttivita, setClassiAttivita] = useState<ClasseAttivita[]>([]);
  const [erroreAnagrafiche, setErroreAnagrafiche] = useState<string | null>(null);
  const [disciplineCodici, setDisciplineCodici] = useState<string[]>([]);
  const [classeAttivitaCodice, setClasseAttivitaCodice] = useState<string>('');
  const [livelloCampionato, setLivelloCampionato] = useState<string>('');
  const [numeroTesserati, setNumeroTesserati] = useState<string>('0');
  const [numeroAtletiPartecipanti, setNumeroAtletiPartecipanti] = useState<string>('0');
  const [numeroSquadre, setNumeroSquadre] = useState<string>('0');
  const [numeroSquadreFederaliStagionePrecedente, setNumeroSquadreFederaliStagionePrecedente] = useState<string>('0');
  const [attivitaGiovanile, setAttivitaGiovanile] = useState(false);
  const [attivitaAgonistica, setAttivitaAgonistica] = useState(false);
  const [attivitaParalimpicaInclusiva, setAttivitaParalimpicaInclusiva] = useState(false);

  // Step 2 — importi in minuti trattati come stringhe opache (vincolo
  // decimal-as-string di progetto: mai convertiti in Number per aritmetica).
  const [fabbisognoMinimoMinuti, setFabbisognoMinimoMinuti] = useState<string>('');
  const [fabbisognoOttimaleMinuti, setFabbisognoOttimaleMinuti] = useState<string>('');
  const [anteprima, setAnteprima] = useState<AnteprimaFabbisogno | null>(null);
  const [erroreAnteprima, setErroreAnteprima] = useState<string | null>(null);
  const [anteprimaInCorso, setAnteprimaInCorso] = useState(false);

  // Step 3
  const [richiedeGiornataGara, setRichiedeGiornataGara] = useState(false);
  const [richiesteGiornataGara, setRichiesteGiornataGara] = useState<RichiestaGiornataGara[]>([]);

  // Step 4
  const [disciplinaFiltroSlot, setDisciplinaFiltroSlot] = useState<string>('');
  const [slot, setSlot] = useState<SlotDisponibile[]>([]);
  const [erroreSlot, setErroreSlot] = useState<string | null>(null);
  const [preferenze, setPreferenze] = useState<string[]>([]);
  const [selezionatiPerBlocco, setSelezionatiPerBlocco] = useState<string[]>([]);
  const [blocchiAllenamento, setBlocchiAllenamento] = useState<string[][]>([]);

  const [erroreInvio, setErroreInvio] = useState<string | null>(null);
  const [invioInCorso, setInvioInCorso] = useState(false);

  useEffect(() => {
    let annullato = false;
    if (!associazioneId || !stagioneId) {
      setVerificaInCorso(false);
      return;
    }
    setVerificaInCorso(true);
    listaDomandePerAssociazione(associazioneId, stagioneId)
      .then((domande) => {
        if (annullato) return;
        setDomandaEsistente(domande.find((d) => d.stagioneId === stagioneId) ?? null);
        setErroreVerifica(null);
      })
      .catch((err) => {
        if (annullato) return;
        // Non si può stabilire se una domanda esista già: mostrare comunque il
        // wizard rischierebbe un POST destinato al 409 sul vincolo unico, quindi
        // segnaliamo l'errore in modo esplicito ma lasciamo il form utilizzabile.
        setErroreVerifica(
          err instanceof ErroreRichiestaApi
            ? `Impossibile verificare le domande già presentate: ${err.message}`
            : 'Impossibile verificare le domande già presentate.',
        );
      })
      .finally(() => {
        if (!annullato) setVerificaInCorso(false);
      });
    return () => {
      annullato = true;
    };
  }, [associazioneId, stagioneId]);

  useEffect(() => {
    let annullato = false;
    // Nessun form da popolare se manca il contesto operativo (stagione o
    // associazione attiva): la view mostra comunque solo un messaggio.
    if (!associazioneId || !stagioneId) return;
    Promise.all([listaDiscipline(), listaClassiAttivita()])
      .then(([d, c]) => {
        if (annullato) return;
        setDiscipline(d);
        setClassiAttivita(c);
      })
      .catch(() => {
        if (annullato) return;
        setErroreAnagrafiche('Elenco discipline / classi di attività non disponibile.');
      });
    return () => {
      annullato = true;
    };
  }, [associazioneId, stagioneId]);

  // Filtro slot: default sulla PRIMA disciplina selezionata allo step 1; se
  // l'utente cambia la selezione, il filtro segue finché non lo sposta a mano.
  useEffect(() => {
    setDisciplinaFiltroSlot((prec) => (prec && disciplineCodici.includes(prec) ? prec : disciplineCodici[0] ?? ''));
  }, [disciplineCodici]);

  // Il flag di cancellazione vive nell'useEffect chiamante (stesso pattern di
  // StatisticheView.tsx), non dentro la useCallback: caricaSlot riceve un
  // controllo "è ancora valida questa richiesta?" invece di gestire da sola lo
  // stato di cancellazione, così una risposta lenta e superata (es. due switch
  // rapidi del filtro disciplina) viene scartata invece di sovrascrivere uno
  // stato più recente.
  const caricaSlot = useCallback((estaAnnullato: () => boolean): void => {
    if (!stagioneId) return;
    listaSlot(stagioneId, disciplinaFiltroSlot || undefined)
      .then((s) => {
        if (estaAnnullato()) return;
        setSlot(s);
        setErroreSlot(null);
      })
      .catch((err) => {
        if (estaAnnullato()) return;
        setSlot([]);
        setErroreSlot(
          err instanceof ErroreRichiestaApi ? `Elenco slot non disponibile: ${err.message}` : 'Elenco slot non disponibile.',
        );
      });
  }, [stagioneId, disciplinaFiltroSlot]);

  useEffect(() => {
    if (currentStep !== 4) return;
    let annullato = false;
    caricaSlot(() => annullato);
    return () => {
      annullato = true;
    };
  }, [currentStep, caricaSlot]);

  if (!stagioneId) {
    return (
      <div className="pa-container">
        <div className="pa-card">Seleziona una stagione dall'intestazione per presentare una domanda.</div>
      </div>
    );
  }

  if (!activeEntity || !associazioneId) {
    return (
      <div className="pa-container">
        <div className="pa-card">
          Seleziona un'associazione con delega approvata per presentare una domanda.
          {entities.length === 0 && ' Non risultano associazioni rappresentate: richiedi prima un accreditamento.'}
        </div>
      </div>
    );
  }

  const toggleDisciplina = (codice: string): void => {
    setDisciplineCodici((prec) => (prec.includes(codice) ? prec.filter((c) => c !== codice) : [...prec, codice]));
  };

  const toggleSlotPreferenza = (slotId: string): void => {
    if (!preferenze.includes(slotId)) {
      setPreferenze((prec) => [...prec, slotId]);
      return;
    }
    // Rimuovendo uno slot dalle preferenze si rimuove anche da eventuali
    // blocchi/selezioni in corso: un blocco non può contenere slot non
    // preferiti (e sotto i 2 elementi il blocco stesso non è più valido).
    setPreferenze((prec) => prec.filter((id) => id !== slotId));
    setSelezionatiPerBlocco((sel) => sel.filter((id) => id !== slotId));
    setBlocchiAllenamento((bl) => bl.map((b) => b.filter((id) => id !== slotId)).filter((b) => b.length >= 2));
  };

  const spostaPreferenza = (indice: number, delta: number): void => {
    setPreferenze((prec) => {
      const nuovo = [...prec];
      const destinazione = indice + delta;
      if (destinazione < 0 || destinazione >= nuovo.length) return prec;
      const a = nuovo[indice]!;
      nuovo[indice] = nuovo[destinazione]!;
      nuovo[destinazione] = a;
      return nuovo;
    });
  };

  const toggleSelezionePerBlocco = (slotId: string): void => {
    setSelezionatiPerBlocco((prec) => (prec.includes(slotId) ? prec.filter((id) => id !== slotId) : [...prec, slotId]));
  };

  // Uno slot può appartenere ad al più UN blocco allenamento: due blocchi che
  // condividono lo stesso slot sono semanticamente incoerenti (lo slot non può
  // essere contemporaneamente in due allenamenti contigui distinti).
  const indiceBloccoDi = (slotId: string): number => blocchiAllenamento.findIndex((b) => b.includes(slotId));

  const raggruppaInBlocco = (): void => {
    if (selezionatiPerBlocco.length < 2) return;
    // Ordine del blocco = ordine di preferenza, non ordine di click.
    const blocco = preferenze.filter((id) => selezionatiPerBlocco.includes(id) && indiceBloccoDi(id) === -1);
    if (blocco.length < 2) return;
    setBlocchiAllenamento((prec) => [...prec, blocco]);
    setSelezionatiPerBlocco([]);
  };

  const rimuoviBlocco = (indice: number): void => {
    // Gli slot restano nelle preferenze: sciogliere un blocco non è una
    // rinuncia allo slot, solo al vincolo di contiguità.
    setBlocchiAllenamento((prec) => prec.filter((_, i) => i !== indice));
  };

  const aggiornaRichiestaGara = (indice: number, campo: keyof RichiestaGiornataGara, valore: string | boolean): void => {
    setRichiesteGiornataGara((prec) => prec.map((r, i) => (i === indice ? { ...r, [campo]: valore } : r)));
  };

  const etichettaSlotPerId = (slotId: string): string => {
    const trovato = slot.find((s) => s.id === slotId);
    return trovato ? etichettaSlot(trovato) : slotId;
  };

  const validaStep = (step: number): string | null => {
    if (step === 1) {
      if (disciplineCodici.length === 0) return 'Seleziona almeno una disciplina.';
      return null;
    }
    if (step === 2) {
      // Specchio di schemaCreaDomanda: entrambi i fabbisogni devono rispettare
      // REGEX_MINUTI e ottimale >= minimo. Il confronto numerico è l'unico
      // punto in cui i minuti diventano Number, ed è una VALIDAZIONE, non un
      // ricalcolo: i valori inviati restano le stringhe digitate dall'utente
      // (stesso `Number(...) >= Number(...)` del refine zod lato backend).
      if (!REGEX_MINUTI.test(fabbisognoMinimoMinuti)) {
        return 'Indica un fabbisogno minimo settimanale valido (minuti, es. 360 oppure 360.5).';
      }
      if (!REGEX_MINUTI.test(fabbisognoOttimaleMinuti)) {
        return 'Indica un fabbisogno ottimale settimanale valido (minuti, es. 480 oppure 480.5).';
      }
      if (Number(fabbisognoOttimaleMinuti) < Number(fabbisognoMinimoMinuti)) {
        return 'Il fabbisogno ottimale deve essere maggiore o uguale al fabbisogno minimo.';
      }
      return null;
    }
    if (step === 3) {
      // Specchio della regola zod lato backend:
      // richiedeGiornataGara ⇒ richiesteGiornataGara.length > 0
      if (richiedeGiornataGara && richiesteGiornataGara.length === 0) {
        return 'Hai richiesto un blocco giornata gara: aggiungi almeno una richiesta prima di proseguire.';
      }
      // schemaRichiestaGiornataGara richiede .min(1) su federazione/campionato/
      // categoria: una riga aggiunta ma lasciata vuota passerebbe il conteggio
      // sopra e verrebbe rifiutata dal backend.
      if (richiedeGiornataGara) {
        const incompleta = richiesteGiornataGara.findIndex(
          (r) => !r.federazione.trim() || !r.campionato.trim() || !r.categoria.trim(),
        );
        if (incompleta !== -1) {
          return `Richiesta giornata gara #${incompleta + 1}: federazione, campionato e categoria sono obbligatori.`;
        }
      }
      return null;
    }
    if (step === 4) {
      // preferenze: z.array(z.string().uuid()).min(1)
      if (preferenze.length === 0) {
        return 'Seleziona almeno uno slot tra le preferenze prima di inviare la domanda.';
      }
      return null;
    }
    return null;
  };

  // Rivalidazione completa: lo stepper cliccabile permette di saltare uno step
  // senza passare dal bottone "Avanti", quindi il submit non può fidarsi delle
  // sole validazioni già eseguite in navigazione.
  const validaTutto = (): string | null =>
    validaStep(1) ?? validaStep(2) ?? validaStep(3) ?? validaStep(4);

  const avanti = (): void => {
    const errore = validaStep(currentStep);
    if (errore) {
      setErroreStep(errore);
      return;
    }
    setErroreStep(null);
    setCurrentStep((prec) => Math.min(4, prec + 1));
  };

  const indietro = (): void => {
    setErroreStep(null);
    setCurrentStep((prec) => Math.max(1, prec - 1));
  };

  const calcolaAnteprima = async (): Promise<void> => {
    setErroreAnteprima(null);
    if (!classeAttivitaCodice) {
      setErroreAnteprima('Seleziona la classe di attività allo step 1 prima di calcolare l\'anteprima.');
      return;
    }
    if (!fabbisognoOttimaleMinuti) {
      setErroreAnteprima('Indica il fabbisogno ottimale settimanale prima di calcolare l\'anteprima.');
      return;
    }
    setAnteprimaInCorso(true);
    try {
      const risultato = await anteprimaFabbisogno({
        associazioneId,
        stagioneId,
        classeAttivitaCodice,
        ...(livelloCampionato ? { livelloCampionato: livelloCampionato as LivelloCampionato } : {}),
        numeroSquadreFederali: Number(numeroSquadreFederaliStagionePrecedente),
        // Valore opaco: passato verbatim al motore, mai ricalcolato qui.
        fdMinuti: fabbisognoOttimaleMinuti,
      });
      setAnteprima(risultato);
    } catch (err) {
      setAnteprima(null);
      if (err instanceof ErroreRichiestaApi) {
        setErroreAnteprima(
          err.status === 502 || err.status === 503
            ? `Motore di calcolo non disponibile: l'anteprima non può essere calcolata in questo momento (${err.message}). Puoi comunque completare e inviare la domanda.`
            : `Anteprima non calcolabile: ${err.message}`,
        );
      } else {
        setErroreAnteprima('Anteprima non calcolabile: errore imprevisto.');
      }
    } finally {
      setAnteprimaInCorso(false);
    }
  };

  const inviaDomanda = async (): Promise<void> => {
    const erroreValidazione = validaTutto();
    if (erroreValidazione) {
      setErroreInvio(erroreValidazione);
      return;
    }
    setErroreInvio(null);
    setInvioInCorso(true);
    try {
      const dati: DatiCreaDomanda = {
        associazioneId,
        stagioneId,
        disciplineCodici,
        ...(classeAttivitaCodice ? { classeAttivitaCodice } : {}),
        ...(livelloCampionato ? { livelloCampionato: livelloCampionato as LivelloCampionato } : {}),
        numeroTesserati: Number(numeroTesserati),
        numeroAtletiPartecipanti: Number(numeroAtletiPartecipanti),
        numeroSquadre: Number(numeroSquadre),
        numeroSquadreFederaliStagionePrecedente: Number(numeroSquadreFederaliStagionePrecedente),
        attivitaGiovanile,
        attivitaAgonistica,
        attivitaParalimpicaInclusiva,
        fabbisognoMinimoMinuti,
        fabbisognoOttimaleMinuti,
        preferenze,
        blocchiAllenamento,
        richiedeGiornataGara,
        richiesteGiornataGara: richiedeGiornataGara
          ? richiesteGiornataGara.map((r) => ({
              federazione: r.federazione,
              campionato: r.campionato,
              categoria: r.categoria,
              ...(r.requisitiTecnici ? { requisitiTecnici: r.requisitiTecnici } : {}),
              necessitaImpiantoOmologato: r.necessitaImpiantoOmologato,
            }))
          : [],
      };
      const domanda = await creaDomanda(dati);
      setDomandaEsistente(domanda);
    } catch (err) {
      setErroreInvio(
        err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto durante l\'invio della domanda.',
      );
    } finally {
      setInvioInCorso(false);
    }
  };

  if (verificaInCorso) {
    return (
      <div className="pa-container">
        <div className="pa-card">Verifica domande già presentate…</div>
      </div>
    );
  }

  if (domandaEsistente) {
    return (
      <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>Domanda già presentata</h2>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            {activeEntity.associazioneDenominazione ?? 'Associazione'} — una sola domanda per associazione e per stagione:
            la domanda presentata non è modificabile.
          </p>
        </div>
        <div className="pa-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--pa-success)' }}>
            <CheckCircle2 size={20} />
            <strong>Numero protocollo: {domandaEsistente.numeroProtocollo}</strong>
          </div>
          <div style={STILE_BOX}>
            <div>Stato: <strong>{domandaEsistente.stato}</strong></div>
            <div>Presentata il: <strong>{formattaData(domandaEsistente.presentataIl)}</strong></div>
            <div>Fabbisogno minimo dichiarato: <strong>{domandaEsistente.fabbisognoMinimoMinuti}</strong> minuti</div>
            <div>Fabbisogno ottimale dichiarato: <strong>{domandaEsistente.fabbisognoOttimaleMinuti}</strong> minuti</div>
            <div>Tesserati: <strong>{domandaEsistente.numeroTesserati}</strong></div>
            <div>Atleti partecipanti: <strong>{domandaEsistente.numeroAtletiPartecipanti}</strong></div>
            <div>Squadre: <strong>{domandaEsistente.numeroSquadre}</strong></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pa-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', color: 'var(--pa-blue-dark)' }}>
          Presentazione Domanda Fabbisogno &amp; Preferenze
        </h2>
        <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
          Compilazione guidata a 4 step per {activeEntity.associazioneDenominazione ?? 'l\'associazione selezionata'} (Fase 2 Allegato B)
        </p>
      </div>

      {erroreVerifica && <div style={STILE_ERRORE}>{erroreVerifica}</div>}
      {erroreAnagrafiche && <div style={STILE_ERRORE}>{erroreAnagrafiche}</div>}

      <div className="stepper-container">
        {['Dati Attività & Squadre', 'Fabbisogno (FD / FR)', 'Blocco Giornata Gara', 'Preferenze & Blocchi'].map((label, i) => {
          const n = i + 1;
          return (
            <div
              key={label}
              className={`step-item ${currentStep === n ? 'active' : currentStep > n ? 'completed' : ''}`}
              onClick={() => setCurrentStep(n)}
            >
              <div className="step-circle">{currentStep > n ? '✓' : n}</div>
              <div className="step-label">{label}</div>
            </div>
          );
        })}
      </div>

      <div className="pa-card">
        {currentStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.5rem' }}>
              Step 1: Inquadramento Attività Sportiva
            </h3>

            <div className="form-group">
              <label className="form-label">Discipline sportive praticate:</label>
              <div style={{ ...STILE_BOX, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {discipline.length === 0 && <span style={{ color: 'var(--pa-text-muted)' }}>Nessuna disciplina disponibile.</span>}
                {discipline.map((d) => (
                  <div key={d.codice} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      id={`wiz-disciplina-${d.codice}`}
                      type="checkbox"
                      checked={disciplineCodici.includes(d.codice)}
                      onChange={() => toggleDisciplina(d.codice)}
                    />
                    <label htmlFor={`wiz-disciplina-${d.codice}`} style={{ margin: 0 }}>{d.denominazione}</label>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-classe-attivita">Classe di Attività:</label>
                <select id="wiz-classe-attivita" className="form-control" value={classeAttivitaCodice}
                  onChange={(e) => setClasseAttivitaCodice(e.target.value)}>
                  <option value="">Seleziona…</option>
                  {classiAttivita.map((c) => (
                    <option key={c.codice} value={c.codice}>{c.codice} — {c.descrizione} (Peso Base: {c.pesoBase})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-livello-campionato">Livello Campionato (opzionale):</label>
                <select id="wiz-livello-campionato" className="form-control" value={livelloCampionato}
                  onChange={(e) => setLivelloCampionato(e.target.value)}>
                  <option value="">Nessuno / non applicabile</option>
                  {LIVELLI_CAMPIONATO.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-numero-tesserati">Numero Tesserati:</label>
                <input id="wiz-numero-tesserati" type="number" min="0" className="form-control"
                  value={numeroTesserati} onChange={(e) => setNumeroTesserati(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-numero-atleti">Numero Atleti Partecipanti:</label>
                <input id="wiz-numero-atleti" type="number" min="0" className="form-control"
                  value={numeroAtletiPartecipanti} onChange={(e) => setNumeroAtletiPartecipanti(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-numero-squadre">Numero Squadre:</label>
                <input id="wiz-numero-squadre" type="number" min="0" className="form-control"
                  value={numeroSquadre} onChange={(e) => setNumeroSquadre(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-numero-squadre-federali">Squadre Federali Stagione Precedente:</label>
                <input id="wiz-numero-squadre-federali" type="number" min="0" className="form-control"
                  value={numeroSquadreFederaliStagionePrecedente}
                  onChange={(e) => setNumeroSquadreFederaliStagionePrecedente(e.target.value)} />
              </div>
            </div>

            <div style={{ ...STILE_BOX, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input id="wiz-attivita-giovanile" type="checkbox" checked={attivitaGiovanile}
                  onChange={(e) => setAttivitaGiovanile(e.target.checked)} />
                <label htmlFor="wiz-attivita-giovanile" style={{ margin: 0 }}>Attività giovanile</label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input id="wiz-attivita-agonistica" type="checkbox" checked={attivitaAgonistica}
                  onChange={(e) => setAttivitaAgonistica(e.target.checked)} />
                <label htmlFor="wiz-attivita-agonistica" style={{ margin: 0 }}>Attività agonistica</label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input id="wiz-attivita-paralimpica" type="checkbox" checked={attivitaParalimpicaInclusiva}
                  onChange={(e) => setAttivitaParalimpicaInclusiva(e.target.checked)} />
                <label htmlFor="wiz-attivita-paralimpica" style={{ margin: 0 }}>Attività paralimpica / inclusiva</label>
              </div>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.5rem' }}>
              Step 2: Fabbisogno Dichiarato (FD)
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-fd-minimo">Fabbisogno Minimo Settimanale (minuti):</label>
                <input id="wiz-fd-minimo" type="number" min="0" step="30" className="form-control"
                  value={fabbisognoMinimoMinuti} onChange={(e) => setFabbisognoMinimoMinuti(e.target.value)} />
                <span style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Es. 360 minuti = 6 ore settimanali</span>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-fd-ottimale">Fabbisogno Ottimale Settimanale (minuti):</label>
                <input id="wiz-fd-ottimale" type="number" min="0" step="30" className="form-control"
                  value={fabbisognoOttimaleMinuti} onChange={(e) => setFabbisognoOttimaleMinuti(e.target.value)} />
                <span style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)' }}>Es. 480 minuti = 8 ore settimanali</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button type="button" className="btn btn-secondary" onClick={calcolaAnteprima} disabled={anteprimaInCorso}>
                <Sparkles size={16} />
                <span>{anteprimaInCorso ? 'Calcolo in corso…' : 'Calcola Anteprima'}</span>
              </button>
              <span style={{ fontSize: '0.78rem', color: 'var(--pa-text-muted)' }}>
                Anteprima — il valore definitivo sarà confermato dalla Provincia in fase di istruttoria.
              </span>
            </div>

            {erroreAnteprima && <div style={STILE_ERRORE}>{erroreAnteprima}</div>}

            {anteprima && (
              <div style={{ backgroundColor: '#E8F8F5', border: '1px solid #A3E4D7', padding: '1.25rem', borderRadius: '8px' }}>
                <h4 style={{ margin: 0, color: 'var(--pa-success)' }}>Fabbisogno Riconosciuto (anteprima)</h4>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--pa-success)', marginTop: '4px' }}>
                  {anteprima.frFinaleMinuti} minuti settimanali
                </div>
                <div style={{ fontSize: '0.75rem', color: '#16A085', marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <span>Peso base: {anteprima.pesoBase}</span>
                  <span>Incremento squadre: {anteprima.incrementoSquadre}</span>
                  <span>FR calcolato: {anteprima.frCalcolatoMinuti}</span>
                  <span>CRS: {anteprima.crs}</span>
                  <span>CAA: {anteprima.caa}</span>
                  <span>CSD: {anteprima.csd}</span>
                  <span>CP: {anteprima.cp}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.5rem' }}>
              Step 3: Richiesta Blocco Giornata di Gara (Art. B.12-B.15)
            </h3>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input id="wiz-richiede-gara" type="checkbox" checked={richiedeGiornataGara}
                onChange={(e) => setRichiedeGiornataGara(e.target.checked)} style={{ width: '18px', height: '18px' }} />
              <label htmlFor="wiz-richiede-gara" style={{ fontWeight: 700, margin: 0, cursor: 'pointer' }}>
                Richiedi blocco/i giornata gara
              </label>
            </div>

            {richiedeGiornataGara && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {richiesteGiornataGara.length === 0 && (
                  <div style={{ color: 'var(--pa-text-muted)', fontSize: '0.85rem' }}>
                    Nessuna richiesta aggiunta.
                  </div>
                )}
                {richiesteGiornataGara.map((r, i) => (
                  <div key={i} style={{ ...STILE_BOX, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" htmlFor={`wiz-gara-federazione-${i}`}>Federazione:</label>
                        <input id={`wiz-gara-federazione-${i}`} type="text" className="form-control" value={r.federazione}
                          onChange={(e) => aggiornaRichiestaGara(i, 'federazione', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" htmlFor={`wiz-gara-campionato-${i}`}>Campionato:</label>
                        <input id={`wiz-gara-campionato-${i}`} type="text" className="form-control" value={r.campionato}
                          onChange={(e) => aggiornaRichiestaGara(i, 'campionato', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" htmlFor={`wiz-gara-categoria-${i}`}>Categoria:</label>
                        <input id={`wiz-gara-categoria-${i}`} type="text" className="form-control" value={r.categoria}
                          onChange={(e) => aggiornaRichiestaGara(i, 'categoria', e.target.value)} />
                      </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" htmlFor={`wiz-gara-requisiti-${i}`}>Requisiti Tecnici (opzionale):</label>
                      <input id={`wiz-gara-requisiti-${i}`} type="text" className="form-control" value={r.requisitiTecnici ?? ''}
                        onChange={(e) => aggiornaRichiestaGara(i, 'requisitiTecnici', e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input id={`wiz-gara-omologato-${i}`} type="checkbox" checked={r.necessitaImpiantoOmologato}
                          onChange={(e) => aggiornaRichiestaGara(i, 'necessitaImpiantoOmologato', e.target.checked)} />
                        <label htmlFor={`wiz-gara-omologato-${i}`} style={{ margin: 0 }}>Necessita impianto omologato</label>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => setRichiesteGiornataGara((prec) => prec.filter((_, j) => j !== i))}>
                        <Trash2 size={14} /> Rimuovi
                      </button>
                    </div>
                  </div>
                ))}
                <div>
                  <button type="button" className="btn btn-secondary"
                    onClick={() => setRichiesteGiornataGara((prec) => [...prec, nuovaRichiestaGara()])}>
                    <Plus size={16} /> Aggiungi richiesta giornata gara
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--pa-blue-dark)', borderBottom: '1px solid var(--pa-border)', paddingBottom: '0.5rem' }}>
              Step 4: Preferenze Slot &amp; Blocchi Allenamento
            </h3>

            {disciplineCodici.length > 1 && (
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-disciplina-filtro-slot">Disciplina usata per filtrare gli slot:</label>
                <select id="wiz-disciplina-filtro-slot" className="form-control" value={disciplinaFiltroSlot}
                  onChange={(e) => setDisciplinaFiltroSlot(e.target.value)}>
                  {disciplineCodici.map((c) => (
                    <option key={c} value={c}>{discipline.find((d) => d.codice === c)?.denominazione ?? c}</option>
                  ))}
                </select>
              </div>
            )}

            {erroreSlot && <div style={STILE_ERRORE}>{erroreSlot}</div>}

            <div className="form-group">
              <label className="form-label">Slot disponibili — seleziona quelli da inserire nelle preferenze:</label>
              <div style={{ ...STILE_BOX, display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '18rem', overflowY: 'auto' }}>
                {slot.length === 0 && <span style={{ color: 'var(--pa-text-muted)' }}>Nessuno slot disponibile per la disciplina selezionata.</span>}
                {slot.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input id={`wiz-slot-${s.id}`} type="checkbox" checked={preferenze.includes(s.id)}
                      onChange={() => toggleSlotPreferenza(s.id)} />
                    <label htmlFor={`wiz-slot-${s.id}`} style={{ margin: 0, fontSize: '0.85rem' }}>{etichettaSlot(s)}</label>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Preferenze in ordine di priorità:</label>
              {preferenze.length === 0 && (
                <div style={{ color: 'var(--pa-text-muted)', fontSize: '0.85rem' }}>Nessuna preferenza selezionata.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {preferenze.map((slotId, indice) => {
                  const bloccoDi = indiceBloccoDi(slotId);
                  return (
                  <div key={slotId} style={{ ...STILE_BOX, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.6rem 0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span className="badge badge-primary">{indice + 1}</span>
                      <input id={`wiz-blocco-sel-${slotId}`} type="checkbox" checked={selezionatiPerBlocco.includes(slotId)}
                        disabled={bloccoDi !== -1} onChange={() => toggleSelezionePerBlocco(slotId)} />
                      <label htmlFor={`wiz-blocco-sel-${slotId}`}
                        style={{ margin: 0, fontSize: '0.85rem', color: bloccoDi !== -1 ? 'var(--pa-text-muted)' : undefined }}>
                        {etichettaSlotPerId(slotId)}
                        {bloccoDi !== -1 && (
                          <span style={{ marginLeft: '0.5rem', fontStyle: 'italic' }}>
                            — già nel blocco {bloccoDi + 1}
                          </span>
                        )}
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button type="button" className="btn btn-secondary btn-sm" aria-label={`Sposta su ${indice + 1}`}
                        onClick={() => spostaPreferenza(indice, -1)} disabled={indice === 0}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" aria-label={`Sposta giù ${indice + 1}`}
                        onClick={() => spostaPreferenza(indice, 1)} disabled={indice === preferenze.length - 1}>
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            <div>
              <button type="button" className="btn btn-secondary" onClick={raggruppaInBlocco}
                disabled={selezionatiPerBlocco.length < 2}>
                <Layers size={16} /> Raggruppa in blocco allenamento
              </button>
              <span style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)', marginLeft: '0.75rem' }}>
                Seleziona almeno 2 slot tra le preferenze per creare un blocco.
              </span>
            </div>

            {blocchiAllenamento.length > 0 && (
              <div className="form-group">
                <label className="form-label">Blocchi allenamento richiesti:</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {blocchiAllenamento.map((blocco, i) => (
                    <div key={i} style={{ ...STILE_BOX, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ fontSize: '0.82rem' }}>
                        <strong>Blocco {i + 1}</strong>
                        <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                          {blocco.map((slotId) => <li key={slotId}>{etichettaSlotPerId(slotId)}</li>)}
                        </ul>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => rimuoviBlocco(i)}>
                        <Trash2 size={14} /> Rimuovi blocco
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {erroreInvio && <div style={STILE_ERRORE}>{erroreInvio}</div>}
          </div>
        )}

        {erroreStep && <div style={{ ...STILE_ERRORE, marginTop: '1rem' }}>{erroreStep}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', borderTop: '1px solid var(--pa-border)', paddingTop: '1rem' }}>
          <button type="button" onClick={indietro} disabled={currentStep === 1} className="btn btn-secondary">
            <ArrowLeft size={16} />
            <span>Indietro</span>
          </button>

          {currentStep < 4 ? (
            <button type="button" onClick={avanti} className="btn btn-primary">
              <span>Avanti al Prossimo Step</span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <button type="button" onClick={inviaDomanda} className="btn btn-success" disabled={invioInCorso}>
              <CheckCircle2 size={16} />
              <span>{invioInCorso ? 'Invio in corso…' : 'Invia Domanda Definitiva'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
