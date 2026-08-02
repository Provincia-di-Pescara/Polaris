-- Ripristina il CHECK originale (5 valori) per rollback simmetrico.
ALTER TABLE domande DROP CONSTRAINT domande_stato_check;
ALTER TABLE domande ADD CONSTRAINT domande_stato_check CHECK (stato IN ('presentata', 'ammessa', 'esclusa', 'riesame_richiesto', 'riesame_deciso'));
