// Package postgres è il layer di persistenza attorno al motore puro
// (calc/istruttoria/roundrobin/sorteggio): legge lo snapshot necessario da Postgres,
// lo mappa ai tipi del motore, esegue il calcolo e scrive i risultati in transazione.
package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool apre un connection pool verso Postgres. dsn nel formato
// postgres://user:pass@host:port/db.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, dsn)
}
