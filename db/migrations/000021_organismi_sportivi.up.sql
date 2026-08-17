CREATE TABLE organismi_sportivi (
    codice TEXT PRIMARY KEY,
    denominazione TEXT NOT NULL
);

-- Elenco 1 del documento (documenti/Associazioni_Documenti.docx): sigle degli
-- organismi sportivi affiliabili al RASD. Il documento non fornisce una
-- denominazione estesa separata dalla sigla — denominazione = codice per ora,
-- estendibile in futuro con un semplice UPDATE (nessuna migration di schema).
INSERT INTO organismi_sportivi (codice, denominazione) VALUES
    ('ACI', 'ACI'), ('ACSI', 'ACSI'), ('AICS', 'AICS'), ('ASC', 'ASC'), ('AeCI', 'AeCI'),
    ('CNS_Libertas', 'CNS_Libertas'), ('CSAIn', 'CSAIn'), ('CSEN', 'CSEN'), ('CSI', 'CSI'), ('ISI', 'ISI'),
    ('ENDAS', 'ENDAS'), ('FASI', 'FASI'), ('FCI', 'FCI'), ('FCrI', 'FCrI'), ('FGI', 'FGI'),
    ('FIB', 'FIB'), ('FIBa', 'FIBa'), ('FIC', 'FIC'), ('FICK', 'FICK'), ('FICSF', 'FICSF'),
    ('FICr', 'FICr'), ('FID', 'FID'), ('FIDAF', 'FIDAF'), ('FIDAL', 'FIDAL'), ('FIDASC', 'FIDASC'),
    ('FIDESM', 'FIDESM'), ('FIG', 'FIG'), ('FIGB', 'FIGB'), ('FIGC', 'FIGC'), ('FIGH', 'FIGH'),
    ('FIGS', 'FIGS'), ('FIGeST', 'FIGeST'), ('FIH', 'FIH'), ('FIJLKAM', 'FIJLKAM'), ('FIM', 'FIM'),
    ('FIN', 'FIN'), ('FIP', 'FIP'), ('FIPAV', 'FIPAV'), ('FIPR', 'FIPR'), ('FIPM', 'FIPM'),
    ('FIPSAS', 'FIPSAS'), ('FIPT', 'FIPT'), ('FIR', 'FIR'), ('FIRaft', 'FIRaft'), ('FIS', 'FIS'),
    ('FISB', 'FISB'), ('FISBB', 'FISBB'), ('FISE', 'FISE'), ('FISG', 'FISG'), ('FISI', 'FISI'),
    ('FISO', 'FISO'), ('FISR', 'FISR'), ('FISSW', 'FISSW'), ('FITA', 'FITA'), ('FITARCO', 'FITARCO'),
    ('FITAV', 'FITAV'), ('FITDS', 'FITDS'), ('FITP', 'FITP'), ('FITeT', 'FITeT'), ('FITri', 'FITri'),
    ('FITw', 'FITw'), ('FIV', 'FIV'), ('FIWuk', 'FIWuk'), ('FK', 'FK'), ('FMI', 'FMI'),
    ('FMSI', 'FMSI'), ('FPI', 'FPI'), ('FSI', 'FSI'), ('FederCUSI', 'FederCUSI'), ('MSP_Italia', 'MSP_Italia'),
    ('OPES', 'OPES'), ('PGS', 'PGS'), ('UISP', 'UISP'), ('UITS', 'UITS'), ('USSA', 'USSA'),
    ('US_ACLI', 'US_ACLI'), ('VSS', 'VSS');
