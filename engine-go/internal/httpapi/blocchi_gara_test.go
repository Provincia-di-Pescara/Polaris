package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/provincia/palestre-engine/internal/gara"
)

func TestBlocchiGaraGeneraSemeEChiamaEsecuzione(t *testing.T) {
	var stagioneRicevuta, semeRicevuto string
	srv := &Server{
		EseguiBlocchiGara: func(_ context.Context, stagioneID, semeHex string) (gara.Esito, string, error) {
			stagioneRicevuta = stagioneID
			semeRicevuto = semeHex
			return gara.Esito{
				Assegnazioni: []gara.Assegnazione{{RichiestaID: "r1", AssociazioneID: "a1", SlotIDs: []string{"s1", "s2"}}},
				NonAssegnate: []string{"r2"},
			}, "elab-gara-1", nil
		},
		GeneraSeme: func() (string, error) { return "seme-deterministico-test", nil },
	}

	req := httptest.NewRequest(http.MethodPost, "/stagioni/stag-1/blocchi-gara", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, atteso 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if stagioneRicevuta != "stag-1" || semeRicevuto != "seme-deterministico-test" {
		t.Fatalf("parametri passati errati: stagione=%q seme=%q", stagioneRicevuta, semeRicevuto)
	}

	var body struct {
		ElaborazioneID     string `json:"elaborazione_id"`
		NumeroAssegnazioni int    `json:"numero_assegnazioni"`
		NonAssegnate       int    `json:"richieste_non_assegnate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.ElaborazioneID != "elab-gara-1" || body.NumeroAssegnazioni != 1 || body.NonAssegnate != 1 {
		t.Fatalf("body inatteso: %+v", body)
	}
}
