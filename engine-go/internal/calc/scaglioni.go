package calc

import "fmt"

// ScaglioneSquadre modella una riga di incremento_squadre_scaglioni (art. A.4).
// SquadreMax = nil significa nessun limite superiore.
type ScaglioneSquadre struct {
	SquadreMin int
	SquadreMax *int
	Incremento int
}

func IncrementoSquadre(scaglioni []ScaglioneSquadre, numeroSquadre int) (int, error) {
	for _, s := range scaglioni {
		if numeroSquadre < s.SquadreMin {
			continue
		}
		if s.SquadreMax != nil && numeroSquadre > *s.SquadreMax {
			continue
		}
		return s.Incremento, nil
	}
	return 0, fmt.Errorf("nessuno scaglione incremento squadre copre %d squadre", numeroSquadre)
}
