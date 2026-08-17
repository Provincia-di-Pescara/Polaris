CREATE TABLE associazioni_referenti (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associazione_id UUID NOT NULL REFERENCES associazioni(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('sicurezza', 'emergenze_dae')),
    nome TEXT NOT NULL,
    cognome TEXT NOT NULL,
    nato_a TEXT NOT NULL,
    nato_il DATE NOT NULL,
    residente_via TEXT NOT NULL,
    residente_citta TEXT NOT NULL,
    cellulare TEXT NOT NULL,
    carta_identita TEXT NOT NULL,
    dae_marca TEXT,
    dae_matricola TEXT,
    dae_scadenza DATE,
    creato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT associazioni_referenti_tipo_uq UNIQUE (associazione_id, tipo),
    -- Il DAE è dato solo dal referente 'emergenze_dae': un referente 'sicurezza'
    -- con DAE valorizzato indicherebbe un bug applicativo, non solo un dato mancante.
    CONSTRAINT associazioni_referenti_dae_coerente CHECK (
        tipo = 'emergenze_dae' OR (dae_marca IS NULL AND dae_matricola IS NULL AND dae_scadenza IS NULL)
    )
);
