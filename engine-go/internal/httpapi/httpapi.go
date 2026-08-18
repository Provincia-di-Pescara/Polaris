// Package httpapi espone il motore (istruttoria + round-robin) via HTTP/JSON verso il
// backend Node. Le dipendenze verso Postgres sono iniettate come funzioni (non
// un'interfaccia con più metodi), così i test della logica HTTP non richiedono un DB reale.
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/provincia/palestre-engine/internal/gara"
	"github.com/provincia/palestre-engine/internal/istruttoria"
	"github.com/provincia/palestre-engine/internal/roundrobin"
)

// Server raccoglie le dipendenze necessarie agli handler. GeneraSeme, se nil, usa
// GeneraSemeCSPRNG di default (iniettabile nei test per un seme deterministico).
type Server struct {
	EseguiIstruttoria           func(ctx context.Context, stagioneID string) (int, error)
	EseguiBlocchiGara           func(ctx context.Context, stagioneID, semeHex string) (gara.Esito, string, error)
	EseguiRoundRobin            func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error)
	EseguiRiassegnazioneResidua func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error)
	GeneraSeme                  func() (string, error)
	AnteprimaFabbisogno         func(ctx context.Context, dati AnteprimaFabbisognoRequest) (istruttoria.Fabbisogno, istruttoria.Coefficienti, error)
}

// GeneraSemeCSPRNG implementa il requisito dell'art. B.38: seme casuale generato con
// CSPRNG prima dell'elaborazione, 32 byte, encoding esadecimale.
func GeneraSemeCSPRNG() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generazione seme: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// Routes registra gli endpoint. Pattern con path param nativi (Go 1.22+), nessun router esterno.
func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("POST /stagioni/{id}/istruttoria", s.handleIstruttoria)
	mux.HandleFunc("POST /stagioni/{id}/blocchi-gara", s.handleBlocchiGara)
	mux.HandleFunc("POST /stagioni/{id}/prima-assegnazione", s.handlePrimaAssegnazione)
	mux.HandleFunc("POST /stagioni/{id}/riassegnazione-residua", s.handleRiassegnazioneResidua)
	mux.HandleFunc("POST /anteprima-fabbisogno", s.handleAnteprimaFabbisogno)
	return mux
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) handleIstruttoria(w http.ResponseWriter, r *http.Request) {
	stagioneID := r.PathValue("id")

	n, err := s.EseguiIstruttoria(r.Context(), stagioneID)
	if err != nil {
		scriviErrore(w, err)
		return
	}

	scriviJSON(w, http.StatusOK, map[string]any{
		"domande_calcolate": n,
	})
}

// handleBlocchiGara esegue la Fase 6 (art. B.12-B.14): come per la prima assegnazione,
// il seme del sorteggio è generato QUI, prima dell'elaborazione (art. B.38).
func (s *Server) handleBlocchiGara(w http.ResponseWriter, r *http.Request) {
	stagioneID := r.PathValue("id")

	generaSeme := s.GeneraSeme
	if generaSeme == nil {
		generaSeme = GeneraSemeCSPRNG
	}
	seme, err := generaSeme()
	if err != nil {
		scriviErrore(w, err)
		return
	}

	esito, elaborazioneID, err := s.EseguiBlocchiGara(r.Context(), stagioneID, seme)
	if err != nil {
		scriviErrore(w, err)
		return
	}

	scriviJSON(w, http.StatusOK, map[string]any{
		"elaborazione_id":         elaborazioneID,
		"numero_assegnazioni":     len(esito.Assegnazioni),
		"richieste_non_assegnate": len(esito.NonAssegnate),
	})
}

func (s *Server) handlePrimaAssegnazione(w http.ResponseWriter, r *http.Request) {
	stagioneID := r.PathValue("id")

	generaSeme := s.GeneraSeme
	if generaSeme == nil {
		generaSeme = GeneraSemeCSPRNG
	}
	seme, err := generaSeme()
	if err != nil {
		scriviErrore(w, err)
		return
	}

	esito, elaborazioneID, err := s.EseguiRoundRobin(r.Context(), stagioneID, seme)
	if err != nil {
		scriviErrore(w, err)
		return
	}

	scriviJSON(w, http.StatusOK, map[string]any{
		"elaborazione_id":     elaborazioneID,
		"numero_assegnazioni": len(esito.Assegnazioni),
		"round_eseguiti":      esito.RoundEseguiti,
	})
}

// handleRiassegnazioneResidua esegue l'art. B.29: come le altre elaborazioni, il seme
// del sorteggio è generato QUI, prima dell'elaborazione (art. B.38) — anche una
// riassegnazione residua può richiedere sorteggi (B.21) tra i candidati rimasti.
func (s *Server) handleRiassegnazioneResidua(w http.ResponseWriter, r *http.Request) {
	stagioneID := r.PathValue("id")

	generaSeme := s.GeneraSeme
	if generaSeme == nil {
		generaSeme = GeneraSemeCSPRNG
	}
	seme, err := generaSeme()
	if err != nil {
		scriviErrore(w, err)
		return
	}

	esito, elaborazioneID, err := s.EseguiRiassegnazioneResidua(r.Context(), stagioneID, seme)
	if err != nil {
		scriviErrore(w, err)
		return
	}

	scriviJSON(w, http.StatusOK, map[string]any{
		"elaborazione_id":     elaborazioneID,
		"numero_assegnazioni": len(esito.Assegnazioni),
		"round_eseguiti":      esito.RoundEseguiti,
	})
}

// AnteprimaFabbisognoRequest è il body JSON del wizard di presentazione domanda —
// primo endpoint del motore che legge un body invece di soli path param.
type AnteprimaFabbisognoRequest struct {
	AssociazioneID        string  `json:"associazione_id"`
	StagioneID            string  `json:"stagione_id"`
	ClasseAttivitaCodice  string  `json:"classe_attivita_codice"`
	LivelloCampionato     *string `json:"livello_campionato"`
	NumeroSquadreFederali int     `json:"numero_squadre_federali"`
	FDMinuti              string  `json:"fd_minuti"`
}

func (s *Server) handleAnteprimaFabbisogno(w http.ResponseWriter, r *http.Request) {
	var req AnteprimaFabbisognoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		scriviJSON(w, http.StatusBadRequest, map[string]any{"errore": "corpo della richiesta non valido: " + err.Error()})
		return
	}

	fabbisogno, coeff, err := s.AnteprimaFabbisogno(r.Context(), req)
	if err != nil {
		scriviErrore(w, err)
		return
	}

	scriviJSON(w, http.StatusOK, map[string]any{
		"peso_base":           fabbisogno.PesoBase,
		"incremento_squadre":  fabbisogno.IncrementoSquadre,
		"fr_calcolato_minuti": fabbisogno.FRCalcolato.String(),
		"fr_finale_minuti":    fabbisogno.FRFinale.String(),
		"crs":                 coeff.CRS.String(),
		"caa":                 coeff.CAA.String(),
		"csd":                 coeff.CSD.String(),
		"cp":                  coeff.CP.String(),
	})
}

func scriviJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func scriviErrore(w http.ResponseWriter, err error) {
	scriviJSON(w, http.StatusInternalServerError, map[string]any{
		"errore": err.Error(),
	})
}
