ALTER TABLE associazioni
  ADD COLUMN rappresentante_legale_nome TEXT,
  ADD COLUMN rappresentante_legale_cognome TEXT,
  ADD COLUMN delegato_nome TEXT,
  ADD COLUMN delegato_cognome TEXT,
  ADD COLUMN indirizzo_via TEXT,
  ADD COLUMN indirizzo_civico TEXT,
  ADD COLUMN indirizzo_citta TEXT,
  ADD COLUMN pec TEXT,
  ADD COLUMN email TEXT,
  ADD COLUMN tipologia_soggetto TEXT,
  ADD COLUMN iscritta_rasd BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN organismo_sportivo_codice TEXT,
  ADD COLUMN codice_affiliazione TEXT,
  ADD COLUMN ha_personale_assunto BOOLEAN NOT NULL DEFAULT false;

-- Le colonne anagrafiche restano NULLABLE a livello DB (le righe già esistenti,
-- create prima di questo blocco, non le hanno) — l'obbligatorietà per le NUOVE
-- righe è imposta da zod (schemaCreaAssociazione, Task 2), non da un NOT NULL
-- che romperebbe le righe storiche. Stesso approccio già seguito per altre
-- estensioni additive dello schema in questo progetto.

ALTER TABLE associazioni ADD CONSTRAINT associazioni_delegato_coerente
  CHECK (num_nonnulls(delegato_nome, delegato_cognome) <> 1);

ALTER TABLE associazioni ADD CONSTRAINT associazioni_tipologia_soggetto_check
  CHECK (tipologia_soggetto IS NULL OR tipologia_soggetto IN (
    'associazione_sportiva',
    'cooperativa_ente_promozione_sportiva',
    'ente_promozione_culturale_giovanile_anziani',
    'ente_assistenza_handicap_volontariato',
    'soggetto_singolo_no_profit',
    'organizzazione_sindacale',
    'movimento_partito_politico',
    'gruppo_privati_circolo'
  ));

ALTER TABLE associazioni ADD CONSTRAINT associazioni_rasd_organismo_coerente
  CHECK (NOT iscritta_rasd OR (organismo_sportivo_codice IS NOT NULL AND codice_affiliazione IS NOT NULL));
