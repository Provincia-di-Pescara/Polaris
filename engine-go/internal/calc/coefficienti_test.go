package calc

import (
	"testing"

	"github.com/shopspring/decimal"
)

func strPtr(v string) *string { return &v }

func scaglioniCRSReali() []ScaglioneCRS {
	return []ScaglioneCRS{
		{ClasseCodice: "A", Livello: nil, CRS: decimal.RequireFromString("1.00")},
		{ClasseCodice: "B", Livello: nil, CRS: decimal.RequireFromString("1.10")},
		{ClasseCodice: "C", Livello: strPtr("provinciale"), CRS: decimal.RequireFromString("1.20")},
		{ClasseCodice: "C", Livello: strPtr("regionale"), CRS: decimal.RequireFromString("1.35")},
		{ClasseCodice: "D", Livello: nil, CRS: decimal.RequireFromString("1.60")},
		{ClasseCodice: "E", Livello: nil, CRS: decimal.RequireFromString("2.00")},
	}
}

func TestLookupCRS_ClasseSenzaLivello(t *testing.T) {
	got, err := LookupCRS(scaglioniCRSReali(), "A", nil)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	atteso := decimal.RequireFromString("1.00")
	if !got.Equal(atteso) {
		t.Errorf("LookupCRS(A, nil) = %s, atteso %s", got, atteso)
	}
}

func TestLookupCRS_ClasseCConLivelloProvinciale(t *testing.T) {
	got, err := LookupCRS(scaglioniCRSReali(), "C", strPtr("provinciale"))
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	atteso := decimal.RequireFromString("1.20")
	if !got.Equal(atteso) {
		t.Errorf("LookupCRS(C, provinciale) = %s, atteso %s", got, atteso)
	}
}

func TestLookupCRS_ClasseCConLivelloRegionale(t *testing.T) {
	got, err := LookupCRS(scaglioniCRSReali(), "C", strPtr("regionale"))
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	atteso := decimal.RequireFromString("1.35")
	if !got.Equal(atteso) {
		t.Errorf("LookupCRS(C, regionale) = %s, atteso %s", got, atteso)
	}
}

func TestLookupCRS_ClasseSconosciuta(t *testing.T) {
	_, err := LookupCRS(scaglioniCRSReali(), "Z", nil)
	if err == nil {
		t.Error("atteso errore per classe sconosciuta")
	}
}
