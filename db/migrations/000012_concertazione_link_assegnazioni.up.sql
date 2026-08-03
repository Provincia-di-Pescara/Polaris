-- backend-node non ha bisogno di ricalcolare gli "accordi intervenuti in fase di
-- concertazione" (art. B.30, blocco 4/4 futuro) da euristiche a posteriori: ogni
-- assegnazione nata da uno scambio validato porta un riferimento diretto alla proposta.
-- Nullable: le assegnazioni nate dal round-robin/blocchi-gara non la valorizzano mai.
ALTER TABLE assegnazioni ADD COLUMN concertazione_proposta_id UUID REFERENCES concertazione_proposte(id);
