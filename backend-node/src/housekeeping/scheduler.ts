import type { Pool } from 'pg';
import { eseguiHousekeeping } from './pulizia.ts';

const INTERVALLO_MS_DEFAULT = 24 * 60 * 60 * 1000; // giornaliero

export interface Scheduler {
  ferma: () => void;
}

// Scheduler interno minimale (setInterval): niente cron esterno, coerente con la scelta
// già fatta per PKCE/settings di "riusa Postgres, non aggiungere infrastruttura" — qui
// non serve nemmeno Postgres come storage, solo un timer nel processo backend. Esegue
// subito un primo giro al boot (gli ambienti restano puliti anche dopo un lungo downtime),
// poi ogni intervalloMs.
export function avviaSchedulerHousekeeping(pool: Pool, intervalloMs: number = INTERVALLO_MS_DEFAULT): Scheduler {
  const esegui = () => {
    eseguiHousekeeping(pool)
      .then((r) => {
        console.log(
          `[housekeeping] pkce=${r.pkceRimossi} sessioni_backoffice=${r.sessioniRimosse.backoffice} ` +
            `sessioni_pubblico=${r.sessioniRimosse.pubblico} log_operazioni=${r.logOperazioniRimossi}`,
        );
      })
      .catch((err) => {
        console.error('[housekeeping] errore durante la pulizia:', err);
      });
  };

  esegui();
  const timer = setInterval(esegui, intervalloMs);
  timer.unref(); // non deve tenere vivo il processo da solo (spegnimento pulito)

  return { ferma: () => clearInterval(timer) };
}
