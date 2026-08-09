import type { Db } from '../db.ts';

export interface ScaglioneCsd {
  rapportoFdFrMin: string;
  rapportoFdFrMax: string | null;
  coefficiente: string;
}

export interface VersioneParametrica {
  id: string;
  validaDal: string;
  pubblicataDa: string | null;
  note: string | null;
  moltiplicatoreMinutiPerPunto: string;
  pesoFasciaPregiata: string;
  minutiSettimanaliMax: string;
  slotMaxStessoImpianto: number;
  fascePregiateMax: number;
  giornateGaraMax: number;
  incrementoSquadreNeutro: number;
  caaNeutro: string;
  csdNeutro: string;
  tolleranzaIsfPct: string;
  sogliaMancatiUtilizziDiffida: number;
  sogliaMancatiUtilizziDecadenza: number;
  sogliaScostamentoDichiaratoPct: string;
  sogliaIsfCompensazione: string;
  retentionLogOperazioniGiorni: number;
  quotaNuoveAssociazioniPct: string;
  termineGiustificazioneGiorni: number;
  creataIl: string;
  csdScaglioni: ScaglioneCsd[];
}

export interface VersioneParametricaSintetica {
  id: string;
  validaDal: string;
  pubblicataDa: string | null;
  note: string | null;
}

interface RigaVersione {
  id: string;
  valida_dal: Date;
  pubblicata_da: string | null;
  note: string | null;
  moltiplicatore_minuti_per_punto: string;
  peso_fascia_pregiata: string;
  minuti_settimanali_max: string;
  slot_max_stesso_impianto: number;
  fasce_pregiate_max: number;
  giornate_gara_max: number;
  incremento_squadre_neutro: number;
  caa_neutro: string;
  csd_neutro: string;
  tolleranza_isf_pct: string;
  soglia_mancati_utilizzi_diffida: number;
  soglia_mancati_utilizzi_decadenza: number;
  soglia_scostamento_dichiarato_pct: string;
  soglia_isf_compensazione: string;
  retention_log_operazioni_giorni: number;
  quota_nuove_associazioni_pct: string;
  termine_giustificazione_giorni: number;
  creata_il: Date;
}

interface RigaScaglioneCsd {
  rapporto_fd_fr_min: string;
  rapporto_fd_fr_max: string | null;
  coefficiente: string;
}

const COLONNE_SELECT_VERSIONE = `id, valida_dal, pubblicata_da, note,
  moltiplicatore_minuti_per_punto::text, peso_fascia_pregiata::text, minuti_settimanali_max::text,
  slot_max_stesso_impianto, fasce_pregiate_max, giornate_gara_max, incremento_squadre_neutro,
  caa_neutro::text, csd_neutro::text, tolleranza_isf_pct::text,
  soglia_mancati_utilizzi_diffida, soglia_mancati_utilizzi_decadenza,
  soglia_scostamento_dichiarato_pct::text, soglia_isf_compensazione::text,
  retention_log_operazioni_giorni, quota_nuove_associazioni_pct::text, termine_giustificazione_giorni, creata_il`;

function daRigaVersione(r: RigaVersione, csdScaglioni: ScaglioneCsd[]): VersioneParametrica {
  return {
    id: r.id,
    validaDal: r.valida_dal.toISOString(),
    pubblicataDa: r.pubblicata_da,
    note: r.note,
    moltiplicatoreMinutiPerPunto: r.moltiplicatore_minuti_per_punto,
    pesoFasciaPregiata: r.peso_fascia_pregiata,
    minutiSettimanaliMax: r.minuti_settimanali_max,
    slotMaxStessoImpianto: r.slot_max_stesso_impianto,
    fascePregiateMax: r.fasce_pregiate_max,
    giornateGaraMax: r.giornate_gara_max,
    incrementoSquadreNeutro: r.incremento_squadre_neutro,
    caaNeutro: r.caa_neutro,
    csdNeutro: r.csd_neutro,
    tolleranzaIsfPct: r.tolleranza_isf_pct,
    sogliaMancatiUtilizziDiffida: r.soglia_mancati_utilizzi_diffida,
    sogliaMancatiUtilizziDecadenza: r.soglia_mancati_utilizzi_decadenza,
    sogliaScostamentoDichiaratoPct: r.soglia_scostamento_dichiarato_pct,
    sogliaIsfCompensazione: r.soglia_isf_compensazione,
    retentionLogOperazioniGiorni: r.retention_log_operazioni_giorni,
    quotaNuoveAssociazioniPct: r.quota_nuove_associazioni_pct,
    termineGiustificazioneGiorni: r.termine_giustificazione_giorni,
    creataIl: r.creata_il.toISOString(),
    csdScaglioni,
  };
}

function daRigaScaglione(r: RigaScaglioneCsd): ScaglioneCsd {
  return { rapportoFdFrMin: r.rapporto_fd_fr_min, rapportoFdFrMax: r.rapporto_fd_fr_max, coefficiente: r.coefficiente };
}

async function caricaScaglioniPerVersione(db: Db, versioneId: string): Promise<ScaglioneCsd[]> {
  const r = await db.query<RigaScaglioneCsd>(
    `SELECT rapporto_fd_fr_min::text, rapporto_fd_fr_max::text, coefficiente::text
     FROM csd_scaglioni WHERE parametrico_versione_id = $1 ORDER BY rapporto_fd_fr_min`,
    [versioneId],
  );
  return r.rows.map(daRigaScaglione);
}

export async function leggiVersioneAttiva(db: Db): Promise<VersioneParametrica | null> {
  const r = await db.query<RigaVersione>(
    `SELECT ${COLONNE_SELECT_VERSIONE} FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`,
  );
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return daRigaVersione(riga, await caricaScaglioniPerVersione(db, riga.id));
}

export async function leggiVersionePerId(db: Db, id: string): Promise<VersioneParametrica | null> {
  const r = await db.query<RigaVersione>(`SELECT ${COLONNE_SELECT_VERSIONE} FROM parametrico_versioni WHERE id = $1`, [id]);
  const riga = r.rows[0];
  if (!riga) {
    return null;
  }
  return daRigaVersione(riga, await caricaScaglioniPerVersione(db, riga.id));
}

export async function listaVersioni(db: Db): Promise<VersioneParametricaSintetica[]> {
  const r = await db.query<{ id: string; valida_dal: Date; pubblicata_da: string | null; note: string | null }>(
    `SELECT id, valida_dal, pubblicata_da, note FROM parametrico_versioni ORDER BY valida_dal DESC`,
  );
  return r.rows.map((riga) => ({
    id: riga.id,
    validaDal: riga.valida_dal.toISOString(),
    pubblicataDa: riga.pubblicata_da,
    note: riga.note,
  }));
}

export interface DatiCreaVersione {
  note?: string | undefined;
  moltiplicatoreMinutiPerPunto: string;
  pesoFasciaPregiata: string;
  minutiSettimanaliMax: string;
  slotMaxStessoImpianto: number;
  fascePregiateMax: number;
  giornateGaraMax: number;
  incrementoSquadreNeutro: number;
  caaNeutro: string;
  csdNeutro: string;
  tolleranzaIsfPct: string;
  sogliaMancatiUtilizziDiffida: number;
  sogliaMancatiUtilizziDecadenza: number;
  sogliaScostamentoDichiaratoPct: string;
  sogliaIsfCompensazione: string;
  retentionLogOperazioniGiorni: number;
  quotaNuoveAssociazioniPct: string;
  termineGiustificazioneGiorni: number;
  csdScaglioni: Array<{ rapportoFdFrMin: string; rapportoFdFrMax: string | null; coefficiente: string }>;
}

export async function creaVersione(
  db: Db,
  dati: DatiCreaVersione,
  pubblicataDa: string | null,
): Promise<VersioneParametrica> {
  const r = await db.query<RigaVersione>(
    `INSERT INTO parametrico_versioni
       (pubblicata_da, note, moltiplicatore_minuti_per_punto, peso_fascia_pregiata, minuti_settimanali_max,
        slot_max_stesso_impianto, fasce_pregiate_max, giornate_gara_max, incremento_squadre_neutro,
        caa_neutro, csd_neutro, tolleranza_isf_pct, soglia_mancati_utilizzi_diffida,
        soglia_mancati_utilizzi_decadenza, soglia_scostamento_dichiarato_pct, soglia_isf_compensazione,
        retention_log_operazioni_giorni, quota_nuove_associazioni_pct, termine_giustificazione_giorni)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING ${COLONNE_SELECT_VERSIONE}`,
    [
      pubblicataDa,
      dati.note ?? null,
      dati.moltiplicatoreMinutiPerPunto,
      dati.pesoFasciaPregiata,
      dati.minutiSettimanaliMax,
      dati.slotMaxStessoImpianto,
      dati.fascePregiateMax,
      dati.giornateGaraMax,
      dati.incrementoSquadreNeutro,
      dati.caaNeutro,
      dati.csdNeutro,
      dati.tolleranzaIsfPct,
      dati.sogliaMancatiUtilizziDiffida,
      dati.sogliaMancatiUtilizziDecadenza,
      dati.sogliaScostamentoDichiaratoPct,
      dati.sogliaIsfCompensazione,
      dati.retentionLogOperazioniGiorni,
      dati.quotaNuoveAssociazioniPct,
      dati.termineGiustificazioneGiorni,
    ],
  );
  const versione = r.rows[0]!;
  const scaglioni: ScaglioneCsd[] = [];
  for (const s of dati.csdScaglioni) {
    const rs = await db.query<RigaScaglioneCsd>(
      `INSERT INTO csd_scaglioni (parametrico_versione_id, rapporto_fd_fr_min, rapporto_fd_fr_max, coefficiente)
       VALUES ($1,$2,$3,$4)
       RETURNING rapporto_fd_fr_min::text, rapporto_fd_fr_max::text, coefficiente::text`,
      [versione.id, s.rapportoFdFrMin, s.rapportoFdFrMax, s.coefficiente],
    );
    scaglioni.push(daRigaScaglione(rs.rows[0]!));
  }
  return daRigaVersione(versione, scaglioni);
}
