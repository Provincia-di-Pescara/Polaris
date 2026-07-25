BEGIN;

DELETE FROM csd_scaglioni;
DELETE FROM parametrico_versioni;
DELETE FROM caa_scaglioni;
DELETE FROM crs_scaglioni;
DELETE FROM incremento_squadre_scaglioni;
DELETE FROM classi_attivita;

COMMIT;
