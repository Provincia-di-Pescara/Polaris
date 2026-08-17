import type { Db } from './db.ts';

export interface OrganismoSportivo {
  codice: string;
  denominazione: string;
}

export async function listaOrganismiSportivi(db: Db): Promise<OrganismoSportivo[]> {
  const r = await db.query<OrganismoSportivo>(
    `SELECT codice, denominazione FROM organismi_sportivi ORDER BY codice`,
  );
  return r.rows;
}
