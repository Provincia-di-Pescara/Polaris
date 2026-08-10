-- I2 (final review B.34-35): una singola occorrenza (assegnazione, data) può essere
-- rilevata una sola volta. Senza questo indice la stessa data poteva essere registrata N
-- volte come 'non_utilizzato_non_giustificato' e contata N volte da codaMancatiUtilizzi,
-- gonfiando artificialmente il conteggio verso la soglia di decadenza (art. B.35).
CREATE UNIQUE INDEX utilizzi_effettivi_occorrenza_uq ON utilizzi_effettivi (assegnazione_id, data);
