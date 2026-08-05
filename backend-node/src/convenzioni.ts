import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';

export interface Convenzione {
  id: string;
  assegnazioneId: string;
  istituzioneScolasticaId: string;
  stato: 'in_attesa' | 'perfezionata';
  confermataIl: string | null;
  confermataDaUtenteBackofficeId: string | null;
  confermataDaPersonaFisicaId: string | null;
}

interface RigaConvenzione {
  id: string;
  assegnazione_id: string;
  istituzione_scolastica_id: string;
  stato: 'in_attesa' | 'perfezionata';
  confermata_il: Date | null;
  confermata_da_utente_backoffice_id: string | null;
  confermata_da_persona_fisica_id: string | null;
}

const COLONNE_SELECT = `id, assegnazione_id, istituzione_scolastica_id, stato, confermata_il,
  confermata_da_utente_backoffice_id, confermata_da_persona_fisica_id`;

function daRiga(r: RigaConvenzione): Convenzione {
  return {
    id: r.id,
    assegnazioneId: r.assegnazione_id,
    istituzioneScolasticaId: r.istituzione_scolastica_id,
    stato: r.stato,
    confermataIl: r.confermata_il ? r.confermata_il.toISOString() : null,
    confermataDaUtenteBackofficeId: r.confermata_da_utente_backoffice_id,
    confermataDaPersonaFisicaId: r.confermata_da_persona_fisica_id,
  };
}

// art. B.31: conferma sempre lato backoffice per conto dell'istituzione scolastica — le
// istituzioni non hanno accesso diretto alla piattaforma (iter delega manuale mai
// implementato, residuo noto). Guardia atomica dentro la WHERE, stesso pattern di
// ammettiDomanda/approvaAbilitazione.
export async function confermaConvenzione(db: Db, id: string, confermataDa: string): Promise<Convenzione> {
  const r = await db.query<RigaConvenzione>(
    `UPDATE convenzioni SET stato = 'perfezionata', confermata_il = now(), confermata_da_utente_backoffice_id = $2
     WHERE id = $1 AND stato = 'in_attesa'
     RETURNING ${COLONNE_SELECT}`,
    [id, confermataDa],
  );
  const riga = r.rows[0];
  if (riga) {
    return daRiga(riga);
  }
  const check = await db.query(`SELECT 1 FROM convenzioni WHERE id = $1`, [id]);
  if ((check.rowCount ?? 0) === 0) {
    throw new ErroreNonTrovato('convenzione non trovata');
  }
  throw new ErroreStatoNonValidoPerTransizione('la convenzione è già perfezionata');
}

const COLONNE_SELECT_C = `c.id, c.assegnazione_id, c.istituzione_scolastica_id, c.stato, c.confermata_il,
  c.confermata_da_utente_backoffice_id, c.confermata_da_persona_fisica_id`;

export async function listaConvenzioniPerStagione(db: Db, stagioneId: string, stato?: 'in_attesa' | 'perfezionata'): Promise<Convenzione[]> {
  const r = stato
    ? await db.query<RigaConvenzione>(
        `SELECT ${COLONNE_SELECT_C}
         FROM convenzioni c
         JOIN assegnazioni a ON a.id = c.assegnazione_id
         JOIN slot_settimana_tipo st ON st.id = a.slot_id
         WHERE st.stagione_id = $1 AND c.stato = $2
         ORDER BY st.giorno_settimana, st.orario_inizio`,
        [stagioneId, stato],
      )
    : await db.query<RigaConvenzione>(
        `SELECT ${COLONNE_SELECT_C}
         FROM convenzioni c
         JOIN assegnazioni a ON a.id = c.assegnazione_id
         JOIN slot_settimana_tipo st ON st.id = a.slot_id
         WHERE st.stagione_id = $1
         ORDER BY st.giorno_settimana, st.orario_inizio`,
        [stagioneId],
      );
  return r.rows.map(daRiga);
}
