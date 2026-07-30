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

export interface DocumentoAssociazione {
  id: string;
  associazioneId: string;
  tipo: string;
  filePath: string;
  caricatoIl: string;
}

interface RigaDocumento {
  id: string;
  associazione_id: string;
  tipo: string;
  file_path: string;
  caricato_il: string;
}

function daRigaDocumento(r: RigaDocumento): DocumentoAssociazione {
  return { id: r.id, associazioneId: r.associazione_id, tipo: r.tipo, filePath: r.file_path, caricatoIl: r.caricato_il };
}

export async function creaDocumentoAssociazione(
  db: Db,
  dati: { associazioneId: string; tipo: string; filePath: string },
): Promise<DocumentoAssociazione> {
  const r = await db.query<RigaDocumento>(
    `INSERT INTO associazioni_documenti (associazione_id, tipo, file_path)
     VALUES ($1, $2, $3)
     RETURNING id, associazione_id, tipo, file_path, caricato_il`,
    [dati.associazioneId, dati.tipo, dati.filePath],
  );
  return daRigaDocumento(r.rows[0]!);
}
