import type { Db } from './db.ts';

export interface SorteggioSintetico {
  id: string;
  elaborazioneId: string | null;
  articoloRiferimento: string;
  contesto: string;
  semeHex: string;
  semeGeneratoIl: string;
  vincitoreAssociazioneId: string;
}

export interface CandidatoSorteggio {
  associazioneId: string;
  ordineCanonico: number;
  hmacHex: string;
  rank: number;
}

export interface SorteggioDettaglio extends SorteggioSintetico {
  algoritmo: string;
  algoritmoVersione: string;
  hashVerbale: string;
  candidati: CandidatoSorteggio[];
}

interface RigaSorteggioSintetico {
  id: string;
  elaborazione_id: string | null;
  articolo_riferimento: string;
  contesto: string;
  seme_hex: string;
  seme_generato_il: Date;
  vincitore_associazione_id: string;
}

interface RigaSorteggioCompleto extends RigaSorteggioSintetico {
  algoritmo: string;
  algoritmo_versione: string;
  hash_verbale: string;
}

interface RigaCandidato {
  associazione_id: string;
  ordine_canonico: number;
  hmac_hex: string;
  rank: number;
}

const COLONNE_SINTETICO = `id, elaborazione_id, articolo_riferimento, contesto, seme_hex, seme_generato_il, vincitore_associazione_id`;

function daRigaSintetica(r: RigaSorteggioSintetico): SorteggioSintetico {
  return {
    id: r.id,
    elaborazioneId: r.elaborazione_id,
    articoloRiferimento: r.articolo_riferimento,
    contesto: r.contesto,
    semeHex: r.seme_hex,
    semeGeneratoIl: r.seme_generato_il.toISOString(),
    vincitoreAssociazioneId: r.vincitore_associazione_id,
  };
}

export async function listaSorteggiPerStagione(db: Db, stagioneId: string): Promise<SorteggioSintetico[]> {
  const r = await db.query<RigaSorteggioSintetico>(
    `SELECT s.${COLONNE_SINTETICO.split(', ').join(', s.')}
     FROM sorteggi s
     JOIN elaborazioni e ON e.id = s.elaborazione_id
     WHERE e.stagione_id = $1
     ORDER BY s.seme_generato_il DESC`,
    [stagioneId],
  );
  return r.rows.map(daRigaSintetica);
}

export async function trovaSorteggioConCandidati(db: Db, id: string): Promise<SorteggioDettaglio | null> {
  const r = await db.query<RigaSorteggioCompleto>(
    `SELECT ${COLONNE_SINTETICO}, algoritmo, algoritmo_versione, hash_verbale FROM sorteggi WHERE id = $1`,
    [id],
  );
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  const c = await db.query<RigaCandidato>(
    `SELECT associazione_id, ordine_canonico, hmac_hex, rank FROM sorteggio_candidati WHERE sorteggio_id = $1 ORDER BY rank`,
    [id],
  );
  return {
    ...daRigaSintetica(riga),
    algoritmo: riga.algoritmo,
    algoritmoVersione: riga.algoritmo_versione,
    hashVerbale: riga.hash_verbale,
    candidati: c.rows.map((cr) => ({
      associazioneId: cr.associazione_id,
      ordineCanonico: cr.ordine_canonico,
      hmacHex: cr.hmac_hex,
      rank: cr.rank,
    })),
  };
}
