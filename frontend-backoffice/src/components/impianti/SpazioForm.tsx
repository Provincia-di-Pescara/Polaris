import React, { useState } from 'react';
import { creaSpazio, aggiornaSpazio, type SpazioSportivo, type Disciplina, ErroreRichiestaApi } from '../../api/impiantiSpazi.ts';

interface SpazioFormProps {
  impiantoId: string;
  spazioEsistente?: SpazioSportivo;
  discipline: Disciplina[];
  onSalvato: (s: SpazioSportivo) => void;
  onAnnulla: () => void;
}

export function SpazioForm({ impiantoId, spazioEsistente, discipline, onSalvato, onAnnulla }: SpazioFormProps): React.ReactElement {
  const [denominazione, setDenominazione] = useState(spazioEsistente?.denominazione ?? '');
  const [note, setNote] = useState(spazioEsistente?.note ?? '');
  const [disciplineSelezionate, setDisciplineSelezionate] = useState<string[]>(spazioEsistente?.disciplineCompatibili ?? []);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [filtroDiscipline, setFiltroDiscipline] = useState('');

  // Stesso motivo del tetto in ImpiantiSpaziView (Anagrafiche): il Postgres di
  // sviluppo condiviso ha accumulato migliaia di discipline fixture mai
  // ripulite — renderizzare un checkbox per ognuna qui rende il form
  // inutilizzabile (sia per un operatore reale sia in jsdom nei test). Le
  // discipline già selezionate restano SEMPRE visibili (anche se non passano
  // il filtro/il taglio), altrimenti aprire in modifica uno spazio con
  // discipline "fuori dalle prime 50" le farebbe sembrare deselezionate.
  // Le selezionate vanno prima e MAI tagliate dallo slice (non basta includerle
  // nel filtro: se finissero oltre la posizione 50 nell'array originale uno
  // slice naive le taglierebbe comunque fuori) — solo lo spazio restante fino
  // al tetto è riempito con le corrispondenze del filtro tra le non selezionate.
  const MAX_DISCIPLINE_VISIBILI = 50;
  const disciplineGiaSelezionate = discipline.filter((d) => disciplineSelezionate.includes(d.codice));
  const disciplineNonSelezionateFiltrate = discipline.filter(
    (d) =>
      !disciplineSelezionate.includes(d.codice) &&
      `${d.codice} ${d.denominazione}`.toLowerCase().includes(filtroDiscipline.toLowerCase()),
  );
  const disciplineVisibili = [...disciplineGiaSelezionate, ...disciplineNonSelezionateFiltrate].slice(0, MAX_DISCIPLINE_VISIBILI);

  const toggleDisciplina = (codice: string): void => {
    setDisciplineSelezionate((prev) =>
      prev.includes(codice) ? prev.filter((c) => c !== codice) : [...prev, codice],
    );
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      // In modifica il campo va sempre inviato, anche vuoto: il backend tratta
      // un `disciplineCompatibili` OMESSO come "preserva il valore esistente"
      // (non come "svuota"), quindi deselezionare tutto e salvare deve mandare
      // esplicitamente `[]`, altrimenti l'azione fallisce silenziosamente (le
      // discipline restano quelle di prima). In creazione non c'è nulla da
      // svuotare: omettere se vuoto resta accettabile lì.
      const datiComuni = {
        denominazione,
        ...(note ? { note } : {}),
        ...(spazioEsistente
          ? { disciplineCompatibili: disciplineSelezionate }
          : disciplineSelezionate.length > 0
            ? { disciplineCompatibili: disciplineSelezionate }
            : {}),
      };

      const risultato = spazioEsistente
        ? await aggiornaSpazio(spazioEsistente.id, datiComuni)
        : await creaSpazio({ impiantoId, ...datiComuni });
      onSalvato(risultato);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="spazio-denominazione" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Denominazione
        </label>
        <input
          id="spazio-denominazione"
          className="form-control"
          value={denominazione}
          onChange={(e) => setDenominazione(e.target.value)}
          required
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label htmlFor="spazio-note" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>
          Note
        </label>
        <textarea
          id="spazio-note"
          className="form-control"
          value={note ?? ''}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' }}>Discipline compatibili</span>
        <input
          type="text"
          className="form-control"
          placeholder="Cerca per codice o nome..."
          aria-label="Cerca disciplina compatibile"
          value={filtroDiscipline}
          onChange={(e) => setFiltroDiscipline(e.target.value)}
          style={{ fontSize: '0.85rem' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '220px', overflowY: 'auto' }}>
          {disciplineVisibili.map((d) => (
            <label key={d.codice} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
              <input
                type="checkbox"
                checked={disciplineSelezionate.includes(d.codice)}
                onChange={() => toggleDisciplina(d.codice)}
              />
              <strong>{d.codice}</strong> — {d.denominazione}
            </label>
          ))}
        </div>
      </div>

      {errore && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem' }}>
          {errore}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button type="submit" className="btn btn-primary" disabled={inCorso}>
          {inCorso ? 'Salvataggio...' : 'Salva'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onAnnulla}>
          Annulla
        </button>
      </div>
    </form>
  );
}
