CREATE TABLE variazioni_ordinarie (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo TEXT NOT NULL CHECK (tipo IN ('liberazione', 'recupero', 'scambio_temporaneo', 'utilizzo_occasionale')),
    slot_id UUID NOT NULL REFERENCES slot_settimana_tipo(id),
    data DATE NOT NULL,
    slot_destinazione_id UUID REFERENCES slot_settimana_tipo(id),
    data_destinazione DATE,
    richiesta_da_associazione_id UUID NOT NULL REFERENCES associazioni(id),
    richiesta_da_persona_fisica_id UUID NOT NULL REFERENCES persone_fisiche(id),
    controparte_associazione_id UUID REFERENCES associazioni(id),
    indisponibilita_id UUID REFERENCES indisponibilita_sopravvenute(id),
    stato TEXT NOT NULL DEFAULT 'accettata' CHECK (stato IN ('in_attesa_accettazione', 'accettata', 'rifiutata', 'annullata')),
    motivazione_rifiuto TEXT,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT variazioni_scambio_ha_controparte CHECK (
        (tipo = 'scambio_temporaneo') = (controparte_associazione_id IS NOT NULL)
    ),
    CONSTRAINT variazioni_destinazione_coerente CHECK (
        (tipo IN ('recupero', 'scambio_temporaneo')) = (slot_destinazione_id IS NOT NULL AND data_destinazione IS NOT NULL)
    )
);
-- Una sola variazione attiva per occorrenza (origine): evita che due richieste in
-- conflitto sulla stessa fascia+data vengano entrambe accettate.
CREATE UNIQUE INDEX variazioni_occorrenza_attiva_uq ON variazioni_ordinarie (slot_id, data)
    WHERE stato IN ('in_attesa_accettazione', 'accettata');
CREATE INDEX variazioni_richiesta_da_idx ON variazioni_ordinarie (richiesta_da_associazione_id);
