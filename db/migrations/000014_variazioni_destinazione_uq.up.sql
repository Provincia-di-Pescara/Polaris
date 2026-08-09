-- Rete di sicurezza strutturale per la DESTINAZIONE di una variazione ordinaria.
-- variazioni_occorrenza_attiva_uq (migration 000013) copre solo l'occorrenza di ORIGINE
-- (slot_id, data): due variazioni con origini diverse e la STESSA destinazione non avevano
-- alcun vincolo DB, e sotto READ COMMITTED due transazioni concorrenti potevano entrambe
-- vedere la destinazione libera e committare (riprodotto: entrambe 'accettata').
-- Il lock advisory per-occorrenza in variazioni.ts serializza il percorso applicativo; questo
-- indice è la difesa strutturale che regge anche a un percorso di scrittura futuro che
-- dimenticasse il lock.
-- NB: slot_destinazione_id IS NULL per liberazione/utilizzo_occasionale — quelle righe non
-- entrano nell'indice (predicato esplicito, oltre alla distinzione dei NULL negli indici unici).
-- NB2: se un ambiente ha già righe duplicate scritte prima del fix (possibile solo su DB di
-- sviluppo: la funzionalità non è mai stata rilasciata), la CREATE INDEX fallisce — vanno
-- prima annullate a mano le duplicate, tenendo la più vecchia per chiave di destinazione.
CREATE UNIQUE INDEX variazioni_destinazione_attiva_uq ON variazioni_ordinarie (slot_destinazione_id, data_destinazione)
    WHERE slot_destinazione_id IS NOT NULL AND stato IN ('in_attesa_accettazione', 'accettata');
