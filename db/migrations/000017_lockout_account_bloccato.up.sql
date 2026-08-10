ALTER TABLE tentativi_login_backoffice DROP CONSTRAINT tentativi_login_backoffice_esito_check;
ALTER TABLE tentativi_login_backoffice ADD CONSTRAINT tentativi_login_backoffice_esito_check
  CHECK (esito IN ('successo', 'password_errata', 'utente_non_trovato', 'utente_disattivato', 'account_bloccato'));
