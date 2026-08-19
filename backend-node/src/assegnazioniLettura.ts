import type { Db } from './db.ts';

export interface AssegnazioneLettura {
  id: string;
  tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
  stato: 'provvisoria' | 'validata' | 'decaduta' | 'sostituita';
  valoreMinuti: string;
  impiantoDenominazione: string;
  spazioDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
  durataMinuti: number;
  pregiata: boolean;
}

export async function listaAssegnazioniPerAssociazione(
  db: Db,
  associazioneId: string,
  stagioneId: string,
): Promise<AssegnazioneLettura[]> {
  const r = await db.query<{
    id: string;
    tipo: 'singola' | 'blocco_gara' | 'blocco_allenamento';
    stato: 'provvisoria' | 'validata' | 'decaduta' | 'sostituita';
    valore_minuti: string;
    impianto_denominazione: string;
    spazio_denominazione: string;
    giorno_settimana: number;
    orario_inizio: string;
    orario_fine: string;
    durata_minuti: number;
    pregiata: boolean;
  }>(
    `SELECT a.id, a.tipo, a.stato, a.valore_minuti::text,
            i.denominazione AS impianto_denominazione, sp.denominazione AS spazio_denominazione,
            s.giorno_settimana, to_char(s.orario_inizio, 'HH24:MI') AS orario_inizio,
            to_char(s.orario_fine, 'HH24:MI') AS orario_fine, s.durata_minuti, s.pregiata
     FROM assegnazioni a
     JOIN slot_settimana_tipo s ON s.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = s.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     WHERE a.associazione_id = $1 AND s.stagione_id = $2 AND a.stato IN ('provvisoria', 'validata')
     ORDER BY s.giorno_settimana, s.orario_inizio`,
    [associazioneId, stagioneId],
  );
  return r.rows.map((riga) => ({
    id: riga.id,
    tipo: riga.tipo,
    stato: riga.stato,
    valoreMinuti: riga.valore_minuti,
    impiantoDenominazione: riga.impianto_denominazione,
    spazioDenominazione: riga.spazio_denominazione,
    giornoSettimana: riga.giorno_settimana,
    orarioInizio: riga.orario_inizio,
    orarioFine: riga.orario_fine,
    durataMinuti: riga.durata_minuti,
    pregiata: riga.pregiata,
  }));
}
