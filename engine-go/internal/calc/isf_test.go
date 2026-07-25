package calc

import (
	"testing"

	"github.com/shopspring/decimal"
)

func TestCalcolaISF_FRPositivo(t *testing.T) {
	va := decimal.RequireFromString("90.000")
	fr := decimal.RequireFromString("180.000")

	isf, definito := CalcolaISF(va, fr)

	if !definito {
		t.Fatal("atteso ISF definito quando FR > 0")
	}
	atteso := decimal.RequireFromString("0.500")
	if !isf.Equal(atteso) {
		t.Errorf("CalcolaISF = %s, atteso %s", isf, atteso)
	}
}

func TestCalcolaISF_ArrotondamentoTreCifre(t *testing.T) {
	va := decimal.RequireFromString("100")
	fr := decimal.RequireFromString("300") // 0.333333...

	isf, definito := CalcolaISF(va, fr)

	if !definito {
		t.Fatal("atteso ISF definito")
	}
	atteso := decimal.RequireFromString("0.333")
	if !isf.Equal(atteso) {
		t.Errorf("CalcolaISF = %s, atteso %s", isf, atteso)
	}
}

func TestCalcolaISF_FRZero(t *testing.T) {
	// decisione stakeholder Q3: FR=0 -> ISF non definito (associazione già "soddisfatta" per definizione).
	va := decimal.RequireFromString("0")
	fr := decimal.Zero

	_, definito := CalcolaISF(va, fr)

	if definito {
		t.Error("atteso ISF non definito quando FR = 0")
	}
}

func TestISFMinore(t *testing.T) {
	a := decimal.RequireFromString("0.300")
	b := decimal.RequireFromString("0.500")

	if !ISFMinore(a, b) {
		t.Error("atteso 0.300 < 0.500")
	}
	if ISFMinore(b, a) {
		t.Error("non atteso 0.500 < 0.300")
	}
	if ISFMinore(a, a) {
		t.Error("non atteso a < a")
	}
}

func TestISFInTolleranza(t *testing.T) {
	tolleranza := decimal.RequireFromString("0.0050") // 0,5% (decisione stakeholder Q2)

	casi := []struct {
		a, b   string
		atteso bool
	}{
		{"0.500", "0.500", true},
		{"0.500", "0.505", true},   // esattamente al confine (differenza = tolleranza)
		{"0.500", "0.5051", false}, // appena sopra il confine
		{"0.500", "0.600", false},
	}

	for _, c := range casi {
		a := decimal.RequireFromString(c.a)
		b := decimal.RequireFromString(c.b)
		got := ISFInTolleranza(a, b, tolleranza)
		if got != c.atteso {
			t.Errorf("ISFInTolleranza(%s, %s) = %v, atteso %v", c.a, c.b, got, c.atteso)
		}
	}
}
