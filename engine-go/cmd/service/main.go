// Comando service espone il motore (istruttoria + round-robin) via HTTP verso il
// backend Node. Legge DATABASE_URL e PORT dall'ambiente.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
	"github.com/provincia/palestre-engine/internal/gara"
	"github.com/provincia/palestre-engine/internal/httpapi"
	"github.com/provincia/palestre-engine/internal/istruttoria"
	"github.com/provincia/palestre-engine/internal/postgres"
	"github.com/provincia/palestre-engine/internal/roundrobin"
)

// leggiVersioneBuild legge l'identità di build reale (tag git o dev-<sha>,
// decisa da release.yml), baked nell'immagine a build time in un file — non
// un env var IMAGE_TAG letto a runtime: quel canale è mobile su dev/latest,
// quindi identico per build diverse e inutile per distinguerle in Sentry.
// Stesso schema in backend-node.
func leggiVersioneBuild() string {
	dati, err := os.ReadFile("/etc/polaris-build-version")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(dati))
}

func main() {
	// Opzionale per costruzione: mai un requisito per far girare il motore
	// (test/CI restano invariati senza SENTRY_DSN). sendDefaultPii resta false
	// (default della libreria) -- dati GDPR-sensibili, mai PII implicita.
	if sentryDSN := os.Getenv("SENTRY_DSN"); sentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:         sentryDSN,
			Environment: os.Getenv("SENTRY_ENVIRONMENT"),
			Release:     leggiVersioneBuild(),
		}); err != nil {
			log.Printf("inizializzazione Sentry fallita (non bloccante): %v", err)
		}
		defer sentry.Flush(2 * time.Second)
	}

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
		AnteprimaFabbisogno: func(ctx context.Context, dati httpapi.AnteprimaFabbisognoRequest) (istruttoria.Fabbisogno, istruttoria.Coefficienti, error) {
			return postgres.CaricaAnteprimaFabbisogno(ctx, pool, postgres.DatiAnteprimaFabbisogno{
				AssociazioneID:        dati.AssociazioneID,
				StagioneID:            dati.StagioneID,
				ClasseAttivitaCodice:  dati.ClasseAttivitaCodice,
				LivelloCampionato:     dati.LivelloCampionato,
				NumeroSquadreFederali: dati.NumeroSquadreFederali,
				FDMinuti:              dati.FDMinuti,
			})
		},
	}

	// sentryHandler è un wrapper sicuro anche senza SENTRY_DSN (nessun client Sentry
	// inizializzato => no-op) -- cattura i panic che sfuggono agli handler (scriviErrore
	// in httpapi.go copre invece gli errori applicativi già gestiti, vedi lì).
	sentryHandler := sentryhttp.New(sentryhttp.Options{Repanic: true})

	httpServer := &http.Server{
		Addr:              ":" + porta,
		Handler:           sentryHandler.Handle(server.Routes()),
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
