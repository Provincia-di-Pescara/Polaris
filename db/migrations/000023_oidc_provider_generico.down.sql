ALTER TABLE persone_fisiche ADD CONSTRAINT persone_fisiche_oidc_provider_check
  CHECK (oidc_provider IN ('spid', 'cie', 'eidas'));
