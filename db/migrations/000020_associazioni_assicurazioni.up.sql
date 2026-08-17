CREATE TABLE associazioni_assicurazioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    associazione_id UUID NOT NULL REFERENCES associazioni(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('rct', 'rco')),
    compagnia TEXT NOT NULL,
    agenzia TEXT,
    numero_polizza TEXT NOT NULL,
    massimale NUMERIC(12,2) NOT NULL,
    copertura_dal DATE NOT NULL,
    copertura_al DATE NOT NULL,
    creato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT associazioni_assicurazioni_tipo_uq UNIQUE (associazione_id, tipo),
    CONSTRAINT associazioni_assicurazioni_periodo_valido CHECK (copertura_al > copertura_dal)
);
