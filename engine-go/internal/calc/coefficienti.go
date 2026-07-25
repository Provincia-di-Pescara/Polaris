package calc

import (
	"fmt"

	"github.com/shopspring/decimal"
)

// ScaglioneCRS modella una riga di crs_scaglioni (art. A.6).
// Livello = nil per le classi che non lo prevedono (tutte tranne C).
type ScaglioneCRS struct {
	ClasseCodice string
	Livello      *string
	CRS          decimal.Decimal
}

func livelloUguale(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func LookupCRS(scaglioni []ScaglioneCRS, classe string, livello *string) (decimal.Decimal, error) {
	for _, s := range scaglioni {
		if s.ClasseCodice == classe && livelloUguale(s.Livello, livello) {
			return s.CRS, nil
		}
	}
	return decimal.Zero, fmt.Errorf("nessuno scaglione CRS per classe=%s livello=%v", classe, livello)
}
