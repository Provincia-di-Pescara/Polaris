package calc

import (
	"testing"

	"github.com/shopspring/decimal"
)

func decPtr(v string) *decimal.Decimal {
	d := decimal.RequireFromString(v)
	return &d
}

func scaglioniCAAReali() []ScaglioneCAA {
	return []ScaglioneCAA{
		{AnniMin: decimal.RequireFromString("0"), AnniMax: decPtr("2"), CAA: decimal.RequireFromString("0.90")},
		{AnniMin: decimal.RequireFromString("2"), AnniMax: decPtr("5"), CAA: decimal.RequireFromString("0.95")},
		{AnniMin: decimal.RequireFromString("5"), AnniMax: decPtr("10"), CAA: decimal.RequireFromString("1.00")},
		{AnniMin: decimal.RequireFromString("10"), AnniMax: decPtr("20"), CAA: decimal.RequireFromString("1.05")},
		{AnniMin: decimal.RequireFromString("20"), AnniMax: nil, CAA: decimal.RequireFromString("1.10")},
	}
}

func TestLookupCAA(t *testing.T) {
	casi := []struct {
		anni   string
		atteso string
	}{
		{"0", "0.90"},
		{"1.99", "0.90"},
		{"2", "0.95"}, // confine inferiore incluso
		{"4.99", "0.95"},
		{"5", "1.00"},
		{"9.99", "1.00"},
		{"10", "1.05"},
		{"19.99", "1.05"},
		{"20", "1.10"},
		{"99", "1.10"}, // scaglione senza limite superiore
	}

	scaglioni := scaglioniCAAReali()
	for _, c := range casi {
		got, err := LookupCAA(scaglioni, decimal.RequireFromString(c.anni))
		if err != nil {
			t.Fatalf("anni=%s: errore inatteso: %v", c.anni, err)
		}
		atteso := decimal.RequireFromString(c.atteso)
		if !got.Equal(atteso) {
			t.Errorf("LookupCAA(%s) = %s, atteso %s", c.anni, got, atteso)
		}
	}
}

func TestLookupCAA_AnniNegativi(t *testing.T) {
	_, err := LookupCAA(scaglioniCAAReali(), decimal.RequireFromString("-1"))
	if err == nil {
		t.Error("atteso errore per anni di attività negativi")
	}
}
