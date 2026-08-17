import { DatabaseError } from 'pg';
import type { Db } from './db.ts';
import { ErroreValoreDuplicato } from './erroriDominio.ts';

export interface Associazione {
  id: string;
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione: string | null;
  dataCostituzione: string | null;
  rappresentanteLegaleNome: string | null;
  rappresentanteLegaleCognome: string | null;
  delegatoNome: string | null;
  delegatoCognome: string | null;
  indirizzoVia: string | null;
  indirizzoCivico: string | null;
  indirizzoCitta: string | null;
  pec: string | null;
  email: string | null;
  tipologiaSoggetto: string | null;
  iscrittaRasd: boolean;
  organismoSportivoCodice: string | null;
  codiceAffiliazione: string | null;
  haPersonaleAssunto: boolean;
}

interface RigaAssociazione {
  id: string;
  denominazione: string;
  codice_fiscale_partita_iva: string;
  rna_numero_iscrizione: string | null;
  data_costituzione: string | null;
  rappresentante_legale_nome: string | null;
  rappresentante_legale_cognome: string | null;
  delegato_nome: string | null;
  delegato_cognome: string | null;
  indirizzo_via: string | null;
  indirizzo_civico: string | null;
  indirizzo_citta: string | null;
  pec: string | null;
  email: string | null;
  tipologia_soggetto: string | null;
  iscritta_rasd: boolean;
  organismo_sportivo_codice: string | null;
  codice_affiliazione: string | null;
  ha_personale_assunto: boolean;
}

function daRiga(r: RigaAssociazione): Associazione {
  return {
    id: r.id,
    denominazione: r.denominazione,
    codiceFiscalePartitaIva: r.codice_fiscale_partita_iva,
    rnaNumeroIscrizione: r.rna_numero_iscrizione,
    dataCostituzione: r.data_costituzione,
    rappresentanteLegaleNome: r.rappresentante_legale_nome,
    rappresentanteLegaleCognome: r.rappresentante_legale_cognome,
    delegatoNome: r.delegato_nome,
    delegatoCognome: r.delegato_cognome,
    indirizzoVia: r.indirizzo_via,
    indirizzoCivico: r.indirizzo_civico,
    indirizzoCitta: r.indirizzo_citta,
    pec: r.pec,
    email: r.email,
    tipologiaSoggetto: r.tipologia_soggetto,
    iscrittaRasd: r.iscritta_rasd,
    organismoSportivoCodice: r.organismo_sportivo_codice,
    codiceAffiliazione: r.codice_affiliazione,
    haPersonaleAssunto: r.ha_personale_assunto,
  };
}

// data_costituzione::text: senza il cast pg restituisce un oggetto Date (colonna DATE),
// ma Associazione.dataCostituzione è tipizzata string — stesso pattern già in uso per
// tutte le colonne DATE del progetto (vedi variazioni.ts COLONNE_SELECT).
const COLONNE_SELECT = `id, denominazione, codice_fiscale_partita_iva, rna_numero_iscrizione, data_costituzione::text,
  rappresentante_legale_nome, rappresentante_legale_cognome, delegato_nome, delegato_cognome,
  indirizzo_via, indirizzo_civico, indirizzo_citta, pec, email, tipologia_soggetto,
  iscritta_rasd, organismo_sportivo_codice, codice_affiliazione, ha_personale_assunto`;

export interface DatiCreaAssociazione {
  denominazione: string;
  codiceFiscalePartitaIva: string;
  rnaNumeroIscrizione?: string | undefined;
  dataCostituzione?: string | undefined;
  rappresentanteLegaleNome: string;
  rappresentanteLegaleCognome: string;
  delegatoNome?: string | undefined;
  delegatoCognome?: string | undefined;
  indirizzoVia: string;
  indirizzoCivico: string;
  indirizzoCitta: string;
  pec?: string | undefined;
  email: string;
  tipologiaSoggetto: string;
  iscrittaRasd: boolean;
  organismoSportivoCodice?: string | undefined;
  codiceAffiliazione?: string | undefined;
  haPersonaleAssunto: boolean;
}

export async function creaAssociazione(db: Db, dati: DatiCreaAssociazione): Promise<Associazione> {
  try {
    const r = await db.query<RigaAssociazione>(
      `INSERT INTO associazioni (
         denominazione, codice_fiscale_partita_iva, rna_numero_iscrizione, data_costituzione,
         rappresentante_legale_nome, rappresentante_legale_cognome, delegato_nome, delegato_cognome,
         indirizzo_via, indirizzo_civico, indirizzo_citta, pec, email, tipologia_soggetto,
         iscritta_rasd, organismo_sportivo_codice, codice_affiliazione, ha_personale_assunto
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING ${COLONNE_SELECT}`,
      [
        dati.denominazione,
        dati.codiceFiscalePartitaIva,
        dati.rnaNumeroIscrizione ?? null,
        dati.dataCostituzione ?? null,
        dati.rappresentanteLegaleNome,
        dati.rappresentanteLegaleCognome,
        dati.delegatoNome ?? null,
        dati.delegatoCognome ?? null,
        dati.indirizzoVia,
        dati.indirizzoCivico,
        dati.indirizzoCitta,
        dati.pec ?? null,
        dati.email,
        dati.tipologiaSoggetto,
        dati.iscrittaRasd,
        dati.organismoSportivoCodice ?? null,
        dati.codiceAffiliazione ?? null,
        dati.haPersonaleAssunto,
      ],
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

export interface DocumentoAssociazioneMeta {
  id: string;
  associazioneId: string;
  tipo: string;
  caricatoIl: string;
}

export async function listaDocumentiPerAssociazione(db: Db, associazioneId: string): Promise<DocumentoAssociazioneMeta[]> {
  const r = await db.query<{ id: string; associazione_id: string; tipo: string; caricato_il: string }>(
    `SELECT id, associazione_id, tipo, caricato_il FROM associazioni_documenti WHERE associazione_id = $1 ORDER BY caricato_il DESC`,
    [associazioneId],
  );
  return r.rows.map((row) => ({ id: row.id, associazioneId: row.associazione_id, tipo: row.tipo, caricatoIl: row.caricato_il }));
}

export async function trovaDocumentoPerId(db: Db, id: string): Promise<DocumentoAssociazione | null> {
  const r = await db.query<RigaDocumento>(
    `SELECT id, associazione_id, tipo, file_path, caricato_il FROM associazioni_documenti WHERE id = $1`,
    [id],
  );
  return r.rows[0] ? daRigaDocumento(r.rows[0]) : null;
}

export interface ReferenteAssociazione {
  id: string;
  associazioneId: string;
  tipo: 'sicurezza' | 'emergenze_dae';
  nome: string;
  cognome: string;
  natoA: string;
  natoIl: string;
  residenteVia: string;
  residenteCitta: string;
  cellulare: string;
  cartaIdentita: string;
  daeMarca: string | null;
  daeMatricola: string | null;
  daeScadenza: string | null;
}

export interface DatiCreaReferenteAssociazione {
  associazioneId: string;
  tipo: 'sicurezza' | 'emergenze_dae';
  nome: string;
  cognome: string;
  natoA: string;
  natoIl: string;
  residenteVia: string;
  residenteCitta: string;
  cellulare: string;
  cartaIdentita: string;
  daeMarca?: string | undefined;
  daeMatricola?: string | undefined;
  daeScadenza?: string | undefined;
}

interface RigaReferente {
  id: string;
  associazione_id: string;
  tipo: 'sicurezza' | 'emergenze_dae';
  nome: string;
  cognome: string;
  nato_a: string;
  nato_il: string;
  residente_via: string;
  residente_citta: string;
  cellulare: string;
  carta_identita: string;
  dae_marca: string | null;
  dae_matricola: string | null;
  dae_scadenza: string | null;
}

function daRigaReferente(r: RigaReferente): ReferenteAssociazione {
  return {
    id: r.id,
    associazioneId: r.associazione_id,
    tipo: r.tipo,
    nome: r.nome,
    cognome: r.cognome,
    natoA: r.nato_a,
    natoIl: r.nato_il,
    residenteVia: r.residente_via,
    residenteCitta: r.residente_citta,
    cellulare: r.cellulare,
    cartaIdentita: r.carta_identita,
    daeMarca: r.dae_marca,
    daeMatricola: r.dae_matricola,
    daeScadenza: r.dae_scadenza,
  };
}

export async function creaReferenteAssociazione(db: Db, dati: DatiCreaReferenteAssociazione): Promise<ReferenteAssociazione> {
  const r = await db.query<RigaReferente>(
    `INSERT INTO associazioni_referenti (
       associazione_id, tipo, nome, cognome, nato_a, nato_il, residente_via, residente_citta,
       cellulare, carta_identita, dae_marca, dae_matricola, dae_scadenza
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     -- nato_il/dae_scadenza::text: senza cast pg restituirebbe un oggetto Date
     -- (colonne DATE), ma ReferenteAssociazione le tipizza string (vedi nota su
     -- COLONNE_SELECT più sopra).
     RETURNING id, associazione_id, tipo, nome, cognome, nato_a, nato_il::text, residente_via, residente_citta,
       cellulare, carta_identita, dae_marca, dae_matricola, dae_scadenza::text`,
    [
      dati.associazioneId, dati.tipo, dati.nome, dati.cognome, dati.natoA, dati.natoIl,
      dati.residenteVia, dati.residenteCitta, dati.cellulare, dati.cartaIdentita,
      dati.daeMarca ?? null, dati.daeMatricola ?? null, dati.daeScadenza ?? null,
    ],
  );
  return daRigaReferente(r.rows[0]!);
}

export async function listaReferentiPerAssociazione(db: Db, associazioneId: string): Promise<ReferenteAssociazione[]> {
  const r = await db.query<RigaReferente>(
    `SELECT id, associazione_id, tipo, nome, cognome, nato_a, nato_il::text, residente_via, residente_citta,
       cellulare, carta_identita, dae_marca, dae_matricola, dae_scadenza::text
     FROM associazioni_referenti WHERE associazione_id = $1 ORDER BY tipo`,
    [associazioneId],
  );
  return r.rows.map(daRigaReferente);
}

export interface AssicurazioneAssociazione {
  id: string;
  associazioneId: string;
  tipo: 'rct' | 'rco';
  compagnia: string;
  agenzia: string | null;
  numeroPolizza: string;
  massimale: string;
  coperturaDal: string;
  coperturaAl: string;
}

export interface DatiCreaAssicurazioneAssociazione {
  associazioneId: string;
  tipo: 'rct' | 'rco';
  compagnia: string;
  agenzia?: string | undefined;
  numeroPolizza: string;
  massimale: string;
  coperturaDal: string;
  coperturaAl: string;
}

interface RigaAssicurazione {
  id: string;
  associazione_id: string;
  tipo: 'rct' | 'rco';
  compagnia: string;
  agenzia: string | null;
  numero_polizza: string;
  massimale: string;
  copertura_dal: string;
  copertura_al: string;
}

function daRigaAssicurazione(r: RigaAssicurazione): AssicurazioneAssociazione {
  return {
    id: r.id,
    associazioneId: r.associazione_id,
    tipo: r.tipo,
    compagnia: r.compagnia,
    agenzia: r.agenzia,
    numeroPolizza: r.numero_polizza,
    massimale: r.massimale,
    coperturaDal: r.copertura_dal,
    coperturaAl: r.copertura_al,
  };
}

export async function creaAssicurazioneAssociazione(db: Db, dati: DatiCreaAssicurazioneAssociazione): Promise<AssicurazioneAssociazione> {
  const r = await db.query<RigaAssicurazione>(
    // massimale::text: stesso vincolo decimal-come-stringa già in uso nel progetto
    // per ogni valore NUMERIC — mai un binding numerico diretto (vedi parametrico.ts).
    `INSERT INTO associazioni_assicurazioni (
       associazione_id, tipo, compagnia, agenzia, numero_polizza, massimale, copertura_dal, copertura_al
     )
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8)
     -- copertura_dal/copertura_al::text: stesso motivo di massimale::text, ma per
     -- colonne DATE anziché NUMERIC — senza cast pg restituirebbe un oggetto Date.
     RETURNING id, associazione_id, tipo, compagnia, agenzia, numero_polizza, massimale::text,
       copertura_dal::text, copertura_al::text`,
    [
      dati.associazioneId, dati.tipo, dati.compagnia, dati.agenzia ?? null,
      dati.numeroPolizza, dati.massimale, dati.coperturaDal, dati.coperturaAl,
    ],
  );
  return daRigaAssicurazione(r.rows[0]!);
}

export async function listaAssicurazioniPerAssociazione(db: Db, associazioneId: string): Promise<AssicurazioneAssociazione[]> {
  const r = await db.query<RigaAssicurazione>(
    `SELECT id, associazione_id, tipo, compagnia, agenzia, numero_polizza, massimale::text,
       copertura_dal::text, copertura_al::text
     FROM associazioni_assicurazioni WHERE associazione_id = $1 ORDER BY tipo`,
    [associazioneId],
  );
  return r.rows.map(daRigaAssicurazione);
}
