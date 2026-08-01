-- Sequence dedicata per il numero di protocollo di `domande` (art. B.5: "la domanda è
-- protocollata automaticamente"). Formato generato lato applicativo/SQL:
-- 'DOM-' || anno corrente || '-' || progressivo 6 cifre, es. DOM-2026-000042.
CREATE SEQUENCE domande_protocollo_seq;
