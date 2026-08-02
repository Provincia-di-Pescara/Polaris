-- Stringe il CHECK su domande.stato ai soli 3 valori validi post-fix C1.
-- Prima del refactor C1, domande.stato includeva anche 'riesame_richiesto'/'riesame_deciso',
-- ora gestiti dalla colonna dedicata domande.riesame_stato (introdotta prima di questa
-- migration). Il CHECK originale a 5 valori non è mai più scritto dal codice applicativo,
-- ma resta l'unica difesa strutturale contro la reintroduzione del bug C1 (es. da uno
-- script di manutenzione futuro che legge il vecchio CHECK come "documentazione").
ALTER TABLE domande DROP CONSTRAINT domande_stato_check;
ALTER TABLE domande ADD CONSTRAINT domande_stato_check CHECK (stato IN ('presentata', 'ammessa', 'esclusa'));
