ALTER TABLE utenti_backoffice DROP CONSTRAINT utenti_backoffice_token_reset_coerente;
ALTER TABLE utenti_backoffice
    DROP COLUMN token_reset_hash,
    DROP COLUMN token_reset_scade_il;
