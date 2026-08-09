ALTER TABLE parametrico_versioni
  ADD COLUMN termine_giustificazione_giorni INTEGER NOT NULL DEFAULT 7;

ALTER TABLE utilizzi_effettivi
  ADD COLUMN giustificazione_scade_il TIMESTAMPTZ,
  ADD COLUMN giustificazione_testo TEXT,
  ADD COLUMN giustificazione_presentata_il TIMESTAMPTZ,
  ADD COLUMN giustificazione_decisa_da UUID REFERENCES utenti_backoffice(id),
  ADD COLUMN giustificazione_decisa_il TIMESTAMPTZ,
  ADD COLUMN giustificazione_motivazione_rigetto TEXT;
