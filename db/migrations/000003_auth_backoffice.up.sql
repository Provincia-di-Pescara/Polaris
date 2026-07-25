BEGIN;

-- ============================================================
-- SESSIONI BACKOFFICE (refresh token per JWT a scadenza breve)
-- Il refresh token stesso non è mai salvato in chiaro: solo il suo hash
-- SHA-256 (a differenza delle password, i refresh token sono già ad alta
-- entropia — generati casualmente, non scelti da una persona — quindi non
-- serve un KDF lento come scrypt, basta un digest per confronto sicuro).
-- ============================================================
CREATE TABLE sessioni_backoffice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utente_backoffice_id UUID NOT NULL REFERENCES utenti_backoffice(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    scade_il TIMESTAMPTZ NOT NULL,
    revocata_il TIMESTAMPTZ,
    ip_address INET,
    user_agent TEXT,
    CONSTRAINT sessioni_backoffice_scadenza_valida CHECK (scade_il > creata_il)
);
CREATE UNIQUE INDEX sessioni_backoffice_refresh_token_hash_uq ON sessioni_backoffice (refresh_token_hash);
CREATE INDEX sessioni_backoffice_utente_idx ON sessioni_backoffice (utente_backoffice_id);

-- ============================================================
-- TENTATIVI DI LOGIN BACKOFFICE (monitoraggio sicurezza, non audit di business)
-- Tabella separata da log_operazioni: quest'ultima richiede sempre un attore noto
-- (num_nonnulls su persona_fisica_id/utente_backoffice_id = 1), ma un tentativo di
-- login con email inesistente non ha nessun utente_backoffice_id da collegare —
-- serve poter registrare comunque il tentativo (utente_backoffice_id nullable qui).
-- ============================================================
CREATE TABLE tentativi_login_backoffice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_tentata TEXT NOT NULL,
    utente_backoffice_id UUID REFERENCES utenti_backoffice(id),
    esito TEXT NOT NULL CHECK (esito IN ('successo', 'password_errata', 'utente_non_trovato', 'utente_disattivato')),
    ip_address INET,
    avvenuto_il TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tentativi_login_backoffice_email_idx ON tentativi_login_backoffice (email_tentata, avvenuto_il);
CREATE INDEX tentativi_login_backoffice_ip_idx ON tentativi_login_backoffice (ip_address, avvenuto_il);

COMMIT;
