package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/provincia/palestre-engine/internal/roundrobin"
)

// EseguiRoundRobin implementa la Fase 8 completa end-to-end: carica il parametrico
// attivo e lo snapshot della stagione, esegue il round-robin (art. B.17-22) e persiste
// il risultato in transazione. Richiede che EseguiIstruttoria sia già stato eseguito.
func EseguiRoundRobin(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
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

	elaborazioneID, err := PersistiEsitoRoundRobin(ctx, pool, stagioneID, parametrico.VersioneID, snapshot, esito)
	if err != nil {
		return roundrobin.Esito{}, "", err
	}

	return esito, elaborazioneID, nil
}
