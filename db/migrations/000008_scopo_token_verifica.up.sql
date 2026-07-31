-- Separa i namespace dei token di verifica: la colonna token_verifica_hash è
-- condivisa da due flussi distinti (bootstrap primo admin, invito/reset utente
-- backoffice) con lo stesso formato (SHA-256 di 32 byte random) — senza uno
-- scopo esplicito, un token di reset-password poteva essere usato sull'endpoint
-- di bootstrap per riattivare l'account SENZA cambiare la password, bypassando
-- il reset amministrativo (bug reale trovato in review finale). La colonna
-- distingue i due flussi in modo che ciascun endpoint possa vincolare la UPDATE
-- al proprio scopo.
ALTER TABLE utenti_backoffice ADD COLUMN token_verifica_scopo TEXT;

-- Backfill per righe già esistenti con un token pendente al momento della migrazione:
-- non possiamo sapere con certezza da quale flusso provenga un token già emesso, ma
-- creato_da è un proxy affidabile — il bootstrap del primo admin (richiediPrimoAdmin)
-- non valorizza mai creato_da (nessun admin esiste ancora quando viene generato),
-- mentre ogni invito/reset (creaUtenteInvitato/impostaNuovoInvito) lo valorizza sempre
-- con l'id dell'admin che ha eseguito l'operazione.
UPDATE utenti_backoffice
SET token_verifica_scopo = CASE WHEN creato_da IS NULL THEN 'bootstrap' ELSE 'invito_utente' END
WHERE token_verifica_hash IS NOT NULL;

-- Stesso pattern di coerenza già usato per token_verifica_hash/token_verifica_scade_il
-- nella migration 000005: lo scopo esiste se e solo se esiste il token.
ALTER TABLE utenti_backoffice ADD CONSTRAINT utenti_backoffice_token_verifica_scopo_coerente
    CHECK ((token_verifica_hash IS NOT NULL) = (token_verifica_scopo IS NOT NULL));

ALTER TABLE utenti_backoffice ADD CONSTRAINT utenti_backoffice_token_verifica_scopo_check
    CHECK (token_verifica_scopo IS NULL OR token_verifica_scopo IN ('bootstrap', 'invito_utente'));
