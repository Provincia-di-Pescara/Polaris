import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

export interface Associazione {
  id: string;
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione: string | null;
  dataCostituzione: string | null;
}

interface RigaAssociazione {
  id: string;
  denominazione: string;
  codice_fiscale_partita_iva: string;
  rna_numero_iscrizione: string | null;
  data_costituzione: string | null;
}

function daRiga(r: RigaAssociazione): Associazione {
  return {
    id: r.id,
    denominazione: r.denominazione,
    codiceFiscalePartitaIva: r.codice_fiscale_partita_iva,
    rnaNumeroIscrizione: r.rna_numero_iscrizione,
    dataCostituzione: r.data_costituzione,
  };
}

const COLONNE_SELECT = 'id, denominazione, codice_fiscale_partita_iva, rna_numero_iscrizione, data_costituzione';

export interface DatiCreaAssociazione {
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione?: string | undefined;
  dataCostituzione?: string | undefined;
}

export async function creaAssociazione(db: Db, dati: DatiCreaAssociazione): Promise<Associazione> {
  try {
    const r = await db.query<RigaAssociazione>(
      `INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva, rna_numero_iscrizione, data_costituzione)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLONNE_SELECT}`,
      [dati.denominazione, dati.codiceFiscalePartitaIva, dati.rnaNumeroIscrizione ?? null, dati.dataCostituzione ?? null],
    );
    return daRiga(r.rows[0]!);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new ErroreValoreDuplicato('associazione già accreditata con questo codice fiscale/partita IVA');
    }
    throw err;
  }
}

export async function trovaAssociazionePerId(db: Db, id: string): Promise<Associazione | null> {
  const r = await db.query<RigaAssociazione>(`SELECT ${COLONNE_SELECT} FROM associazioni WHERE id = $1`, [id]);
  return r.rows[0] ? daRiga(r.rows[0]) : null;
}
