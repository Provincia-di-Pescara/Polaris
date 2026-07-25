package roundrobin

import "testing"

func TestRispettaLimiti_MinutiSettimanaliMax(t *testing.T) {
	limiti := LimitiConcentrazione{MinutiSettimanaliMax: 600, SlotMaxStessoImpianto: 99, FascePregiateMax: 99}
	stato := StatoConcentrazione{MinutiGrezziAssegnati: 550, SlotPerImpianto: map[string]int{}}
	fascia := Fascia{ID: "f1", ImpiantoID: "imp1", DurataMinutiGrezzi: 90}

	if RispettaLimiti(stato, limiti, fascia) {
		t.Error("atteso rifiuto: 550+90=640 > 600")
	}

	fasciaPiccola := Fascia{ID: "f2", ImpiantoID: "imp1", DurataMinutiGrezzi: 50}
	if !RispettaLimiti(stato, limiti, fasciaPiccola) {
		t.Error("atteso accettato: 550+50=600 <= 600 (confine incluso)")
	}
}

func TestRispettaLimiti_SlotMaxStessoImpianto(t *testing.T) {
	limiti := LimitiConcentrazione{MinutiSettimanaliMax: 99999, SlotMaxStessoImpianto: 2, FascePregiateMax: 99}
	stato := StatoConcentrazione{SlotPerImpianto: map[string]int{"imp1": 2}}
	fascia := Fascia{ID: "f1", ImpiantoID: "imp1", DurataMinutiGrezzi: 90}

	if RispettaLimiti(stato, limiti, fascia) {
		t.Error("atteso rifiuto: già 2 slot su imp1, limite 2")
	}

	fasciaAltroImpianto := Fascia{ID: "f2", ImpiantoID: "imp2", DurataMinutiGrezzi: 90}
	if !RispettaLimiti(stato, limiti, fasciaAltroImpianto) {
		t.Error("atteso accettato: imp2 ha 0 slot")
	}
}

func TestRispettaLimiti_FascePregiateMax(t *testing.T) {
	limiti := LimitiConcentrazione{MinutiSettimanaliMax: 99999, SlotMaxStessoImpianto: 99, FascePregiateMax: 1}
	stato := StatoConcentrazione{SlotPerImpianto: map[string]int{}, FascePregiateAssegnate: 1}
	fasciaPregiata := Fascia{ID: "f1", ImpiantoID: "imp1", DurataMinutiGrezzi: 90, Pregiata: true}

	if RispettaLimiti(stato, limiti, fasciaPregiata) {
		t.Error("atteso rifiuto: già 1 fascia pregiata, limite 1")
	}

	fasciaNormale := Fascia{ID: "f2", ImpiantoID: "imp1", DurataMinutiGrezzi: 90, Pregiata: false}
	if !RispettaLimiti(stato, limiti, fasciaNormale) {
		t.Error("atteso accettato: fascia non pregiata non conta sul limite pregiate")
	}
}

func TestRispettaLimiteGiornateGara(t *testing.T) {
	limiti := LimitiConcentrazione{GiornateGaraMax: 1}

	if !RispettaLimiteGiornateGara(0, limiti) {
		t.Error("atteso accettato: 0 giornate gara assegnate, limite 1")
	}
	if RispettaLimiteGiornateGara(1, limiti) {
		t.Error("atteso rifiuto: già 1 giornata gara, limite 1")
	}
}
