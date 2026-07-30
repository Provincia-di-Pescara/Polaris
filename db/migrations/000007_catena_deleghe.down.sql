ALTER TABLE persone_fisiche ALTER COLUMN oidc_provider SET NOT NULL;
ALTER TABLE persone_fisiche ALTER COLUMN oidc_subject SET NOT NULL;
DROP INDEX IF EXISTS abilitazioni_creata_da_idx;
ALTER TABLE abilitazioni DROP COLUMN creata_da_abilitazione_id;
