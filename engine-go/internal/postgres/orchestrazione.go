package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/provincia/palestre-engine/internal/roundrobin"
)

func eseguiRoundRobinConTipo(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex, tipo string) (roundrobin.Esito, string, error) {
	parametrico, err := CaricaParametricoAttivo(ctx, pool)
	if err != nil {
		return roundrobin.Esito{}, "", err
	}

	snapshot, err := CaricaSnapshotRoundRobin(ctx, pool, stagioneID, parametrico, semeHex)
	if err != nil {
		return roundrobin.Esito{}, "", err
	}

	esito, err := roundrobin.Esegui(snapshot.Input)
	if err != nil {
		return roundrobin.Esito{}, "", fmt.Errorf("esecuzione round-robin: %w", err)
	}

	elaborazioneID, err := PersistiEsitoRoundRobin(ctx, pool, stagioneID, parametrico.VersioneID, tipo, snapshot, esito)
	if err != nil {
		return roundrobin.Esito{}, "", err
	}

	return esito, elaborazioneID, nil
}

// EseguiRoundRobin implementa la Fase 8 completa end-to-end (art. B.17-22): carica il
// parametrico attivo e lo snapshot della stagione, esegue il round-robin e persiste il
// risultato in transazione con tipo='prima_assegnazione'. Richiede che EseguiIstruttoria
// sia già stato eseguito.
func EseguiRoundRobin(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
	return eseguiRoundRobinConTipo(ctx, pool, stagioneID, semeHex, "prima_assegnazione")
}

// EseguiRiassegnazioneResidua implementa l'art. B.29: riapplica le regole delle Fasi 8-9
// alle sole fasce ancora libere dopo la concertazione. Nessuna logica nuova rispetto a
// EseguiRoundRobin — il filtro slot-candidati (caricaFasce) esclude già qualsiasi
// assegnazione attiva (non solo blocchi gara) e caricaStatoIniziale somma già
// correttamente lo stato post-concertazione (VA/concentrazione, inclusi gli scambi
// validati). Unica differenza: tipo='riassegnazione_residue' persistito in elaborazioni,
// per distinguerla nello storico da una prima esecuzione.
func EseguiRiassegnazioneResidua(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
	return eseguiRoundRobinConTipo(ctx, pool, stagioneID, semeHex, "riassegnazione_residue")
}
