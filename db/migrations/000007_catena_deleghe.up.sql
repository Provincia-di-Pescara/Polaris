-- Catena di sub-deleghe (Doc Principale art. 3-4): una persona già abilitata su
-- un'associazione può delegarne altre senza passare da approvazione operatore
-- (auto-approvata — il delegante è già stato verificato). NULL = prima abilitazione
-- di un'associazione (quella creata insieme all'associazione, l'unica che passa da
-- approvazione operatore). Nessun ON DELETE CASCADE: le abilitazioni non si
-- cancellano mai, solo si marcano 'revocata' (storico sempre presente).
ALTER TABLE abilitazioni
    ADD COLUMN creata_da_abilitazione_id UUID REFERENCES abilitazioni(id);
CREATE INDEX abilitazioni_creata_da_idx ON abilitazioni (creata_da_abilitazione_id);

-- Una persona fisica può essere pre-delegata (creata come "shell" da chi la delega,
-- via codice fiscale) prima di essersi mai autenticata via OIDC. oidc_subject/provider
-- restano NULL finché non fa il primo login reale (repository/personeFisiche.ts la
-- completa per match su codice_fiscale, logica già esistente).
ALTER TABLE persone_fisiche ALTER COLUMN oidc_subject DROP NOT NULL;
ALTER TABLE persone_fisiche ALTER COLUMN oidc_provider DROP NOT NULL;
