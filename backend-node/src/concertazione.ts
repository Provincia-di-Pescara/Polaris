import type { Db } from './db.ts';
import { ErroreNonTrovato, ErroreStatoNonValidoPerTransizione, ErroreRiferimentoNonValido } from './erroriDominio.ts';
import { validaSlotAppartengonoAStagione } from './domande.ts';
import { leggiVersioneAttiva } from './repository/parametrico.ts';

export type TipoProposta =
  | 'scambio_bilaterale'
  | 'scambio_multilaterale'
  | 'cessione'
  | 'utilizzo_slot_libero'
  | 'accorpamento'
  | 'ampliamento';

export type StatoProposta = 'in_attesa_accettazione' | 'accettata_da_tutti' | 'validata' | 'rigettata' | 'annullata';

export interface ParteProposta {
  associazioneId: string;
  accettatoIl: string | null;
  accettatoDaPersonaFisicaId: string | null;
}

export interface SlotProposta {
  slotId: string;
  associazioneCedenteId: string | null;
  associazioneRiceventeId: string;
}

export interface Proposta {
  id: string;
  stagioneId: string;
  tipo: TipoProposta;
  proponentePersonaFisicaId: string;
  proponenteAssociazioneId: string;
  stato: StatoProposta;
  versione: number;
  motivazioneRigetto: string | null;
  creataIl: string;
  validataIl: string | null;
  validataDa: string | null;
  parti: ParteProposta[];
  slot: SlotProposta[];
}

interface RigaProposta {
  id: string;
  stagione_id: string;
  tipo: TipoProposta;
  proponente_persona_fisica_id: string;
  proponente_associazione_id: string;
  stato: StatoProposta;
  versione: number;
  motivazione_rigetto: string | null;
  creata_il: Date;
  validata_il: Date | null;
  validata_da: string | null;
}

const COLONNE_PROPOSTA = `id, stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id,
  stato, versione, motivazione_rigetto, creata_il, validata_il, validata_da`;

async function caricaPartiESlot(db: Db, propostaId: string): Promise<{ parti: ParteProposta[]; slot: SlotProposta[] }> {
  const parti = await db.query<{ associazione_id: string; accettato_il: Date | null; accettato_da_persona_fisica_id: string | null }>(
    `SELECT associazione_id, accettato_il, accettato_da_persona_fisica_id FROM concertazione_proposta_parti WHERE proposta_id = $1 ORDER BY associazione_id`,
    [propostaId],
  );
  const slot = await db.query<{ slot_id: string; associazione_cedente_id: string | null; associazione_ricevente_id: string }>(
    `SELECT slot_id, associazione_cedente_id, associazione_ricevente_id FROM concertazione_proposta_slot WHERE proposta_id = $1 ORDER BY slot_id`,
    [propostaId],
  );
  return {
    parti: parti.rows.map((r) => ({
      associazioneId: r.associazione_id,
      accettatoIl: r.accettato_il ? r.accettato_il.toISOString() : null,
      accettatoDaPersonaFisicaId: r.accettato_da_persona_fisica_id,
    })),
    slot: slot.rows.map((r) => ({ slotId: r.slot_id, associazioneCedenteId: r.associazione_cedente_id, associazioneRiceventeId: r.associazione_ricevente_id })),
  };
}

function assembla(r: RigaProposta, correlati: { parti: ParteProposta[]; slot: SlotProposta[] }): Proposta {
  return {
    id: r.id,
    stagioneId: r.stagione_id,
    tipo: r.tipo,
    proponentePersonaFisicaId: r.proponente_persona_fisica_id,
    proponenteAssociazioneId: r.proponente_associazione_id,
    stato: r.stato,
    versione: r.versione,
    motivazioneRigetto: r.motivazione_rigetto,
    creataIl: r.creata_il.toISOString(),
    validataIl: r.validata_il ? r.validata_il.toISOString() : null,
    validataDa: r.validata_da,
    ...correlati,
  };
}

export interface DatiCreaProposta {
  stagioneId: string;
  tipo: TipoProposta;
  slot: { slotId: string; associazioneCedenteId?: string | undefined; associazioneRiceventeId: string }[];
}

async function domandaAmmessaId(db: Db, associazioneId: string, stagioneId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM domande WHERE associazione_id = $1 AND stagione_id = $2 AND stato = 'ammessa'`,
    [associazioneId, stagioneId],
  );
  const riga = r.rows[0];
  if (!riga) {
    throw new ErroreRiferimentoNonValido('l\'associazione non ha una domanda ammessa per questa stagione');
  }
  return riga.id;
}

export async function creaProposta(
  db: Db,
  dati: DatiCreaProposta,
  proponentePersonaFisicaId: string,
  proponenteAssociazioneId: string,
): Promise<Proposta> {
  await validaSlotAppartengonoAStagione(db, dati.stagioneId, dati.slot.map((s) => s.slotId));

  const associazioniCoinvolte = [
    ...new Set(dati.slot.flatMap((s) => [s.associazioneCedenteId, s.associazioneRiceventeId].filter((x): x is string => x != null))),
  ];
  for (const associazioneId of associazioniCoinvolte) {
    await domandaAmmessaId(db, associazioneId, dati.stagioneId);
  }

  const statoIniziale: StatoProposta = associazioniCoinvolte.length <= 1 ? 'accettata_da_tutti' : 'in_attesa_accettazione';

  const r = await db.query<RigaProposta>(
    `INSERT INTO concertazione_proposte (stagione_id, tipo, proponente_persona_fisica_id, proponente_associazione_id, stato)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLONNE_PROPOSTA}`,
    [dati.stagioneId, dati.tipo, proponentePersonaFisicaId, proponenteAssociazioneId, statoIniziale],
  );
  const riga = r.rows[0]!;

  for (const associazioneId of associazioniCoinvolte) {
    // Il proponente stesso è già "accettante" nel momento in cui crea la proposta (B.26
    // parla di accettazione delle "altre" parti coinvolte): valorizza subito accettato_il
    // per l'associazione del proponente, lascia NULL per le altre.
    const giaAccettante = associazioneId === proponenteAssociazioneId;
    await db.query(
      `INSERT INTO concertazione_proposta_parti (proposta_id, associazione_id, accettato_il, accettato_da_persona_fisica_id)
       VALUES ($1, $2, $3, $4)`,
      [riga.id, associazioneId, giaAccettante ? new Date() : null, giaAccettante ? proponentePersonaFisicaId : null],
    );
  }
  for (const s of dati.slot) {
    await db.query(
      `INSERT INTO concertazione_proposta_slot (proposta_id, slot_id, associazione_cedente_id, associazione_ricevente_id)
       VALUES ($1, $2, $3, $4)`,
      [riga.id, s.slotId, s.associazioneCedenteId ?? null, s.associazioneRiceventeId],
    );
  }

  const correlati = await caricaPartiESlot(db, riga.id);
  return assembla(riga, correlati);
}

export async function trovaPropostaPerId(db: Db, id: string): Promise<Proposta | null> {
  const r = await db.query<RigaProposta>(`SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte WHERE id = $1`, [id]);
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return assembla(riga, await caricaPartiESlot(db, riga.id));
}

export async function listaPropostePerAssociazione(db: Db, associazioneId: string, stagioneId?: string): Promise<Proposta[]> {
  const r = stagioneId
    ? await db.query<RigaProposta>(
        `SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte p
         WHERE p.stagione_id = $2 AND EXISTS (SELECT 1 FROM concertazione_proposta_parti pp WHERE pp.proposta_id = p.id AND pp.associazione_id = $1)
         ORDER BY p.creata_il DESC`,
        [associazioneId, stagioneId],
      )
    : await db.query<RigaProposta>(
        `SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte p
         WHERE EXISTS (SELECT 1 FROM concertazione_proposta_parti pp WHERE pp.proposta_id = p.id AND pp.associazione_id = $1)
         ORDER BY p.creata_il DESC`,
        [associazioneId],
      );
  const risultato: Proposta[] = [];
  for (const riga of r.rows) {
    risultato.push(assembla(riga, await caricaPartiESlot(db, riga.id)));
  }
  return risultato;
}

export async function listaPropostePerStagioneBackoffice(db: Db, stagioneId: string, stato?: StatoProposta): Promise<Proposta[]> {
  const r = stato
    ? await db.query<RigaProposta>(
        `SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte WHERE stagione_id = $1 AND stato = $2 ORDER BY creata_il ASC`,
        [stagioneId, stato],
      )
    : await db.query<RigaProposta>(
        `SELECT ${COLONNE_PROPOSTA} FROM concertazione_proposte WHERE stagione_id = $1 ORDER BY creata_il ASC`,
        [stagioneId],
      );
  const risultato: Proposta[] = [];
  for (const riga of r.rows) {
    risultato.push(assembla(riga, await caricaPartiESlot(db, riga.id)));
  }
  return risultato;
}

// Lock esplicito FOR UPDATE sulla proposta: serializza gli accept concorrenti sulla stessa
// proposta (una seconda chiamata attende il rilascio del lock a COMMIT/ROLLBACK della
// prima, poi rilegge lo stato aggiornato) — la colonna versione resta solo un marker
// informativo incrementato ad ogni transizione, non serve un WHERE versione=$ perché il
// lock FOR UPDATE già esclude la race.
export async function accettaProposta(db: Db, propostaId: string, associazioneId: string, personaFisicaId: string): Promise<Proposta> {
  const lock = await db.query<{ stato: StatoProposta }>(
    `SELECT stato FROM concertazione_proposte WHERE id = $1 FOR UPDATE`,
    [propostaId],
  );
  const propostaRiga = lock.rows[0];
  if (!propostaRiga) {
    throw new ErroreNonTrovato('proposta non trovata');
  }
  if (propostaRiga.stato !== 'in_attesa_accettazione') {
    throw new ErroreStatoNonValidoPerTransizione('la proposta non è in attesa di accettazione');
  }
  const parte = await db.query<{ accettato_il: Date | null }>(
    `SELECT accettato_il FROM concertazione_proposta_parti WHERE proposta_id = $1 AND associazione_id = $2`,
    [propostaId, associazioneId],
  );
  const parteRiga = parte.rows[0];
  if (!parteRiga) {
    throw new ErroreNonTrovato('questa associazione non è parte della proposta');
  }
  if (parteRiga.accettato_il !== null) {
    throw new ErroreStatoNonValidoPerTransizione('questa associazione ha già accettato la proposta');
  }
  await db.query(
    `UPDATE concertazione_proposta_parti SET accettato_il = now(), accettato_da_persona_fisica_id = $3
     WHERE proposta_id = $1 AND associazione_id = $2`,
    [propostaId, associazioneId, personaFisicaId],
  );
  const restanti = await db.query<{ count: string }>(
    `SELECT count(*)::text FROM concertazione_proposta_parti WHERE proposta_id = $1 AND accettato_il IS NULL`,
    [propostaId],
  );
  if (restanti.rows[0]?.count === '0') {
    await db.query(`UPDATE concertazione_proposte SET stato = 'accettata_da_tutti', versione = versione + 1 WHERE id = $1`, [propostaId]);
  }
  return (await trovaPropostaPerId(db, propostaId))!;
}

export async function annullaProposta(db: Db, propostaId: string): Promise<Proposta> {
  const r = await db.query<{ id: string }>(
    `UPDATE concertazione_proposte SET stato = 'annullata'
     WHERE id = $1 AND stato IN ('in_attesa_accettazione', 'accettata_da_tutti')
     RETURNING id`,
    [propostaId],
  );
  if ((r.rowCount ?? 0) === 0) {
    const check = await db.query(`SELECT 1 FROM concertazione_proposte WHERE id = $1`, [propostaId]);
    if ((check.rowCount ?? 0) === 0) {
      throw new ErroreNonTrovato('proposta non trovata');
    }
    throw new ErroreStatoNonValidoPerTransizione('la proposta non è più annullabile (già validata/rigettata/annullata)');
  }
  return (await trovaPropostaPerId(db, propostaId))!;
}

export interface EsitoControllo {
  ok: boolean;
  motivo?: string;
}

// art. B.27 "non comprometta i blocchi gara assegnati" + "non generi sovrapposizioni": lo
// stato attivo del slot deve corrispondere esattamente a quanto la proposta si aspettava
// al momento della creazione — se nel frattempo un'altra proposta validata ha già spostato
// lo slot, questa non è più applicabile. Un blocco_gara non è MAI cedibile qui.
export async function controlloAssegnazioneAttivaAttesa(db: Db, slotId: string, cedenteAtteso: string | null): Promise<EsitoControllo> {
  const r = await db.query<{ associazione_id: string; tipo: string }>(
    `SELECT associazione_id, tipo FROM assegnazioni WHERE slot_id = $1 AND stato IN ('provvisoria', 'validata')`,
    [slotId],
  );
  const attiva = r.rows[0] ?? null;
  if (cedenteAtteso === null) {
    return attiva ? { ok: false, motivo: `slot ${slotId} non è più libero` } : { ok: true };
  }
  if (!attiva) {
    return { ok: false, motivo: `slot ${slotId} non ha più un'assegnazione attiva da cedere` };
  }
  if (attiva.tipo === 'blocco_gara') {
    return { ok: false, motivo: `slot ${slotId} è un blocco gara, non cedibile in concertazione` };
  }
  if (attiva.associazione_id !== cedenteAtteso) {
    return { ok: false, motivo: `slot ${slotId} non è più assegnato all'associazione cedente attesa` };
  }
  return { ok: true };
}

// art. B.27 "sia compatibile con la disciplina praticata": il ricevente deve avere una
// domanda ammessa la cui disciplina compare tra quelle compatibili con lo spazio dello
// slot. L'omologazione (altro punto B.27) riguarda solo le giornate gara
// (richieste_giornata_gara.necessita_impianto_omologato) — i blocchi gara sono già esclusi
// dal controllo sopra, quindi qui non si applica (assunzione documentata nello spec).
export async function controlloDisciplinaCompatibile(db: Db, slotId: string, riceventeAssociazioneId: string, stagioneId: string): Promise<EsitoControllo> {
  const r = await db.query(
    `SELECT 1
     FROM slot_settimana_tipo s
     JOIN spazio_disciplina_compatibile sdc ON sdc.spazio_id = s.spazio_id
     JOIN domanda_discipline dd ON dd.disciplina_codice = sdc.disciplina_codice
     JOIN domande d ON d.id = dd.domanda_id
     WHERE s.id = $1 AND d.associazione_id = $2 AND d.stagione_id = $3 AND d.stato = 'ammessa'`,
    [slotId, riceventeAssociazioneId, stagioneId],
  );
  if ((r.rowCount ?? 0) === 0) {
    return { ok: false, motivo: `nessuna disciplina compatibile tra lo spazio dello slot ${slotId} e la domanda del ricevente` };
  }
  return { ok: true };
}

interface RigaCarico {
  slot_id: string;
  impianto_id: string;
  durata_minuti: number;
  pregiata: boolean;
}

// art. B.19 (richiamato da B.27): minuti settimanali max, slot max stesso impianto, fasce
// pregiate max, verificati sul carico PROIETTATO del ricevente — le assegnazioni attive
// attuali, meno quelle che la stessa proposta gli fa cedere, più quelle che riceve.
export async function controlloLimitiConcentrazione(
  db: Db,
  stagioneId: string,
  associazioneId: string,
  slotIdCeduti: string[],
  slotIdRicevuti: string[],
): Promise<EsitoControllo> {
  const attuali = await db.query<RigaCarico>(
    `SELECT a.slot_id, sp.impianto_id, s.durata_minuti, s.pregiata
     FROM assegnazioni a
     JOIN slot_settimana_tipo s ON s.id = a.slot_id
     JOIN spazi_sportivi sp ON sp.id = s.spazio_id
     WHERE a.associazione_id = $1 AND a.stato IN ('provvisoria', 'validata') AND s.stagione_id = $2`,
    [associazioneId, stagioneId],
  );
  const cedutiSet = new Set(slotIdCeduti);
  const righeDopoCessioni = attuali.rows.filter((r) => !cedutiSet.has(r.slot_id));

  const ricevuti = slotIdRicevuti.length
    ? await db.query<RigaCarico>(
        `SELECT s.id AS slot_id, sp.impianto_id, s.durata_minuti, s.pregiata
         FROM slot_settimana_tipo s JOIN spazi_sportivi sp ON sp.id = s.spazio_id
         WHERE s.id = ANY($1)`,
        [slotIdRicevuti],
      )
    : { rows: [] as RigaCarico[] };

  const righeFinali = [...righeDopoCessioni, ...ricevuti.rows];
  const minutiTotali = righeFinali.reduce((tot, r) => tot + r.durata_minuti, 0);
  const fascePregiateCount = righeFinali.filter((r) => r.pregiata).length;
  const perImpianto = new Map<string, number>();
  for (const r of righeFinali) {
    perImpianto.set(r.impianto_id, (perImpianto.get(r.impianto_id) ?? 0) + 1);
  }

  // Nessuna versione parametrica attiva è una misconfigurazione di sistema (non dovrebbe mai
  // accadere dopo il seed, vedi CLAUDE.md), non un esito di dominio da esporre come 4xx
  // all'utente: propaga come eccezione, la route la mapperà a 500 come ogni altro errore
  // imprevisto (coerente con `erroriDominio.ts`, dove {ok:false} è riservato agli esiti di
  // validazione attesi, mai a un malfunzionamento del backend).
  const parametrico = await leggiVersioneAttiva(db);
  if (!parametrico) {
    throw new Error('nessuna versione parametrica attiva trovata: misconfigurazione di sistema');
  }
  if (minutiTotali > Number(parametrico.minutiSettimanaliMax)) {
    return { ok: false, motivo: `il ricevente supererebbe i minuti settimanali massimi (${parametrico.minutiSettimanaliMax})` };
  }
  if (fascePregiateCount > parametrico.fascePregiateMax) {
    return { ok: false, motivo: `il ricevente supererebbe le fasce pregiate massime (${parametrico.fascePregiateMax})` };
  }
  for (const [, count] of perImpianto) {
    if (count > parametrico.slotMaxStessoImpianto) {
      return { ok: false, motivo: `il ricevente supererebbe gli slot massimi nello stesso impianto (${parametrico.slotMaxStessoImpianto})` };
    }
  }
  return { ok: true };
}
