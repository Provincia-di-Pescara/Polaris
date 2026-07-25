package calc

import "testing"

func TestIncrementoSquadre(t *testing.T) {
	scaglioni := []ScaglioneSquadre{
		{SquadreMin: 0, SquadreMax: intPtr(1), Incremento: 0},
		{SquadreMin: 2, SquadreMax: intPtr(3), Incremento: 1},
		{SquadreMin: 4, SquadreMax: intPtr(6), Incremento: 2},
		{SquadreMin: 7, SquadreMax: nil, Incremento: 3},
	}

	casi := []struct {
		squadre          int
		incrementoAtteso int
	}{
		{0, 0},
		{1, 0},
		{2, 1},
		{3, 1},
		{4, 2},
		{6, 2},
		{7, 3},
		{100, 3}, // scaglione senza limite superiore
	}

	for _, c := range casi {
		got, err := IncrementoSquadre(scaglioni, c.squadre)
		if err != nil {
			t.Fatalf("squadre=%d: errore inatteso: %v", c.squadre, err)
		}
		if got != c.incrementoAtteso {
			t.Errorf("IncrementoSquadre(%d) = %d, atteso %d", c.squadre, got, c.incrementoAtteso)
		}
	}
}

func TestIncrementoSquadre_NumeroNegativo(t *testing.T) {
	scaglioni := []ScaglioneSquadre{
		{SquadreMin: 0, SquadreMax: nil, Incremento: 0},
	}
	_, err := IncrementoSquadre(scaglioni, -1)
	if err == nil {
		t.Error("atteso errore per numero squadre negativo, nessuno scaglione dovrebbe coprirlo")
	}
}

func intPtr(v int) *int { return &v }
