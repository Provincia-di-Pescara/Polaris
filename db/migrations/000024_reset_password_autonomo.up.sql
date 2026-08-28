-- Token dedicato al reset password self-service ("password dimenticata"),
-- indipendente da token_verifica_hash/stato: a differenza dell'invito
-- amministrativo, qui la richiesta è pubblica e non autenticata — non deve
-- poter forzare un account attivo in 'in_attesa_verifica' (che ne impedirebbe
-- il login) solo perché qualcuno ne conosce l'indirizzo email. L'account resta
-- 'attivo' per tutta la finestra di validità del token; solo il completamento
-- (che dimostra il possesso della casella email) cambia la password.
ALTER TABLE utenti_backoffice
    ADD COLUMN token_reset_hash TEXT,
    ADD COLUMN token_reset_scade_il TIMESTAMPTZ;

ALTER TABLE utenti_backoffice ADD CONSTRAINT utenti_backoffice_token_reset_coerente
    CHECK ((token_reset_hash IS NULL) = (token_reset_scade_il IS NULL));
