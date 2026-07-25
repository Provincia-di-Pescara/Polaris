package calc

import "github.com/shopspring/decimal"

// CalcolaCP implementa art. A.12: CP = CRS x CAA x CSD, arrotondato a 3 cifre decimali.
func CalcolaCP(crs, caa, csd decimal.Decimal) decimal.Decimal {
	return crs.Mul(caa).Mul(csd).Round(3)
}
