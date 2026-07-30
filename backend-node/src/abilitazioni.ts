import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';

export interface Abilitazione {
  id: string;
  personaFisicaId: string;
  associazioneId: string | null;
  istituzioneScolasticaId: string | null;
  stagioneId: string;
  titolo: 'legale_rappresentante' | 'delegato';
  ruolo: 'rappresentante' | 'operatore';
  stato: 'in_attesa' | 'approvata' | 'respinta' | 'revocata';
  motivazione: string | null;
  creataDaAbilitazioneId: string | null;
}

interface RigaAbilitazione {
  id: string;
  persona_fisica_id: string;
  associazione_id: string | null;
  istituzione_scolastica_id: string | null;
  stagione_id: string;
  titolo: 'legale_rappresentante' | 'delegato';
  ruolo: 'rappresentante' | 'operatore';
  stato: 'in_attesa' | 'approvata' | 'respinta' | 'revocata';
  motivazione: string | null;
  creata_da_abilitazione_id: string | null;
}

function daRiga(r: RigaAbilitazione): Abilitazione {
  return {
    id: r.id,
    personaFisicaId: r.persona_fisica_id,
    associazioneId: r.associazione_id,
    istituzioneScolasticaId: r.istituzione_scolastica_id,
    stagioneId: r.stagione_id,
    titolo: r.titolo,
    ruolo: r.ruolo,
    stato: r.stato,
    motivazione: r.motivazione,
    creataDaAbilitazioneId: r.creata_da_abilitazione_id,
  };
}

const COLONNE_SELECT = `id, persona_fisica_id, associazione_id, istituzione_scolastica_id, stagione_id,
  titolo, ruolo, stato, motivazione, creata_da_abilitazione_id`;

export async function creaAbilitazionePrincipale(
  db: Db,
  dati: { personaFisicaId: string; associazioneId: string; stagioneId: string },
): Promise<Abilitazione> {
  const r = await db.query<RigaAbilitazione>(
    `INSERT INTO abilitazioni (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato)
     VALUES ($1, $2, $3, 'legale_rappresentante', 'rappresentante', 'in_attesa')
     RETURNING ${COLONNE_SELECT}`,
    [dati.personaFisicaId, dati.associazioneId, dati.stagioneId],
  );
  return daRiga(r.rows[0]!);
}

export async function trovaAbilitazioneAttiva(
  db: Db,
  personaFisicaId: string,
  associazioneId: string,
  stagioneId: string,
): Promise<Abilitazione | null> {
  const r = await db.query<RigaAbilitazione>(
    `SELECT ${COLONNE_SELECT} FROM abilitazioni
     WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stagione_id = $3 AND stato = 'approvata'`,
    [personaFisicaId, associazioneId, stagioneId],
  );
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function creaSubDelega(
  db: Db,
  dati: {
    personaFisicaId: string;
    associazioneId: string;
    stagioneId: string;
    ruolo: 'rappresentante' | 'operatore';
    creataDaAbilitazioneId: string;
  },
): Promise<Abilitazione> {
  try {
    const r = await db.query<RigaAbilitazione>(
      `INSERT INTO abilitazioni
         (persona_fisica_id, associazione_id, stagione_id, titolo, ruolo, stato, decisa_il, creata_da_abilitazione_id)
       VALUES ($1, $2, $3, 'delegato', $4, 'approvata', now(), $5)
       RETURNING ${COLONNE_SELECT}`,
      [dati.personaFisicaId, dati.associazioneId, dati.stagioneId, dati.ruolo, dati.creataDaAbilitazioneId],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('la persona ha già un\'abilitazione attiva su questa associazione per questa stagione');
    }
    throw err;
  }
}

export async function trovaAbilitazionePerId(db: Db, id: string): Promise<Abilitazione | null> {
  const r = await db.query<RigaAbilitazione>(`SELECT ${COLONNE_SELECT} FROM abilitazioni WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}

export async function approvaAbilitazione(db: Db, id: string, decisaDa: string): Promise<Abilitazione> {
  const r = await db.query<RigaAbilitazione>(
    `UPDATE abilitazioni SET stato = 'approvata', decisa_il = now(), decisa_da = $2
     WHERE id = $1 AND creata_da_abilitazione_id IS NULL AND stato = 'in_attesa'
     RETURNING ${COLONNE_SELECT}`,
    [id, decisaDa],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('abilitazione non trovata o non in attesa di approvazione');
  }
  return daRiga(riga);
}

export async function respingiAbilitazione(
  db: Db,
  id: string,
  decisaDa: string,
  motivazione: string,
): Promise<Abilitazione> {
  const r = await db.query<RigaAbilitazione>(
    `UPDATE abilitazioni SET stato = 'respinta', decisa_il = now(), decisa_da = $2, motivazione = $3
     WHERE id = $1 AND creata_da_abilitazione_id IS NULL AND stato = 'in_attesa'
     RETURNING ${COLONNE_SELECT}`,
    [id, decisaDa, motivazione],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreNonTrovato('abilitazione non trovata o non in attesa di approvazione');
  }
  return daRiga(riga);
}

export async function revocaAbilitazioneConCascata(db: Db, id: string): Promise<Abilitazione[]> {
  const esiste = await db.query('SELECT 1 FROM abilitazioni WHERE id = $1', [id]);
  if (esiste.rows.length === 0) {
    throw new ErroreNonTrovato('abilitazione non trovata');
  }
  const r = await db.query<RigaAbilitazione>(
    `WITH RECURSIVE catena AS (
       SELECT id FROM abilitazioni WHERE id = $1
       UNION ALL
       SELECT a.id FROM abilitazioni a JOIN catena c ON a.creata_da_abilitazione_id = c.id
     )
     UPDATE abilitazioni SET stato = 'revocata', revocata_il = now()
     WHERE id IN (SELECT id FROM catena) AND stato IN ('in_attesa', 'approvata')
     RETURNING ${COLONNE_SELECT}`,
    [id],
  );
  return r.rows.map(daRiga);
}
