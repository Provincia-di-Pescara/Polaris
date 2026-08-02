-- C1 (review finale whole-branch): domande.stato resta riservato all'esito istruttoria
-- (presentata/ammessa/esclusa), letto dal motore Go con uguaglianza esatta
-- (WHERE stato = 'ammessa'). Sovraccaricarlo con gli stati del riesame (art. B.11) faceva
-- sparire silenziosamente le domande contestate da istruttoria/round-robin. Il riesame
-- diventa un asse separato su questa nuova colonna.
ALTER TABLE domande ADD COLUMN riesame_stato TEXT NOT NULL DEFAULT 'nessuno'
  CHECK (riesame_stato IN ('nessuno', 'richiesto', 'deciso'));
