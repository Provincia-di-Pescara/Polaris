ALTER TABLE associazioni DROP CONSTRAINT associazioni_rasd_organismo_coerente;
ALTER TABLE associazioni DROP CONSTRAINT associazioni_tipologia_soggetto_check;
ALTER TABLE associazioni DROP CONSTRAINT associazioni_delegato_coerente;
ALTER TABLE associazioni
  DROP COLUMN rappresentante_legale_nome,
  DROP COLUMN rappresentante_legale_cognome,
  DROP COLUMN delegato_nome,
  DROP COLUMN delegato_cognome,
  DROP COLUMN indirizzo_via,
  DROP COLUMN indirizzo_civico,
  DROP COLUMN indirizzo_citta,
  DROP COLUMN pec,
  DROP COLUMN email,
  DROP COLUMN tipologia_soggetto,
  DROP COLUMN iscritta_rasd,
  DROP COLUMN organismo_sportivo_codice,
  DROP COLUMN codice_affiliazione,
  DROP COLUMN ha_personale_assunto;
