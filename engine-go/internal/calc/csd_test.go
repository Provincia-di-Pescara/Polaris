package calc

import (
	"testing"

	"github.com/shopspring/decimal"
)

func scaglioniCSDPlaceholder() []ScaglioneCSD {
	return []ScaglioneCSD{
		{RapportoMin: decimal.RequireFromString("0.000"), RapportoMax: decPtr("1.000"), Coefficiente: decimal.RequireFromString("1.000")},
		{RapportoMin: decimal.RequireFromString("1.000"), RapportoMax: decPtr("1.500"), Coefficiente: decimal.RequireFromString("0.950")},
		{RapportoMin: decimal.RequireFromString("1.500"), RapportoMax: decPtr("2.000"), Coefficiente: decimal.RequireFromString("0.900")},
		{RapportoMin: decimal.RequireFromString("2.000"), RapportoMax: nil, Coefficiente: decimal.RequireFromString("0.850")},
	}
}

func TestLookupCSD(t *testing.T) {
	casi := []struct {
		rapporto string
		atteso   string
	}{
		{"0", "1.000"},
		{"0.999", "1.000"},
		{"1.000", "0.950"}, // confine inferiore incluso nello scaglione successivo
		{"1.499", "0.950"},
		{"1.500", "0.900"},
		{"1.999", "0.900"},
		{"2.000", "0.850"},
		{"50", "0.850"}, // scaglione senza limite superiore
	}

	scaglioni := scaglioniCSDPlaceholder()
	for _, c := range casi {
		got, err := LookupCSD(scaglioni, decimal.RequireFromString(c.rapporto))
		if err != nil {
			t.Fatalf("rapporto=%s: errore inatteso: %v", c.rapporto, err)
		}
		atteso := decimal.RequireFromString(c.atteso)
		if !got.Equal(atteso) {
			t.Errorf("LookupCSD(%s) = %s, atteso %s", c.rapporto, got, atteso)
		}
	}
}

func TestLookupCSD_RapportoNegativo(t *testing.T) {
	_, err := LookupCSD(scaglioniCSDPlaceholder(), decimal.RequireFromString("-1"))
	if err == nil {
		t.Error("atteso errore per rapporto FD/FR negativo")
	}
}
