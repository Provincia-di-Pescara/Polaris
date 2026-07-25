-- Bootstrap del primo admin (wizard primo avvio): l'account viene creato in stato
-- 'in_attesa_verifica' e attivato solo dal link ricevuto via email (SMTP di bootstrap
-- configurato in .env — l'unico caso in cui l'SMTP non può stare in impostazioni_sistema:
-- non esiste ancora nessun admin che possa configurarlo da UI).

ALTER TABLE utenti_backoffice DROP CONSTRAINT utenti_backoffice_stato_check;
ALTER TABLE utenti_backoffice ADD CONSTRAINT utenti_backoffice_stato_check
    CHECK (stato IN ('attivo', 'disattivato', 'in_attesa_verifica'));

-- Token di verifica: casuale ad alta entropia, salvato SOLO hashato (SHA-256, stesso
-- pattern dei refresh token), one-shot, con scadenza breve.
ALTER TABLE utenti_backoffice
    ADD COLUMN token_verifica_hash TEXT,
    ADD COLUMN token_verifica_scade_il TIMESTAMPTZ;

-- Il token esiste se e solo se l'account è in attesa di verifica.
ALTER TABLE utenti_backoffice ADD CONSTRAINT utenti_backoffice_token_verifica_coerente
    CHECK ((stato = 'in_attesa_verifica') = (token_verifica_hash IS NOT NULL AND token_verifica_scade_il IS NOT NULL));
