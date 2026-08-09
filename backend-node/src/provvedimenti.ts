import type { Db } from './db.ts';
import { ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
import { leggiVersioneAttiva } from './repository/parametrico.ts';

export type TipoProvvedimento = 'richiesta_giustificazione' | 'diffida' | 'decadenza';

export interface Provvedimento {
  id: string;
  associazioneId: string;
  assegnazioneId: string;
  tipo: TipoProvvedimento;
  motivazione: string;
  emessoIl: string;
  emessoDa: string | null;
}

interface RigaProvvedimento {
  id: string;
  associazione_id: string;
  assegnazione_id: string;
  tipo: TipoProvvedimento;
  motivazione: string;
  emesso_il: Date;
  emesso_da: string | null;
}

const COLONNE_SELECT = `id, associazione_id, assegnazione_id, tipo, motivazione, emesso_il, emesso_da`;

function daRiga(r: RigaProvvedimento): Provvedimento {
  return {
    id: r.id,
    associazioneId: r.associazione_id,
    assegnazioneId: r.assegnazione_id,
    tipo: r.tipo,
    motivazione: r.motivazione,
    emessoIl: r.emesso_il.toISOString(),
    emessoDa: r.emesso_da,
  };
}

export interface DatiCreaProvvedimento {
  associazioneId: string;
  assegnazioneId: string;
  tipo: TipoProvvedimento;
  motivazione: string;
  emessoDa: string | null;
}

export async function creaProvvedimento(db: Db, dati: DatiCreaProvvedimento): Promise<Provvedimento> {
  const r = await db.query<RigaProvvedimento>(
    `INSERT INTO provvedimenti_mancato_utilizzo (associazione_id, assegnazione_id, tipo, motivazione, emesso_da)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLONNE_SELECT}`,
    [dati.associazioneId, dati.assegnazioneId, dati.tipo, dati.motivazione, dati.emessoDa],
  );
  return daRiga(r.rows[0]!);
}

export async function listaProvvedimentiPerAssegnazione(db: Db, assegnazioneId: string): Promise<Provvedimento[]> {
  const r = await db.query<RigaProvvedimento>(
    `SELECT ${COLONNE_SELECT} FROM provvedimenti_mancato_utilizzo WHERE assegnazione_id = $1 ORDER BY emesso_il DESC`,
    [assegnazioneId],
  );
  return r.rows.map(daRiga);
}

export interface VoceCodaMancatiUtilizzi {
  assegnazioneId: string;
  mancatiDefinitivi: number;
  sogliaDiffida: number;
  sogliaDecadenza: number;
  diffidaRaggiunta: boolean;
  decadenzaRaggiunta: boolean;
  diffidaGiaEmessa: boolean;
  decadenzaGiaEmessa: boolean;
}

interface RigaConteggio {
  assegnazione_id: string;
  mancati_definitivi: string;
}

// "Definitivo" ai fini del conteggio soglie B.35: la finestra è scaduta senza che
// l'associazione presentasse nulla, OPPURE la giustificazione presentata è stata
// esplicitamente rigettata (giustificazione_decisa_il valorizzato — un accoglimento
// sposta esito a 'non_utilizzato_giustificato' e la riga esce da questo filtro da sé).
// Le finestre ancora aperte non contano: l'associazione ha ancora la possibilità di
// giustificare, contarle già ora anticiperebbe l'escalation.
export async function codaMancatiUtilizzi(db: Db, associazioneId: string, stagioneId: string): Promise<VoceCodaMancatiUtilizzi[]> {
  const parametrico = await leggiVersioneAttiva(db);
  if (!parametrico) {
    throw new Error('nessuna versione parametrica attiva');
  }
  const conteggi = await db.query<RigaConteggio>(
    `SELECT a.id AS assegnazione_id, count(*) AS mancati_definitivi
     FROM utilizzi_effettivi ue
     JOIN assegnazioni a ON a.id = ue.assegnazione_id
     JOIN slot_settimana_tipo st ON st.id = a.slot_id
     WHERE a.associazione_id = $1 AND st.stagione_id = $2
       AND ue.esito = 'non_utilizzato_non_giustificato'
       AND ((ue.giustificazione_presentata_il IS NULL AND ue.giustificazione_scade_il < now())
            OR ue.giustificazione_decisa_il IS NOT NULL)
     GROUP BY a.id`,
    [associazioneId, stagioneId],
  );
  const esito: VoceCodaMancatiUtilizzi[] = [];
  for (const riga of conteggi.rows) {
    const mancati = Number(riga.mancati_definitivi);
    const provvedimenti = await db.query<{ tipo: TipoProvvedimento }>(
      `SELECT tipo FROM provvedimenti_mancato_utilizzo WHERE assegnazione_id = $1 AND tipo IN ('diffida', 'decadenza')`,
      [riga.assegnazione_id],
    );
    const tipiEmessi = new Set(provvedimenti.rows.map((p) => p.tipo));
    esito.push({
      assegnazioneId: riga.assegnazione_id,
      mancatiDefinitivi: mancati,
      sogliaDiffida: parametrico.sogliaMancatiUtilizziDiffida,
      sogliaDecadenza: parametrico.sogliaMancatiUtilizziDecadenza,
      diffidaRaggiunta: mancati >= parametrico.sogliaMancatiUtilizziDiffida,
      decadenzaRaggiunta: mancati >= parametrico.sogliaMancatiUtilizziDecadenza,
      diffidaGiaEmessa: tipiEmessi.has('diffida'),
      decadenzaGiaEmessa: tipiEmessi.has('decadenza'),
    });
  }
  return esito;
}

// art. B.35: "lo spazio torna a disposizione quale fascia libera" — un UPDATE guardato,
// mai su un'assegnazione già decaduta/sostituita. Lo slot liberato ridiventa visibile come
// libero a trovaProprietarioOccorrenza (variazioni.ts, blocco precedente) senza alcuna
// modifica a quel file: quella funzione legge assegnazioni WHERE stato IN
// ('provvisoria','validata'), quindi una riga 'decaduta' semplicemente non compare più.
export async function applicaDecadenza(db: Db, assegnazioneId: string, motivazione: string): Promise<void> {
  const r = await db.query(
    `UPDATE assegnazioni SET stato = 'decaduta', decaduta_il = now(), decaduta_motivazione = $2
     WHERE id = $1 AND stato IN ('provvisoria', 'validata')`,
    [assegnazioneId, motivazione],
  );
  if ((r.rowCount ?? 0) === 0) {
    throw new ErroreStatoNonValidoPerTransizione('assegnazione non più in uno stato decadibile');
  }
}
