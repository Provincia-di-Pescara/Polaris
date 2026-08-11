import React, { useEffect, useState } from 'react';
import { Plus, MapPin } from 'lucide-react';
import {
  listaDiscipline, listaIstituzioni, listaImpianti, listaSpaziPerImpianto, listaSlot,
  type Disciplina, type Istituzione, type Impianto, type SpazioSportivo, type Slot,
} from '../api/impiantiSpazi.ts';
import { listaStagioni } from '../api/stagioni.ts';
import { DisciplinaForm } from './impianti/DisciplinaForm.tsx';
import { IstituzioneForm } from './impianti/IstituzioneForm.tsx';
import { ImpiantoForm } from './impianti/ImpiantoForm.tsx';
import { SpazioForm } from './impianti/SpazioForm.tsx';
import { SlotForm } from './impianti/SlotForm.tsx';
import { GrigliaSlot } from './impianti/GrigliaSlot.tsx';

type FormAperto =
  | { tipo: 'impianto'; esistente?: Impianto }
  | { tipo: 'spazio'; esistente?: SpazioSportivo }
  | { tipo: 'slot'; esistente?: Slot }
  | null;

export const ImpiantiSpaziView: React.FC = () => {
  const [discipline, setDiscipline] = useState<Disciplina[]>([]);
  const [istituzioni, setIstituzioni] = useState<Istituzione[]>([]);
  const [impianti, setImpianti] = useState<Impianto[]>([]);
  const [stagioneCorrenteId, setStagioneCorrenteId] = useState<string>('');
  const [impiantoSelezionatoId, setImpiantoSelezionatoId] = useState<string>('');
  const [spazi, setSpazi] = useState<SpazioSportivo[]>([]);
  const [spazioSelezionatoId, setSpazioSelezionatoId] = useState<string>('');
  const [slot, setSlot] = useState<Slot[]>([]);
  const [formAperto, setFormAperto] = useState<FormAperto>(null);

  useEffect(() => {
    listaDiscipline().then(setDiscipline);
    listaIstituzioni().then(setIstituzioni);
    listaImpianti().then((imp) => {
      setImpianti(imp);
      if (imp.length > 0) setImpiantoSelezionatoId((prev) => prev || imp[0]!.id);
    });
    listaStagioni().then((s) => {
      if (s.length > 0) setStagioneCorrenteId((prev) => prev || s[0]!.id);
    });
  }, []);

  useEffect(() => {
    if (!impiantoSelezionatoId) {
      setSpazi([]);
      setSpazioSelezionatoId('');
      return;
    }
    listaSpaziPerImpianto(impiantoSelezionatoId).then((s) => {
      setSpazi(s);
      setSpazioSelezionatoId((prev) => (s.some((x) => x.id === prev) ? prev : s[0]?.id ?? ''));
    });
  }, [impiantoSelezionatoId]);

  useEffect(() => {
    if (!stagioneCorrenteId || !spazioSelezionatoId) {
      setSlot([]);
      return;
    }
    listaSlot(stagioneCorrenteId, spazioSelezionatoId).then(setSlot);
  }, [stagioneCorrenteId, spazioSelezionatoId]);

  const ricaricaSpazi = (): void => {
    if (impiantoSelezionatoId) listaSpaziPerImpianto(impiantoSelezionatoId).then(setSpazi);
  };

  const ricaricaSlot = (): void => {
    if (stagioneCorrenteId && spazioSelezionatoId) listaSlot(stagioneCorrenteId, spazioSelezionatoId).then(setSlot);
  };

  const impiantoSelezionato = impianti.find((i) => i.id === impiantoSelezionatoId);
  const spazioSelezionato = spazi.find((s) => s.id === spazioSelezionatoId);
  const istituzioneDiImpianto = istituzioni.find((i) => i.id === impiantoSelezionato?.istituzioneScolasticaId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Impianti & Spazi Sportivi Provinciali</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Censimento palestre scolastiche, omologazioni sportive e configurazione fasce pregiate
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setFormAperto({ tipo: 'impianto' })}>
          <Plus size={16} />
          <span>Nuovo Impianto</span>
        </button>
      </div>

      {formAperto?.tipo === 'impianto' && (
        <div className="pa-card">
          <ImpiantoForm
            impiantoEsistente={formAperto.esistente}
            istituzioni={istituzioni}
            onSalvato={(imp) => {
              setImpianti((prev) => {
                const senzaEsistente = prev.filter((i) => i.id !== imp.id);
                return [...senzaEsistente, imp];
              });
              // Non selezionare automaticamente l'impianto appena creato/modificato:
              // se il nome comparisse contemporaneamente nella lista E nel pannello di
              // dettaglio (h2), un getByText(nome) risulterebbe ambiguo (più match).
              // La modifica di un impianto già selezionato resta comunque coerente
              // (l'id non cambia, il pannello si aggiorna con i dati nuovi).
              setFormAperto(null);
            }}
            onAnnulla={() => setFormAperto(null)}
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.25rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--pa-blue-dark)', textTransform: 'uppercase' }}>
            Palestre Provinciali ({impianti.length})
          </div>

          {impianti.map((imp) => {
            const isSelected = imp.id === impiantoSelezionatoId;
            return (
              <div
                key={imp.id}
                onClick={() => setImpiantoSelezionatoId(imp.id)}
                className="pa-card"
                style={{
                  cursor: 'pointer',
                  borderLeft: isSelected ? '4px solid var(--pa-blue-primary)' : '1px solid var(--pa-border)',
                  backgroundColor: isSelected ? 'var(--pa-blue-light)' : 'white',
                  padding: '1rem',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--pa-blue-dark)', fontSize: '0.925rem' }}>{imp.denominazione}</div>
                {imp.indirizzo && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.775rem', color: 'var(--pa-text-muted)', marginTop: '0.3rem' }}>
                    <MapPin size={14} color="var(--pa-blue-primary)" />
                    <span>{imp.indirizzo}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {impiantoSelezionato && (
            <div className="pa-card" style={{ borderTop: '4px solid var(--pa-blue-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '1.3rem', color: 'var(--pa-blue-dark)' }}>{impiantoSelezionato.denominazione}</h2>
                  {istituzioneDiImpianto && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--pa-text-muted)', marginTop: '0.2rem' }}>
                      Istituto Scolastico Titolare: <strong>{istituzioneDiImpianto.denominazione}</strong>
                    </div>
                  )}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setFormAperto({ tipo: 'impianto', esistente: impiantoSelezionato })}>
                  Modifica Scheda
                </button>
              </div>

              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--pa-blue-dark)', textTransform: 'uppercase' }}>
                  Spazi ({spazi.length})
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setFormAperto({ tipo: 'spazio' })}>
                  <Plus size={14} />
                  <span>Nuovo Spazio</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                {spazi.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => setSpazioSelezionatoId(s.id)}
                    className="pa-card"
                    style={{
                      cursor: 'pointer',
                      padding: '0.65rem 1rem',
                      borderLeft: s.id === spazioSelezionatoId ? '4px solid var(--pa-blue-primary)' : '1px solid var(--pa-border)',
                      backgroundColor: s.id === spazioSelezionatoId ? 'var(--pa-blue-light)' : '#F8FAFC',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--pa-blue-dark)', fontSize: '0.95rem' }}>{s.denominazione}</div>
                    <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem' }}>
                      {s.disciplineCompatibili.map((codice) => (
                        <span key={codice} className="badge badge-info" style={{ fontSize: '0.675rem' }}>
                          {codice}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {formAperto?.tipo === 'spazio' && (
                <div style={{ marginTop: '1rem' }}>
                  <SpazioForm
                    impiantoId={impiantoSelezionato.id}
                    spazioEsistente={formAperto.esistente}
                    discipline={discipline}
                    onSalvato={() => {
                      ricaricaSpazi();
                      setFormAperto(null);
                    }}
                    onAnnulla={() => setFormAperto(null)}
                  />
                </div>
              )}
            </div>
          )}

          {spazioSelezionato && (
            <div className="pa-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--pa-blue-dark)', margin: 0 }}>
                  Slot Settimanali — {spazioSelezionato.denominazione}
                </h3>
                <button className="btn btn-secondary btn-sm" onClick={() => setFormAperto({ tipo: 'slot' })}>
                  <Plus size={14} />
                  <span>Nuovo Slot</span>
                </button>
              </div>

              {formAperto?.tipo === 'slot' && stagioneCorrenteId && (
                <div style={{ marginBottom: '1rem' }}>
                  <SlotForm
                    stagioneId={stagioneCorrenteId}
                    spazioId={spazioSelezionato.id}
                    slotEsistente={formAperto.esistente}
                    onSalvato={() => {
                      ricaricaSlot();
                      setFormAperto(null);
                    }}
                    onAnnulla={() => setFormAperto(null)}
                  />
                </div>
              )}

              <GrigliaSlot slot={slot} onClickSlot={(s) => setFormAperto({ tipo: 'slot', esistente: s })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
