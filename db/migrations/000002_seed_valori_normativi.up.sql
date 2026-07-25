BEGIN;

-- Valori normativi reali, presi letteralmente dall'Allegato A — non placeholder.

INSERT INTO classi_attivita (codice, descrizione, peso_base) VALUES
    ('A', 'Attività motoria e ricreativa', 1),
    ('B', 'Attività sportiva organizzata non agonistica', 2),
    ('C', 'Attività agonistica provinciale o regionale', 2),
    ('D', 'Attività agonistica interregionale', 3),
    ('E', 'Attività agonistica nazionale', 4);

INSERT INTO incremento_squadre_scaglioni (squadre_min, squadre_max, incremento) VALUES
    (0, 1, 0),
    (2, 3, 1),
    (4, 6, 2),
    (7, NULL, 3);

INSERT INTO crs_scaglioni (classe_attivita_codice, livello, crs) VALUES
    ('A', NULL, 1.00),
    ('B', NULL, 1.10),
    ('C', 'provinciale', 1.20),
    ('C', 'regionale', 1.35),
    ('D', NULL, 1.60),
    ('E', NULL, 2.00);

-- anni_min incluso, anni_max escluso ("da X a meno di Y"); ultimo scaglione anni_max NULL = nessun limite
INSERT INTO caa_scaglioni (anni_min, anni_max, caa) VALUES
    (0, 2, 0.90),
    (2, 5, 0.95),
    (5, 10, 1.00),
    (10, 20, 1.05),
    (20, NULL, 1.10);

-- Versione parametrico iniziale: valori placeholder di sviluppo (vedi CLAUDE.md),
-- colonne scalari usano i DEFAULT della tabella; qui aggiungiamo solo gli scaglioni CSD.
WITH nuova_versione AS (
    INSERT INTO parametrico_versioni (note)
    VALUES ('Valori placeholder di sviluppo — da validare con Ente prima del go-live')
    RETURNING id
)
INSERT INTO csd_scaglioni (parametrico_versione_id, rapporto_fd_fr_min, rapporto_fd_fr_max, coefficiente)
SELECT nuova_versione.id, r.rmin, r.rmax, r.coef
FROM nuova_versione, (VALUES
    (0.000::numeric, 1.000::numeric, 1.000::numeric),
    (1.000, 1.500, 0.950),
    (1.500, 2.000, 0.900),
    (2.000, NULL, 0.850)
) AS r(rmin, rmax, coef);

COMMIT;
