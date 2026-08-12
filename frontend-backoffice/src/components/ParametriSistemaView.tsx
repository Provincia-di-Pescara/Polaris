import React, { useEffect, useState } from 'react';
import { leggiVersioneAttiva, listaVersioni, type VersioneParametrica, type VersioneParametricaSintetica, ErroreRichiestaApi } from '../api/parametrico.ts';
import { VersioneParametricaForm } from './parametrico/VersioneParametricaForm.tsx';
import { Plus, History, Lock } from 'lucide-react';

export const ParametriSistemaView: React.FC = () => {
  const [versioneAttiva, setVersioneAttiva] = useState<VersioneParametrica | null>(null);
  const [storico, setStorico] = useState<VersioneParametricaSintetica[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const ricarica = (): void => {
    leggiVersioneAttiva()
      .then((v) => {
        setVersioneAttiva(v);
        setErrore(null);
      })
      .catch((err) => setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Impossibile caricare la versione attiva.'));
    listaVersioni()
      .then(setStorico)
      .catch(() => {
        // storico non essenziale al rendering principale: nessun blocco della vista
      });
  };

  useEffect(ricarica, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', color: 'var(--pa-blue-dark)' }}>Parametri di Sistema (`allegato_parametrico`)</h1>
          <p style={{ color: 'var(--pa-text-muted)', fontSize: '0.9rem' }}>
            Valori normativi modificabili esclusivamente dall'Amministratore e versionati su DB
          </p>
        </div>
        {versioneAttiva && (
          <button onClick={() => setIsEditing(true)} disabled={isEditing} className="btn btn-primary">
            <Plus size={16} />
            <span>Pubblica Nuova Versione Parametrica</span>
          </button>
        )}
      </div>

      <div className="pa-card" style={{ backgroundColor: '#FEF9E7', borderLeft: '4px solid #F39C12' }}>
        <div style={{ display: 'flex', gap: '0.85rem' }}>
          <Lock size={22} color="#D68910" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 700, color: '#B7950B' }}>Garanzia di Riproducibilità Storica (Art. B.1 - Allegato B)</div>
            <div style={{ fontSize: '0.825rem', color: '#7D6608', marginTop: '2px' }}>
              I parametri non vengono mai sovrascritti <em>in place</em>. Ogni nuova modifica genera un nuovo record versionato.
            </div>
          </div>
        </div>
      </div>

      {errore && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {errore}
        </div>
      )}

      {versioneAttiva && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.25rem' }}>
          <div className="pa-card">
            {isEditing ? (
              <VersioneParametricaForm
                versioneAttuale={versioneAttiva}
                onSalvata={(v) => {
                  setVersioneAttiva(v);
                  setIsEditing(false);
                  ricarica();
                }}
                onAnnulla={() => setIsEditing(false)}
              />
            ) : (
              <>
                <span className="badge badge-success" style={{ marginBottom: '0.35rem' }}>Versione Attiva Ora</span>
                <div style={{ fontSize: '0.775rem', color: 'var(--pa-text-muted)', marginBottom: '1rem' }}>
                  Valida dal: {versioneAttiva.validaDal}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div>Moltiplicatore Minuti/Peso: <strong>{versioneAttiva.moltiplicatoreMinutiPerPunto}</strong></div>
                  <div>Peso Fasce Pregiate: <strong>{versioneAttiva.pesoFasciaPregiata}</strong></div>
                  <div>Limite Minuti Settimanali: <strong>{versioneAttiva.minutiSettimanaliMax}</strong></div>
                  <div>Limite Slot Stesso Impianto: <strong>{versioneAttiva.slotMaxStessoImpianto}</strong></div>
                  <div>Tolleranza ISF: <strong>{versioneAttiva.tolleranzaIsfPct}</strong></div>
                  <div>Quota Nuove Associazioni: <strong>{versioneAttiva.quotaNuoveAssociazioniPct}</strong></div>
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'var(--pa-blue-dark)' }}>
              <History size={18} color="var(--pa-blue-primary)" />
              <span>Storico Versioni ({storico.length})</span>
            </div>
            {storico.map((v) => (
              <div key={v.id} className="pa-card" style={{ borderLeft: v.id === versioneAttiva.id ? '4px solid var(--pa-success)' : '1px solid var(--pa-border)', padding: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: '0.875rem' }}>{v.validaDal}</strong>
                  {v.id === versioneAttiva.id ? (
                    <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>ATTIVA</span>
                  ) : (
                    <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>ARCHIVIATA</span>
                  )}
                </div>
                {v.note && <div style={{ fontSize: '0.75rem', color: 'var(--pa-text-muted)', marginTop: '0.2rem' }}>{v.note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
