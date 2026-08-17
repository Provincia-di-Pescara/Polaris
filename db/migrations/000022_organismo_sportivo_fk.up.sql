-- Finding 4 della code review finale del branch: associazioni.organismo_sportivo_codice
-- era TEXT libero, senza garanzia a livello DB di referenziare una riga reale di
-- organismi_sportivi (solo un .min(1) zod lato applicativo). Tutte le righe esistenti
-- hanno questa colonna NULL (nessun dato in produzione la valorizza ancora), quindi
-- aggiungere il FK ora è sicuro e istantaneo.
ALTER TABLE associazioni
  ADD CONSTRAINT associazioni_organismo_sportivo_fk
  FOREIGN KEY (organismo_sportivo_codice) REFERENCES organismi_sportivi(codice);
