package calc

import "github.com/shopspring/decimal"

// CalcolaISF implementa art. A.13/B.16: ISF = VA / FR, arrotondato a 3 cifre decimali.
// Se FR = 0 l'ISF non è definito (decisione stakeholder: associazione che richiede solo
// giornata di gara, senza fabbisogno allenamento — esclusa per definizione dal round-robin,
// mai confrontata).
func CalcolaISF(va, fr decimal.Decimal) (isf decimal.Decimal, definito bool) {
	if fr.IsZero() {
		return decimal.Zero, false
	}
	return va.DivRound(fr, 3), true
}

// ISFMinore confronta due ISF già arrotondati a 3 cifre (art. A.13: priorità al valore più basso).
func ISFMinore(a, b decimal.Decimal) bool {
	return a.LessThan(b)
}

// ISFInTolleranza implementa la tolleranza di parità dell'art. B.20 (default 0,5% = 0.005).
func ISFInTolleranza(a, b, tolleranza decimal.Decimal) bool {
	diff := a.Sub(b).Abs()
	return !diff.GreaterThan(tolleranza)
}
