import type { Db } from '../db.ts';

// Retention/housekeeping GDPR (art. 23 Doc Principale — vedi docs/SPEC.md §7-bis.2).
// Tocca SOLO: stati OIDC PKCE scaduti, sessioni scadute/revocate da tempo, log operativo
// oltre retention_log_operazioni_giorni. NON tocca MAI sorteggi/assegnazioni/settimana
// tipo: quella retention è legale, fissa (intera stagione + termine di impugnazione),
// non derogabile da qui — nessuna funzione di questo modulo ha motivo di toccare quelle
// tabelle, non solo per test.

const RETENTION_SESSIONI_REVOCATE_GIORNI_DEFAULT = 30;

export async function pulisciPkceScaduto(db: Db): Promise<number> {
  const r = await db.query(`DELETE FROM oidc_stato_pkce WHERE scade_il < now()`);
  return r.rowCount ?? 0;
}

export async function pulisciSessioniScadute(
  db: Db,
  retentionRevocateGiorni: number = RETENTION_SESSIONI_REVOCATE_GIORNI_DEFAULT,
): Promise<{ backoffice: number; pubblico: number }> {
  const backoffice = await db.query(
    `DELETE FROM sessioni_backoffice
     WHERE scade_il < now()
        OR (revocata_il IS NOT NULL AND revocata_il < now() - ($1 || ' days')::interval)`,
    [retentionRevocateGiorni],
  );
  const pubblico = await db.query(
    `DELETE FROM sessioni_persona_fisica
     WHERE scade_il < now()
        OR (revocata_il IS NOT NULL AND revocata_il < now() - ($1 || ' days')::interval)`,
    [retentionRevocateGiorni],
  );
  return { backoffice: backoffice.rowCount ?? 0, pubblico: pubblico.rowCount ?? 0 };
}

// Legge retention_log_operazioni_giorni dalla versione parametrica attiva (stesso
// pattern "ultima per valida_dal" del motore Go — parametro 🔧, default 30gg).
async function retentionLogOperazioniGiorni(db: Db): Promise<number> {
  const r = await db.query<{ retention_log_operazioni_giorni: number }>(
    `SELECT retention_log_operazioni_giorni FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1`,
  );
  return r.rows[0]?.retention_log_operazioni_giorni ?? 30;
}

export async function pulisciLogOperazioniOltreRetention(db: Db): Promise<number> {
  const giorni = await retentionLogOperazioniGiorni(db);
  const r = await db.query(`DELETE FROM log_operazioni WHERE avvenuta_il < now() - ($1 || ' days')::interval`, [giorni]);
  return r.rowCount ?? 0;
}

export interface RiepilogoHousekeeping {
  pkceRimossi: number;
  sessioniRimosse: { backoffice: number; pubblico: number };
  logOperazioniRimossi: number;
}

export async function eseguiHousekeeping(db: Db): Promise<RiepilogoHousekeeping> {
  const pkceRimossi = await pulisciPkceScaduto(db);
  const sessioniRimosse = await pulisciSessioniScadute(db);
  const logOperazioniRimossi = await pulisciLogOperazioniOltreRetention(db);
  return { pkceRimossi, sessioniRimosse, logOperazioniRimossi };
}
