ALTER TABLE utilizzi_effettivi
  DROP COLUMN giustificazione_motivazione_rigetto,
  DROP COLUMN giustificazione_decisa_il,
  DROP COLUMN giustificazione_decisa_da,
  DROP COLUMN giustificazione_presentata_il,
  DROP COLUMN giustificazione_testo,
  DROP COLUMN giustificazione_scade_il;

ALTER TABLE parametrico_versioni
  DROP COLUMN termine_giustificazione_giorni;
