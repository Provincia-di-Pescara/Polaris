import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione } from './erroriDominio.ts';
import type { StatoDomanda } from './domande.ts';

export interface Osservazione {
  id: string;
  domandaId: string;
  presentataDaPersonaFisicaId: string;
  testo: string;
  presentataIl: string;
  stato: 'in_esame' | 'accolta' | 'respinta';
  decisioneMotivazione: string | null;
  decisaIl: string | null;
  decisaDa: string | null;
}

// Ritorno esteso delle funzioni di transizione: oltre all'osservazione, segnala se la
// domanda collegata è EFFETTIVAMENTE transitata di stato in questa chiamata (non solo se
// lo stato attuale coincide con quello atteso) — serve a server.ts (I6) per decidere se
// scrivere un secondo registraOperazione contro l'entità 'domande', solo quando la
// transizione avviene davvero.
export interface EsitoTransizioneOsservazione extends Osservazione {
  domandaTransitata: boolean;
  nuovoStatoDomanda: StatoDomanda | null;
}

interface RigaOsservazione {
  id: string;
  domanda_id: string;
  presentata_da_persona_fisica_id: string;
  testo: string;
  presentata_il: Date;
  stato: 'in_esame' | 'accolta' | 'respinta';
  decisione_motivazione: string | null;
  decisa_il: Date | null;
  decisa_da: string | null;
}

const COLONNE_SELECT_OSSERVAZIONE = `id, domanda_id, presentata_da_persona_fisica_id, testo,
  presentata_il, stato, decisione_motivazione, decisa_il, decisa_da`;

function daRiga(r: RigaOsservazione): Osservazione {
  return {
    id: r.id,
    domandaId: r.domanda_id,
    presentataDaPersonaFisicaId: r.presentata_da_persona_fisica_id,
    testo: r.testo,
    presentataIl: r.presentata_il.toISOString(),
    stato: r.stato,
    decisioneMotivazione: r.decisione_motivazione,
    decisaIl: r.decisa_il ? r.decisa_il.toISOString() : null,
    decisaDa: r.decisa_da,
  };
}

// Un'osservazione ha senso solo dopo che la domanda ha un esito pubblicato (art. B.10/B.11):
// 'presentata' (istruttoria non ancora fatta) e 'riesame_deciso' (osservazione già decisa,
// il ciclo si chiude) restano fuori.
const STATI_DOMANDA_OSSERVABILI: StatoDomanda[] = ['ammessa', 'esclusa', 'riesame_richiesto'];

// Lock del ciclo di vita del riesame di UNA domanda (I4): presentare/decidere osservazioni
// per la stessa domanda si serializza su questo lock, auto-rilasciato a COMMIT/ROLLBACK
// (nessun unlock esplicito), stesso pattern di CHIAVE_LOCK_ULTIMO_ADMIN in
// repository/utentiBackoffice.ts. Senza questo lock, due decisioni concorrenti su
// osservazioni diverse della stessa domanda possono entrambe vedere l'altra come ancora
// 'in_esame' sotto READ COMMITTED (nessuna delle due ha ancora committato) e nessuna
// consolida: la domanda resta bloccata per sempre in 'riesame_richiesto'.
async function lockDomanda(db: Db, domandaId: string): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [domandaId]);
}

async function idDomandaPerOsservazione(db: Db, osservazioneId: string): Promise<string> {
  const r = await db.query<{ domanda_id: string }>(
    `SELECT domanda_id FROM osservazioni_istruttoria WHERE id = $1`,
    [osservazioneId],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('osservazione non trovata');
  }
  return riga.domanda_id;
}

export async function presentaOsservazione(
  db: Db,
  dati: { domandaId: string; personaFisicaId: string; testo: string },
): Promise<EsitoTransizioneOsservazione> {
  await lockDomanda(db, dati.domandaId);
  const check = await db.query<{ stato: StatoDomanda }>(`SELECT stato FROM domande WHERE id = $1`, [dati.domandaId]);
  const domanda = check.rows[0];
  if (!domanda) {
    throw new ErroreNonTrovato('domanda non trovata');
  }
  if (!STATI_DOMANDA_OSSERVABILI.includes(domanda.stato)) {
    throw new ErroreStatoNonValidoPerTransizione('la domanda non ha ancora un esito pubblicato');
  }
  const r = await db.query<RigaOsservazione>(
    `INSERT INTO osservazioni_istruttoria (domanda_id, presentata_da_persona_fisica_id, testo)
     VALUES ($1, $2, $3)
     RETURNING ${COLONNE_SELECT_OSSERVAZIONE}`,
    [dati.domandaId, dati.personaFisicaId, dati.testo],
  );
  const domandaTransitata = domanda.stato !== 'riesame_richiesto';
  if (domandaTransitata) {
    await db.query(`UPDATE domande SET stato = 'riesame_richiesto' WHERE id = $1`, [dati.domandaId]);
  }
  return {
    ...daRiga(r.rows[0]!),
    domandaTransitata,
    nuovoStatoDomanda: domandaTransitata ? 'riesame_richiesto' : null,
  };
}

export async function trovaOsservazionePerId(db: Db, id: string): Promise<Osservazione | null> {
  const r = await db.query<RigaOsservazione>(`SELECT ${COLONNE_SELECT_OSSERVAZIONE} FROM osservazioni_istruttoria WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

// Se non restano più osservazioni 'in_esame' per la domanda, il riesame è completo:
// la domanda passa da 'riesame_richiesto' a 'riesame_deciso' (art. B.11). Ritorna true se
// la transizione è avvenuta davvero in questa chiamata (I6). Va sempre chiamata con il
// lock di lockDomanda già acquisito dal chiamante nella stessa transazione (I4).
async function consolidaSeCompletata(db: Db, domandaId: string): Promise<boolean> {
  const rimaste = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM osservazioni_istruttoria WHERE domanda_id = $1 AND stato = 'in_esame'`,
    [domandaId],
  );
  if (rimaste.rows[0]?.count === '0') {
    const r = await db.query(`UPDATE domande SET stato = 'riesame_deciso' WHERE id = $1 AND stato = 'riesame_richiesto' RETURNING id`, [domandaId]);
    return (r.rowCount ?? 0) > 0;
  }
  return false;
}

// Transizione dello stato dell'osservazione con guardia atomica dentro la WHERE
// dell'UPDATE (I3, stesso pattern di abilitazioni.ts::approvaAbilitazione e di
// domande.ts::ammettiDomanda/escludiDomanda): niente TOCTOU tra un SELECT di controllo e
// l'UPDATE. Se rowCount è 0, un SELECT separato distingue 404 da 409.
async function transizionaOsservazione(
  db: Db,
  id: string,
  decisaDa: string,
  nuovoStato: 'accolta' | 'respinta',
  motivazione: string | null,
): Promise<EsitoTransizioneOsservazione> {
  const domandaId = await idDomandaPerOsservazione(db, id);
  await lockDomanda(db, domandaId);
  const r = await db.query<{ id: string }>(
    `UPDATE osservazioni_istruttoria SET stato = $2, decisa_il = now(), decisa_da = $3, decisione_motivazione = $4
     WHERE id = $1 AND stato = 'in_esame' RETURNING id`,
    [id, nuovoStato, decisaDa, motivazione],
  );
  if (r.rowCount === 0) {
    const check = await db.query(`SELECT 1 FROM osservazioni_istruttoria WHERE id = $1`, [id]);
    if (check.rowCount === 0) {
      throw new ErroreNonTrovato('osservazione non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('osservazione non in esame');
  }
  const domandaTransitata = await consolidaSeCompletata(db, domandaId);
  const osservazione = (await trovaOsservazionePerId(db, id))!;
  return {
    ...osservazione,
    domandaTransitata,
    nuovoStatoDomanda: domandaTransitata ? 'riesame_deciso' : null,
  };
}

export async function accogliOsservazione(db: Db, id: string, decisaDa: string): Promise<EsitoTransizioneOsservazione> {
  return transizionaOsservazione(db, id, decisaDa, 'accolta', null);
}

export async function respingiOsservazione(
  db: Db,
  id: string,
  decisaDa: string,
  motivazione: string,
): Promise<EsitoTransizioneOsservazione> {
  return transizionaOsservazione(db, id, decisaDa, 'respinta', motivazione);
}
