package roundrobin

import (
	"testing"

	"github.com/shopspring/decimal"
)

// Le assegnazioni pregresse (blocchi gara, Fase 6) devono pesare anche sui limiti di
// concentrazione art. B.19 e sul tie-break di contiguità, non solo sul VA iniziale
// (art. B.15) — B.14: le fasce gara concorrono integralmente al soddisfacimento del FR.

const semeStatoIniziale = "3c1f5a2e8d94b7c60f1e2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f"

func TestStatoInizialeContaNeiLimitiDiConcentrazione(t *testing.T) {
	fascia := Fascia{ID: "f1", ImpiantoID: "imp-1", Giorno: 1, DurataMinutiGrezzi: 120, ValorePonderato: decimal.NewFromInt(120)}

	in := InputEsecuzione{
		Fasce:        []Fascia{fascia},
		Richieste:    []Richiesta{{AssociazioneID: "a1", FasciaID: "f1", OrdinePreferenza: 1}},
		Associazioni: []Associazione{{ID: "a1", FR: decimal.NewFromInt(1000), CP: decimal.NewFromInt(1)}},
		VAIniziale:   map[string]decimal.Decimal{"a1": decimal.NewFromInt(240)},
		// 240 minuti già assegnati come blocco gara: con MinutiSettimanaliMax=300 una
		// fascia da 120 sforerebbe (240+120 > 300) e NON va assegnata
		StatoIniziale: map[string]StatoConcentrazione{
			"a1": {MinutiGrezziAssegnati: 240, SlotPerImpianto: map[string]int{"imp-2": 2}},
		},
		Limiti:        LimitiConcentrazione{MinutiSettimanaliMax: 300, SlotMaxStessoImpianto: 4, FascePregiateMax: 2, GiornateGaraMax: 1},
		TolleranzaISF: decimal.RequireFromString("0.005"),
		SemeHex:       semeStatoIniziale,
	}

	esito, err := Esegui(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 0 {
		t.Fatalf("la fascia non doveva essere assegnata (limite minuti sforato con i minuti gara iniziali): %+v", esito.Assegnazioni)
	}
}

func TestStatoInizialeContaNelTieBreakContiguita(t *testing.T) {
	// a1 e a2 pari su tutto (stesso FR/CP/VA, stessa preferenza), ma a1 ha già un blocco
	// gara nell'impianto della fascia contesa: art. B.20 — vince chi dispone già
	// dell'impianto. Senza lo stato iniziale si andrebbe a sorteggio.
	fascia := Fascia{ID: "f1", ImpiantoID: "imp-1", Giorno: 1, DurataMinutiGrezzi: 60, ValorePonderato: decimal.NewFromInt(60)}

	in := InputEsecuzione{
		Fasce: []Fascia{fascia},
		Richieste: []Richiesta{
			{AssociazioneID: "a1", FasciaID: "f1", OrdinePreferenza: 1},
			{AssociazioneID: "a2", FasciaID: "f1", OrdinePreferenza: 1},
		},
		Associazioni: []Associazione{
			{ID: "a1", FR: decimal.NewFromInt(600), CP: decimal.NewFromInt(1)},
			{ID: "a2", FR: decimal.NewFromInt(600), CP: decimal.NewFromInt(1)},
		},
		VAIniziale: map[string]decimal.Decimal{
			"a1": decimal.NewFromInt(240),
			"a2": decimal.NewFromInt(240),
		},
		StatoIniziale: map[string]StatoConcentrazione{
			"a1": {MinutiGrezziAssegnati: 240, SlotPerImpianto: map[string]int{"imp-1": 2}},
			"a2": {MinutiGrezziAssegnati: 240, SlotPerImpianto: map[string]int{"imp-9": 2}},
		},
		Limiti:        LimitiConcentrazione{MinutiSettimanaliMax: 600, SlotMaxStessoImpianto: 4, FascePregiateMax: 2, GiornateGaraMax: 1},
		TolleranzaISF: decimal.RequireFromString("0.005"),
		SemeHex:       semeStatoIniziale,
	}

	esito, err := Esegui(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 1 {
		t.Fatalf("attesa 1 assegnazione: %+v", esito.Assegnazioni)
	}
	if esito.Assegnazioni[0].AssociazioneID != "a1" {
		t.Fatalf("doveva vincere a1 (dispone già dell'impianto via blocco gara), ha vinto %s", esito.Assegnazioni[0].AssociazioneID)
	}
	if esito.Assegnazioni[0].SorteggioVerbale != nil {
		t.Fatal("non doveva servire il sorteggio: la contiguità decide")
	}
}
