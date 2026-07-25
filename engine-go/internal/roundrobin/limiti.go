package roundrobin

// LimitiConcentrazione sono le soglie dell'art. 11 Doc Principale / art. B.19.
// MinutiSettimanaliMax è confrontato sui minuti GREZZI (decisione stakeholder: la
// ponderazione fasce pregiate vale solo per VA/ISF, non per il tetto di concentrazione).
type LimitiConcentrazione struct {
	MinutiSettimanaliMax  int
	SlotMaxStessoImpianto int
	FascePregiateMax      int
	GiornateGaraMax       int
}

// StatoConcentrazione è l'accumulo corrente per una singola associazione durante il
// round-robin (aggiornato dopo ogni assegnazione).
type StatoConcentrazione struct {
	MinutiGrezziAssegnati  int
	SlotPerImpianto        map[string]int
	FascePregiateAssegnate int
}

// RispettaLimiti verifica se assegnare fascia allo stato corrente violerebbe uno dei
// limiti di concentrazione (art. B.19, ultimo criterio di ammissibilità candidati).
func RispettaLimiti(stato StatoConcentrazione, limiti LimitiConcentrazione, fascia Fascia) bool {
	if stato.MinutiGrezziAssegnati+fascia.DurataMinutiGrezzi > limiti.MinutiSettimanaliMax {
		return false
	}
	if stato.SlotPerImpianto[fascia.ImpiantoID]+1 > limiti.SlotMaxStessoImpianto {
		return false
	}
	if fascia.Pregiata && stato.FascePregiateAssegnate+1 > limiti.FascePregiateMax {
		return false
	}
	return true
}

// RispettaLimiteGiornateGara verifica il limite separato sul numero di giornate di gara
// (blocco multi-fascia, non un singolo slot: gestito a parte da RispettaLimiti).
func RispettaLimiteGiornateGara(giornateGaraAssegnate int, limiti LimitiConcentrazione) bool {
	return giornateGaraAssegnate+1 <= limiti.GiornateGaraMax
}
