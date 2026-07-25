BEGIN;

-- ============================================================
-- STATO PKCE OIDC (Authorization Code + PKCE verso pa-sso-proxy)
-- Equivalente Postgres di quanto altri progetti fanno con Redis: TTL breve,
-- consumo one-shot (DELETE ... RETURNING), niente nuova infra solo per questo.
-- ============================================================
CREATE TABLE oidc_stato_pkce (
    state TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    creato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    scade_il TIMESTAMPTZ NOT NULL,
    CONSTRAINT oidc_stato_pkce_scadenza_valida CHECK (scade_il > creato_il)
);
CREATE INDEX oidc_stato_pkce_scade_il_idx ON oidc_stato_pkce (scade_il);

-- ============================================================
-- SESSIONI PERSONA FISICA (frontend pubblico, dopo login OIDC riuscito)
-- Speculare a sessioni_backoffice: stessa logica di rotation dei refresh
-- token, tabella separata perché la FK punta a persone_fisiche, non a
-- utenti_backoffice (evitiamo la FK polimorfica, coerente con la scelta
-- già fatta per abilitazioni/log_operazioni nello schema iniziale).
-- ============================================================
CREATE TABLE sessioni_persona_fisica (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_fisica_id UUID NOT NULL REFERENCES persone_fisiche(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    scade_il TIMESTAMPTZ NOT NULL,
    revocata_il TIMESTAMPTZ,
    ip_address INET,
    user_agent TEXT,
    CONSTRAINT sessioni_persona_fisica_scadenza_valida CHECK (scade_il > creata_il)
);
CREATE UNIQUE INDEX sessioni_persona_fisica_refresh_token_hash_uq ON sessioni_persona_fisica (refresh_token_hash);
CREATE INDEX sessioni_persona_fisica_persona_idx ON sessioni_persona_fisica (persona_fisica_id);

COMMIT;
