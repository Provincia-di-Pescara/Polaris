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

// I3 (final review): la lista per stagione alimenta la coda di lavoro backoffice — senza
// queste colonne il frontend dovrebbe fare N+1 lookup per riga (associazione, istituzione,
// slot) per mostrare qualcosa di utilizzabile. `Convenzione` (sopra) resta l'interfaccia
// "base" usata anche da confermaConvenzione (che non ha bisogno dei dettagli arricchiti,
// singola riga già nota al chiamante) — questa è un supertype dedicato solo alla lista.
export interface ConvenzioneConDettagli extends Convenzione {
  associazioneId: string;
  associazioneDenominazione: string;
  istituzioneScolasticaDenominazione: string;
  giornoSettimana: number;
  orarioInizio: string;
  orarioFine: string;
}

interface RigaConvenzioneConDettagli extends RigaConvenzione {
  associazione_id: string;
  associazione_denominazione: string;
  istituzione_scolastica_denominazione: string;
  giorno_settimana: number;
  orario_inizio: string;
  orario_fine: string;
}

function daRigaConDettagli(r: RigaConvenzioneConDettagli): ConvenzioneConDettagli {
  return {
    ...daRiga(r),
    associazioneId: r.associazione_id,
    associazioneDenominazione: r.associazione_denominazione,
    istituzioneScolasticaDenominazione: r.istituzione_scolastica_denominazione,
    giornoSettimana: r.giorno_settimana,
    orarioInizio: r.orario_inizio,
    orarioFine: r.orario_fine,
  };
}

const COLONNE_SELECT_C = `c.id, c.assegnazione_id, c.istituzione_scolastica_id, c.stato, c.confermata_il,
  c.confermata_da_utente_backoffice_id, c.confermata_da_persona_fisica_id,
  a.associazione_id, ass.denominazione AS associazione_denominazione,
  ist.denominazione AS istituzione_scolastica_denominazione,
  st.giorno_settimana,
  to_char(st.orario_inizio, 'HH24:MI') AS orario_inizio,
  to_char(st.orario_fine, 'HH24:MI') AS orario_fine`;

const JOIN_DETTAGLI_C = `JOIN assegnazioni a ON a.id = c.assegnazione_id
         JOIN slot_settimana_tipo st ON st.id = a.slot_id
         JOIN associazioni ass ON ass.id = a.associazione_id
         JOIN istituzioni_scolastiche ist ON ist.id = c.istituzione_scolastica_id`;

export async function listaConvenzioniPerStagione(
  db: Db,
  stagioneId: string,
  stato?: 'in_attesa' | 'perfezionata',
): Promise<ConvenzioneConDettagli[]> {
  const r = stato
    ? await db.query<RigaConvenzioneConDettagli>(
        `SELECT ${COLONNE_SELECT_C}
         FROM convenzioni c
         ${JOIN_DETTAGLI_C}
         WHERE st.stagione_id = $1 AND c.stato = $2
         ORDER BY st.giorno_settimana, st.orario_inizio`,
        [stagioneId, stato],
      )
    : await db.query<RigaConvenzioneConDettagli>(
        `SELECT ${COLONNE_SELECT_C}
         FROM convenzioni c
         ${JOIN_DETTAGLI_C}
         WHERE st.stagione_id = $1
         ORDER BY st.giorno_settimana, st.orario_inizio`,
        [stagioneId],
      );
  return r.rows.map(daRigaConDettagli);
}
