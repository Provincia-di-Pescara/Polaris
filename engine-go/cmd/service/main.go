// Comando service espone il motore (istruttoria + round-robin) via HTTP verso il
// backend Node. Legge DATABASE_URL e PORT dall'ambiente.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/provincia/palestre-engine/internal/gara"
	"github.com/provincia/palestre-engine/internal/httpapi"
	"github.com/provincia/palestre-engine/internal/postgres"
	"github.com/provincia/palestre-engine/internal/roundrobin"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL non impostata")
	}
	porta := os.Getenv("PORT")
	if porta == "" {
		porta = "8080"
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.NewPool(ctx, dsn)
	if err != nil {
		log.Fatalf("connessione a Postgres: %v", err)
	}
	defer pool.Close()

	server := &httpapi.Server{
		EseguiIstruttoria: func(ctx context.Context, stagioneID string) (int, error) {
			return postgres.EseguiIstruttoria(ctx, pool, stagioneID)
		},
		EseguiBlocchiGara: func(ctx context.Context, stagioneID, semeHex string) (gara.Esito, string, error) {
			return postgres.EseguiBlocchiGara(ctx, pool, stagioneID, semeHex)
		},
		EseguiRoundRobin: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			return postgres.EseguiRoundRobin(ctx, pool, stagioneID, semeHex)
		},
		EseguiRiassegnazioneResidua: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			return postgres.EseguiRiassegnazioneResidua(ctx, pool, stagioneID, semeHex)
		},
	}

	httpServer := &http.Server{
		Addr:              ":" + porta,
		Handler:           server.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("motore in ascolto su :%s", porta)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server HTTP: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("arresto in corso...")

	ctxShutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctxShutdown); err != nil {
		log.Printf("errore durante l'arresto: %v", err)
	}
}
