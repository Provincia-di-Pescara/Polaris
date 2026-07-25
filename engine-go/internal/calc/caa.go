package calc

import (
	"fmt"

	"github.com/shopspring/decimal"
)

// ScaglioneCAA modella una riga di caa_scaglioni (art. A.7).
// AnniMin incluso, AnniMax escluso ("da X a meno di Y"). AnniMax = nil per l'ultimo scaglione (nessun limite).
type ScaglioneCAA struct {
	AnniMin decimal.Decimal
	AnniMax *decimal.Decimal
	CAA     decimal.Decimal
}

func LookupCAA(scaglioni []ScaglioneCAA, anniAttivita decimal.Decimal) (decimal.Decimal, error) {
	for _, s := range scaglioni {
		if anniAttivita.LessThan(s.AnniMin) {
			continue
		}
		if s.AnniMax != nil && !anniAttivita.LessThan(*s.AnniMax) {
			continue
		}
		return s.CAA, nil
	}
	return decimal.Zero, fmt.Errorf("nessuno scaglione CAA copre %s anni di attività", anniAttivita)
}
