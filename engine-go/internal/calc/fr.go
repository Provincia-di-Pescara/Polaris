package calc

import "github.com/shopspring/decimal"

// CalcolaFR implementa art. A.5: FR calcolato = (peso base + incremento squadre) x moltiplicatore,
// arrotondato a 3 cifre decimali. FR finale = min(FD, FR calcolato).
func CalcolaFR(pesoBase, incrementoSquadre int, moltiplicatoreMinutiPerPunto, fdMinuti decimal.Decimal) (frCalcolato, frFinale decimal.Decimal) {
	punteggio := decimal.NewFromInt(int64(pesoBase + incrementoSquadre))
	frCalcolato = punteggio.Mul(moltiplicatoreMinutiPerPunto).Round(3)
	frFinale = decimal.Min(fdMinuti, frCalcolato)
	return frCalcolato, frFinale
}
