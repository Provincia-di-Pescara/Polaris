-- Tutela nuove associazioni (art. 12 Doc Principale): quota di precedenza dinamica
-- per le associazioni alla prima stagione (art. B.15/A.4: dato già disponibile in
-- coefficienti_associazione.prima_stagione). Default 0 = disattivata — vedi
-- docs/SPEC.md §7-bis.1 per il meccanismo esatto (non riserva statica di fasce).
ALTER TABLE parametrico_versioni
    ADD COLUMN quota_nuove_associazioni_pct NUMERIC(6,4) NOT NULL DEFAULT 0;
