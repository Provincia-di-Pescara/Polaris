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

export async function presentaOsservazione(
  db: Db,
  dati: { domandaId: string; personaFisicaId: string; testo: string },
): Promise<Osservazione> {
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
  if (domanda.stato !== 'riesame_richiesto') {
    await db.query(`UPDATE domande SET stato = 'riesame_richiesto' WHERE id = $1`, [dati.domandaId]);
  }
  return daRiga(r.rows[0]!);
}

export async function trovaOsservazionePerId(db: Db, id: string): Promise<Osservazione | null> {
  const r = await db.query<RigaOsservazione>(`SELECT ${COLONNE_SELECT_OSSERVAZIONE} FROM osservazioni_istruttoria WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

// Se non restano più osservazioni 'in_esame' per la domanda, il riesame è completo:
// la domanda passa da 'riesame_richiesto' a 'riesame_deciso' (art. B.11).
async function consolidaSeCompletata(db: Db, domandaId: string): Promise<void> {
  const rimaste = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM osservazioni_istruttoria WHERE domanda_id = $1 AND stato = 'in_esame'`,
    [domandaId],
  );
  if (rimaste.rows[0]?.count === '0') {
    await db.query(`UPDATE domande SET stato = 'riesame_deciso' WHERE id = $1 AND stato = 'riesame_richiesto'`, [domandaId]);
  }
}

export async function accogliOsservazione(db: Db, id: string, decisaDa: string): Promise<Osservazione> {
  const check = await db.query<{ stato: string; domanda_id: string }>(
    `SELECT stato, domanda_id FROM osservazioni_istruttoria WHERE id = $1`,
    [id],
  );
  const riga = check.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('osservazione non trovata');
  }
  if (riga.stato !== 'in_esame') {
    throw new ErroreStatoNonValidoPerTransizione('osservazione non in esame');
  }
  await db.query(
    `UPDATE osservazioni_istruttoria SET stato = 'accolta', decisa_il = now(), decisa_da = $2 WHERE id = $1`,
    [id, decisaDa],
  );
  await consolidaSeCompletata(db, riga.domanda_id);
  return (await trovaOsservazionePerId(db, id))!;
}

export async function respingiOsservazione(db: Db, id: string, decisaDa: string, motivazione: string): Promise<Osservazione> {
  const check = await db.query<{ stato: string; domanda_id: string }>(
    `SELECT stato, domanda_id FROM osservazioni_istruttoria WHERE id = $1`,
    [id],
  );
  const riga = check.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('osservazione non trovata');
  }
  if (riga.stato !== 'in_esame') {
    throw new ErroreStatoNonValidoPerTransizione('osservazione non in esame');
  }
  await db.query(
    `UPDATE osservazioni_istruttoria SET stato = 'respinta', decisa_il = now(), decisa_da = $2, decisione_motivazione = $3 WHERE id = $1`,
    [id, decisaDa, motivazione],
  );
  await consolidaSeCompletata(db, riga.domanda_id);
  return (await trovaOsservazionePerId(db, id))!;
}
