package calc

import (
	"testing"

	"github.com/shopspring/decimal"
)

func TestCalcolaCP(t *testing.T) {
	// art. A.12: CP = CRS x CAA x CSD, arrotondato a 3 cifre decimali (decisione stakeholder).
	crs := decimal.RequireFromString("1.35")  // Classe C regionale
	caa := decimal.RequireFromString("1.05")  // 10-20 anni
	csd := decimal.RequireFromString("0.950") // primo scaglione sopra 1.0

	got := CalcolaCP(crs, caa, csd)

	// 1.35 * 1.05 * 0.950 = 1.346625 -> arrotondato a 3 cifre = 1.347
	atteso := decimal.RequireFromString("1.347")
	if !got.Equal(atteso) {
		t.Errorf("CalcolaCP = %s, atteso %s", got, atteso)
	}
}

func TestCalcolaCP_ValoriNeutri(t *testing.T) {
	uno := decimal.RequireFromString("1.000")
	got := CalcolaCP(uno, uno, uno)
	if !got.Equal(uno) {
		t.Errorf("CalcolaCP(1,1,1) = %s, atteso 1.000", got)
	}
}
