package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/provincia/palestre-engine/internal/istruttoria"
	"github.com/provincia/palestre-engine/internal/roundrobin"
	"github.com/shopspring/decimal"
)

func TestHealthz(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200", rec.Code)
	}
}

func TestIstruttoria_Successo(t *testing.T) {
	var stagioneRicevuta string
	s := &Server{
		EseguiIstruttoria: func(ctx context.Context, stagioneID string) (int, error) {
			stagioneRicevuta = stagioneID
			return 3, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/stagione-42/istruttoria", nil)
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200, body: %s", rec.Code, rec.Body.String())
	}
	if stagioneRicevuta != "stagione-42" {
		t.Errorf("stagione_id passato = %s, atteso stagione-42", stagioneRicevuta)
	}

	var body struct {
		DomandeCalcolate int `json:"domande_calcolate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("risposta non JSON valido: %v (body: %s)", err, rec.Body.String())
	}
	if body.DomandeCalcolate != 3 {
		t.Errorf("domande_calcolate = %d, atteso 3", body.DomandeCalcolate)
	}
}

func TestIstruttoria_ErroreServizio(t *testing.T) {
	s := &Server{
		EseguiIstruttoria: func(ctx context.Context, stagioneID string) (int, error) {
			return 0, errors.New("boom")
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/x/istruttoria", nil)
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, atteso 500", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "boom") {
		t.Errorf("body non contiene il messaggio di errore: %s", rec.Body.String())
	}
}

func TestPrimaAssegnazione_Successo(t *testing.T) {
	var semeUsato, stagioneRicevuta string
	s := &Server{
		GeneraSeme: func() (string, error) { return "seme-di-test", nil },
		EseguiRoundRobin: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			stagioneRicevuta = stagioneID
			semeUsato = semeHex
			return roundrobin.Esito{
				Assegnazioni:  []roundrobin.Assegnazione{{FasciaID: "f1"}, {FasciaID: "f2"}},
				RoundEseguiti: 2,
			}, "elab-123", nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/stagione-7/prima-assegnazione", nil)
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200, body: %s", rec.Code, rec.Body.String())
	}
	if stagioneRicevuta != "stagione-7" {
		t.Errorf("stagione_id passato = %s, atteso stagione-7", stagioneRicevuta)
	}
	if semeUsato != "seme-di-test" {
		t.Errorf("seme passato a EseguiRoundRobin = %s, atteso quello di GeneraSeme", semeUsato)
	}

	var body struct {
		ElaborazioneID     string `json:"elaborazione_id"`
		NumeroAssegnazioni int    `json:"numero_assegnazioni"`
		RoundEseguiti      int    `json:"round_eseguiti"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("risposta non JSON valido: %v", err)
	}
	if body.ElaborazioneID != "elab-123" || body.NumeroAssegnazioni != 2 || body.RoundEseguiti != 2 {
		t.Errorf("body = %+v, atteso elaborazione_id=elab-123 numero_assegnazioni=2 round_eseguiti=2", body)
	}
}

func TestPrimaAssegnazione_ErroreGenerazioneSeme(t *testing.T) {
	s := &Server{
		GeneraSeme: func() (string, error) { return "", errors.New("csprng non disponibile") },
		EseguiRoundRobin: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			t.Fatal("EseguiRoundRobin non dovrebbe essere chiamato se la generazione del seme fallisce")
			return roundrobin.Esito{}, "", nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/x/prima-assegnazione", nil)
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, atteso 500", rec.Code)
	}
}

func TestRiassegnazioneResidua_Successo(t *testing.T) {
	var semeUsato, stagioneRicevuta string
	s := &Server{
		GeneraSeme: func() (string, error) { return "seme-di-test", nil },
		EseguiRiassegnazioneResidua: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			stagioneRicevuta = stagioneID
			semeUsato = semeHex
			return roundrobin.Esito{
				Assegnazioni:  []roundrobin.Assegnazione{{FasciaID: "f1"}},
				RoundEseguiti: 1,
			}, "elab-residuo-1", nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/stagione-9/riassegnazione-residua", nil)
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200, body: %s", rec.Code, rec.Body.String())
	}
	if stagioneRicevuta != "stagione-9" {
		t.Errorf("stagione_id passato = %s, atteso stagione-9", stagioneRicevuta)
	}
	if semeUsato != "seme-di-test" {
		t.Errorf("seme passato a EseguiRiassegnazioneResidua = %s, atteso quello di GeneraSeme", semeUsato)
	}

	var body struct {
		ElaborazioneID     string `json:"elaborazione_id"`
		NumeroAssegnazioni int    `json:"numero_assegnazioni"`
		RoundEseguiti      int    `json:"round_eseguiti"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("risposta non JSON valido: %v", err)
	}
	if body.ElaborazioneID != "elab-residuo-1" || body.NumeroAssegnazioni != 1 || body.RoundEseguiti != 1 {
		t.Errorf("body = %+v, atteso elaborazione_id=elab-residuo-1 numero_assegnazioni=1 round_eseguiti=1", body)
	}
}

func TestRiassegnazioneResidua_ErroreGenerazioneSeme(t *testing.T) {
	s := &Server{
		GeneraSeme: func() (string, error) { return "", errors.New("csprng non disponibile") },
		EseguiRiassegnazioneResidua: func(ctx context.Context, stagioneID, semeHex string) (roundrobin.Esito, string, error) {
			t.Fatal("EseguiRiassegnazioneResidua non dovrebbe essere chiamato se la generazione del seme fallisce")
			return roundrobin.Esito{}, "", nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/x/riassegnazione-residua", nil)
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, atteso 500", rec.Code)
	}
}

func TestAnteprimaFabbisogno_Successo(t *testing.T) {
	var richiestaRicevuta AnteprimaFabbisognoRequest
	s := &Server{
		AnteprimaFabbisogno: func(ctx context.Context, dati AnteprimaFabbisognoRequest) (istruttoria.Fabbisogno, istruttoria.Coefficienti, error) {
			richiestaRicevuta = dati
			return istruttoria.Fabbisogno{PesoBase: 2, IncrementoSquadre: 1, FRCalcolato: decimal.NewFromInt(180), FRFinale: decimal.NewFromInt(180)},
				istruttoria.Coefficienti{CRS: decimal.NewFromFloat(1.1), CAA: decimal.NewFromInt(1), CSD: decimal.NewFromInt(1), CP: decimal.NewFromFloat(1.1)},
				nil
		},
	}

	corpo := `{"associazione_id":"ass-1","stagione_id":"stag-1","classe_attivita_codice":"B","numero_squadre_federali":3,"fd_minuti":"200"}`
	req := httptest.NewRequest(http.MethodPost, "/anteprima-fabbisogno", strings.NewReader(corpo))
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200, body: %s", rec.Code, rec.Body.String())
	}
	if richiestaRicevuta.AssociazioneID != "ass-1" || richiestaRicevuta.ClasseAttivitaCodice != "B" {
		t.Errorf("richiesta non deserializzata correttamente: %+v", richiestaRicevuta)
	}

	var body struct {
		FRFinaleMinuti string `json:"fr_finale_minuti"`
		CRS            string `json:"crs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal risposta: %v", err)
	}
	if body.FRFinaleMinuti != "180" {
		t.Errorf("fr_finale_minuti = %s, atteso 180", body.FRFinaleMinuti)
	}
}

func TestAnteprimaFabbisogno_CorpoMalformato(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/anteprima-fabbisogno", strings.NewReader("{non è json"))
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, atteso 400", rec.Code)
	}
}

func TestGeneraSemeCSPRNG_ProduceEsadecimale64Caratteri(t *testing.T) {
	seme, err := GeneraSemeCSPRNG()
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if len(seme) != 64 {
		t.Errorf("lunghezza seme = %d, attesi 64 caratteri hex (32 byte)", len(seme))
	}
	seme2, err := GeneraSemeCSPRNG()
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if seme == seme2 {
		t.Error("due generazioni consecutive hanno prodotto lo stesso seme, atteso CSPRNG con output diverso")
	}
}
