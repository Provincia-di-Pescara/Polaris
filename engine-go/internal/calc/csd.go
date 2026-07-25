package calc

import (
	"fmt"

	"github.com/shopspring/decimal"
)

// ScaglioneCSD modella una riga di csd_scaglioni (art. A.11).
// RapportoMin incluso, RapportoMax escluso. RapportoMax = nil per l'ultimo scaglione (nessun limite).
type ScaglioneCSD struct {
	RapportoMin  decimal.Decimal
	RapportoMax  *decimal.Decimal
	Coefficiente decimal.Decimal
}

func LookupCSD(scaglioni []ScaglioneCSD, rapportoFDFR decimal.Decimal) (decimal.Decimal, error) {
	for _, s := range scaglioni {
		if rapportoFDFR.LessThan(s.RapportoMin) {
			continue
		}
		if s.RapportoMax != nil && !rapportoFDFR.LessThan(*s.RapportoMax) {
			continue
		}
		return s.Coefficiente, nil
	}
	return decimal.Zero, fmt.Errorf("nessuno scaglione CSD copre rapporto FD/FR %s", rapportoFDFR)
}
