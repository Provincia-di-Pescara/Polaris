-- Il proxy pa-sso-proxy (SATOSA) non espone nei claim quale IdP (SPID/CIE/eIDAS)
-- ha autenticato l'utente: la distinzione resta interamente nel proxy, non
-- ricostruibile lato nostro. Il vincolo enum forzava un valore indovinato
-- ('spid' hardcoded) che non riflette la realtà. Colonna resta per la UNIQUE
-- (oidc_provider, oidc_subject), solo il CHECK enum viene rimosso.
ALTER TABLE persone_fisiche DROP CONSTRAINT persone_fisiche_oidc_provider_check;
