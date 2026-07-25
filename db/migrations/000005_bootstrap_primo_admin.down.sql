-- Presuppone che non esistano righe in stato 'in_attesa_verifica' (vanno rimosse a mano
-- prima del downgrade, sono account mai attivati).
ALTER TABLE utenti_backoffice DROP CONSTRAINT utenti_backoffice_token_verifica_coerente;
ALTER TABLE utenti_backoffice
    DROP COLUMN token_verifica_hash,
    DROP COLUMN token_verifica_scade_il;
ALTER TABLE utenti_backoffice DROP CONSTRAINT utenti_backoffice_stato_check;
ALTER TABLE utenti_backoffice ADD CONSTRAINT utenti_backoffice_stato_check
    CHECK (stato IN ('attivo', 'disattivato'));
