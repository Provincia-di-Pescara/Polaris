import { richiedi } from './client.ts';

export interface OrganismoSportivo {
  codice: string;
  denominazione: string;
}

export function listaOrganismiSportivi(): Promise<OrganismoSportivo[]> {
  return richiedi('/organismi-sportivi');
}
