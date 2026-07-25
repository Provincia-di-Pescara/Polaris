package calc

import (
	"testing"

	"github.com/shopspring/decimal"
)

func TestCalcolaFR_CalcolatoInferioreAlDichiarato(t *testing.T) {
	// art. A.5: FR calcolato = (peso base + incremento squadre) x moltiplicatore, arrotondato a 3 cifre.
	// FR finale = min(FD, FR calcolato).
	pesoBase := 2                                         // Classe B
	incrementoSquadre := 1                                // 2-3 squadre federali
	moltiplicatore := decimal.RequireFromString("60.000") // placeholder di sviluppo
	fd := decimal.RequireFromString("500.000")            // fabbisogno dichiarato ampio

	frCalcolato, frFinale := CalcolaFR(pesoBase, incrementoSquadre, moltiplicatore, fd)

	attesoCalcolato := decimal.RequireFromString("180.000") // (2+1)*60
	if !frCalcolato.Equal(attesoCalcolato) {
		t.Errorf("frCalcolato = %s, atteso %s", frCalcolato, attesoCalcolato)
	}
	if !frFinale.Equal(attesoCalcolato) {
		t.Errorf("frFinale = %s, atteso %s (FD ampio, tetto = calcolato)", frFinale, attesoCalcolato)
	}
}

func TestCalcolaFR_DichiaratoInferioreAlCalcolato(t *testing.T) {
	// FD più basso del calcolato: FR finale = min(FD, FR calcolato) = FD (art. A.5).
	pesoBase := 4          // Classe E
	incrementoSquadre := 3 // >6 squadre
	moltiplicatore := decimal.RequireFromString("60.000")
	fd := decimal.RequireFromString("100.000") // FD basso rispetto al calcolato (7*60=420)

	frCalcolato, frFinale := CalcolaFR(pesoBase, incrementoSquadre, moltiplicatore, fd)

	attesoCalcolato := decimal.RequireFromString("420.000")
	if !frCalcolato.Equal(attesoCalcolato) {
		t.Errorf("frCalcolato = %s, atteso %s", frCalcolato, attesoCalcolato)
	}
	attesoFinale := decimal.RequireFromString("100.000")
	if !frFinale.Equal(attesoFinale) {
		t.Errorf("frFinale = %s, atteso %s (tetto = FD)", frFinale, attesoFinale)
	}
}

func TestCalcolaFR_FDZero(t *testing.T) {
	// decisione stakeholder Q3: associazione che chiede solo giornata di gara, FD=0 -> FR finale = 0.
	pesoBase := 1
	incrementoSquadre := 0
	moltiplicatore := decimal.RequireFromString("60.000")
	fd := decimal.Zero

	_, frFinale := CalcolaFR(pesoBase, incrementoSquadre, moltiplicatore, fd)

	if !frFinale.IsZero() {
		t.Errorf("frFinale = %s, atteso 0 quando FD=0", frFinale)
	}
}
