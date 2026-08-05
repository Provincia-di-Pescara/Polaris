import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

// art. B.30: approva il quadro definitivo. Nessuna precondizione oltre lo stato — la
// riassegnazione residua (art. B.29) è un'azione discrezionale separata, non un
// prerequisito rigido (l'admin può approvare anche senza rieseguirla se non restano
// fasce libere da assegnare).
export async function approvaSettimanaTipoDefinitiva(db: Db, stagioneId: string): Promise<{ convenzioniCreate: number }> {
  const r = await db.query(
    `UPDATE stagioni_sportive SET stato = 'definitiva' WHERE id = $1 AND stato = 'concertazione' RETURNING id`,
    [stagioneId],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('stagione non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la stagione non è in fase di concertazione');
  }

  // art. B.31: l'efficacia di ciascuna assegnazione presso una palestra scolastica è
  // subordinata al perfezionamento della convenzione — una riga 'in_attesa' per ogni
  // assegnazione attiva che non ne ha già una (copre singola/blocco_allenamento/
  // blocco_gara, B.31 non distingue per tipo). NOT EXISTS la rende idempotente: una
  // riapprovazione non duplica le convenzioni già create.
  const convenzioni = await db.query(
    `INSERT INTO convenzioni (assegnazione_id, istituzione_scolastica_id)
     SELECT a.id, i.istituzione_scolastica_id
     FROM assegnazioni a
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = st.spazio_id
     JOIN impianti i ON i.id = sp.impianto_id
     WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
       AND NOT EXISTS (SELECT 1 FROM convenzioni c WHERE c.assegnazione_id = a.id)
     RETURNING id`,
    [stagioneId],
  );
  return { convenzioniCreate: convenzioni.rowCount ?? 0 };
}
