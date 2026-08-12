import React, { useState } from 'react';
import { creaVersione, type VersioneParametrica, type DatiCreaVersione, type ScaglioneCsd, ErroreRichiestaApi } from '../../api/parametrico.ts';

interface VersioneParametricaFormProps {
  versioneAttuale: VersioneParametrica;
  onSalvata: (v: VersioneParametrica) => void;
  onAnnulla: () => void;
}

const REGEX_DECIMALE = /^\d{1,3}(\.\d{1,3})?$/;
const REGEX_DECIMALE_ESTESO = /^\d{1,7}(\.\d{1,3})?$/;
const REGEX_RAPPORTO_01 = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/;

function campoLabelStyle(): React.CSSProperties {
  return { fontSize: '0.85rem', fontWeight: 600, color: 'var(--pa-text-primary)' };
}

export function VersioneParametricaForm({ versioneAttuale, onSalvata, onAnnulla }: VersioneParametricaFormProps): React.ReactElement {
  const [dati, setDati] = useState<DatiCreaVersione>({
    note: versioneAttuale.note ?? undefined,
    moltiplicatoreMinutiPerPunto: versioneAttuale.moltiplicatoreMinutiPerPunto,
    pesoFasciaPregiata: versioneAttuale.pesoFasciaPregiata,
    minutiSettimanaliMax: versioneAttuale.minutiSettimanaliMax,
    slotMaxStessoImpianto: versioneAttuale.slotMaxStessoImpianto,
    fascePregiateMax: versioneAttuale.fascePregiateMax,
    giornateGaraMax: versioneAttuale.giornateGaraMax,
    incrementoSquadreNeutro: versioneAttuale.incrementoSquadreNeutro,
    caaNeutro: versioneAttuale.caaNeutro,
    csdNeutro: versioneAttuale.csdNeutro,
    tolleranzaIsfPct: versioneAttuale.tolleranzaIsfPct,
    sogliaMancatiUtilizziDiffida: versioneAttuale.sogliaMancatiUtilizziDiffida,
    sogliaMancatiUtilizziDecadenza: versioneAttuale.sogliaMancatiUtilizziDecadenza,
    sogliaScostamentoDichiaratoPct: versioneAttuale.sogliaScostamentoDichiaratoPct,
    sogliaIsfCompensazione: versioneAttuale.sogliaIsfCompensazione,
    retentionLogOperazioniGiorni: versioneAttuale.retentionLogOperazioniGiorni,
    quotaNuoveAssociazioniPct: versioneAttuale.quotaNuoveAssociazioniPct,
    termineGiustificazioneGiorni: versioneAttuale.termineGiustificazioneGiorni,
    csdScaglioni: versioneAttuale.csdScaglioni,
  });
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const campoTesto = (
    chiave: keyof DatiCreaVersione,
    etichetta: string,
    regex: RegExp,
    id: string,
  ): React.ReactElement => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <label htmlFor={id} style={campoLabelStyle()}>{etichetta}</label>
      <input
        id={id}
        className="form-control"
        value={String(dati[chiave])}
        onChange={(e) => setDati((prev) => ({ ...prev, [chiave]: e.target.value }))}
        pattern={regex.source}
        required
      />
    </div>
  );

  const campoNumero = (chiave: keyof DatiCreaVersione, etichetta: string, id: string): React.ReactElement => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <label htmlFor={id} style={campoLabelStyle()}>{etichetta}</label>
      <input
        id={id}
        type="number"
        className="form-control"
        value={dati[chiave] as number}
        onChange={(e) => setDati((prev) => ({ ...prev, [chiave]: Number(e.target.value) }))}
        required
      />
    </div>
  );

  const aggiornaScaglione = (indice: number, campo: keyof ScaglioneCsd, valore: string): void => {
    setDati((prev) => ({
      ...prev,
      csdScaglioni: prev.csdScaglioni.map((s, i) =>
        i === indice ? { ...s, [campo]: campo === 'rapportoFdFrMax' && valore === '' ? null : valore } : s,
      ),
    }));
  };

  const aggiungiScaglione = (): void => {
    setDati((prev) => ({ ...prev, csdScaglioni: [...prev.csdScaglioni, { rapportoFdFrMin: '', rapportoFdFrMax: null, coefficiente: '' }] }));
  };

  const rimuoviScaglione = (indice: number): void => {
    setDati((prev) => ({ ...prev, csdScaglioni: prev.csdScaglioni.filter((_, i) => i !== indice) }));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      const risultato = await creaVersione(dati);
      onSalvata(risultato);
    } catch (err) {
      setErrore(err instanceof ErroreRichiestaApi ? err.message : 'Errore imprevisto.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {campoTesto('moltiplicatoreMinutiPerPunto', 'Moltiplicatore Minuti / Peso (Art. A.5)', REGEX_DECIMALE_ESTESO, 'pv-moltiplicatore')}
        {campoTesto('pesoFasciaPregiata', 'Peso Ponderazione Fasce Pregiate (Art. A.9)', REGEX_DECIMALE, 'pv-peso-pregiate')}
        {campoTesto('minutiSettimanaliMax', 'Limite Minuti Settimanali (Art. B.19)', REGEX_DECIMALE_ESTESO, 'pv-minuti-max')}
        {campoNumero('slotMaxStessoImpianto', 'Limite Slot Stesso Impianto', 'pv-slot-max')}
        {campoNumero('fascePregiateMax', 'Limite Fasce Pregiate', 'pv-fasce-pregiate-max')}
        {campoNumero('giornateGaraMax', 'Limite Giornate Gara', 'pv-giornate-gara-max')}
        {campoNumero('incrementoSquadreNeutro', 'Incremento Squadre Neutro', 'pv-incremento-squadre')}
        {campoTesto('caaNeutro', 'CAA Neutro', REGEX_DECIMALE, 'pv-caa-neutro')}
        {campoTesto('csdNeutro', 'CSD Neutro', REGEX_DECIMALE, 'pv-csd-neutro')}
        {campoTesto('tolleranzaIsfPct', 'Tolleranza Parità ISF (Art. B.20)', REGEX_RAPPORTO_01, 'pv-tolleranza-isf')}
        {campoNumero('sogliaMancatiUtilizziDiffida', 'Soglia Diffida (mancati utilizzi)', 'pv-soglia-diffida')}
        {campoNumero('sogliaMancatiUtilizziDecadenza', 'Soglia Decadenza (mancati utilizzi)', 'pv-soglia-decadenza')}
        {campoTesto('sogliaScostamentoDichiaratoPct', 'Soglia Scostamento Dichiarato', REGEX_RAPPORTO_01, 'pv-soglia-scostamento')}
        {campoTesto('sogliaIsfCompensazione', 'Soglia ISF Compensazione', REGEX_RAPPORTO_01, 'pv-soglia-isf-compensazione')}
        {campoNumero('retentionLogOperazioniGiorni', 'Retention Log Operazioni (giorni)', 'pv-retention-log')}
        {campoTesto('quotaNuoveAssociazioniPct', 'Quota Nuove Associazioni (Art. 12)', REGEX_RAPPORTO_01, 'pv-quota-nuove')}
        {campoNumero('termineGiustificazioneGiorni', 'Termine Giustificazione (giorni)', 'pv-termine-giustificazione')}
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Scaglioni CSD (Art. A.11)</div>
        {dati.csdScaglioni.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <input
              aria-label={`rapporto minimo scaglione ${i + 1}`}
              className="form-control"
              value={s.rapportoFdFrMin}
              onChange={(e) => aggiornaScaglione(i, 'rapportoFdFrMin', e.target.value)}
            />
            <input
              aria-label={`rapporto massimo scaglione ${i + 1}`}
              className="form-control"
              value={s.rapportoFdFrMax ?? ''}
              placeholder="infinito"
              onChange={(e) => aggiornaScaglione(i, 'rapportoFdFrMax', e.target.value)}
            />
            <input
              aria-label={`coefficiente scaglione ${i + 1}`}
              className="form-control"
              value={s.coefficiente}
              onChange={(e) => aggiornaScaglione(i, 'coefficiente', e.target.value)}
            />
            <button type="button" aria-label={`rimuovi scaglione ${i + 1}`} className="btn btn-secondary btn-sm" onClick={() => rimuoviScaglione(i)}>
              Rimuovi
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={aggiungiScaglione}>
          Aggiungi scaglione
        </button>
      </div>

      {errore && (
        <div style={{ backgroundColor: 'var(--pa-danger-bg)', color: 'var(--pa-danger)', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
          {errore}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button type="submit" className="btn btn-success" disabled={inCorso}>
          {inCorso ? 'Salvataggio...' : 'Salva e Pubblica'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onAnnulla}>
          Annulla
        </button>
      </div>
    </form>
  );
}
