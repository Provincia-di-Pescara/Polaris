package istruttoria

import (
	"testing"

	"github.com/provincia/palestre-engine/internal/calc"
	"github.com/shopspring/decimal"
)

func parametricoTest() Parametrico {
	return Parametrico{
		MoltiplicatoreMinutiPerPunto: decimal.RequireFromString("60.000"),
		IncrementoSquadreScaglioni: []calc.ScaglioneSquadre{
			{SquadreMin: 0, SquadreMax: intPtr(1), Incremento: 0},
			{SquadreMin: 2, SquadreMax: intPtr(3), Incremento: 1},
			{SquadreMin: 4, SquadreMax: intPtr(6), Incremento: 2},
			{SquadreMin: 7, SquadreMax: nil, Incremento: 3},
		},
		CRSScaglioni: []calc.ScaglioneCRS{
			{ClasseCodice: "A", Livello: nil, CRS: decimal.RequireFromString("1.00")},
			{ClasseCodice: "B", Livello: nil, CRS: decimal.RequireFromString("1.10")},
			{ClasseCodice: "C", Livello: strPtr("provinciale"), CRS: decimal.RequireFromString("1.20")},
			{ClasseCodice: "C", Livello: strPtr("regionale"), CRS: decimal.RequireFromString("1.35")},
			{ClasseCodice: "D", Livello: nil, CRS: decimal.RequireFromString("1.60")},
			{ClasseCodice: "E", Livello: nil, CRS: decimal.RequireFromString("2.00")},
		},
		CAAScaglioni: []calc.ScaglioneCAA{
			{AnniMin: decimal.RequireFromString("0"), AnniMax: decPtrLocal("2"), CAA: decimal.RequireFromString("0.90")},
			{AnniMin: decimal.RequireFromString("2"), AnniMax: decPtrLocal("5"), CAA: decimal.RequireFromString("0.95")},
			{AnniMin: decimal.RequireFromString("5"), AnniMax: decPtrLocal("10"), CAA: decimal.RequireFromString("1.00")},
			{AnniMin: decimal.RequireFromString("10"), AnniMax: decPtrLocal("20"), CAA: decimal.RequireFromString("1.05")},
			{AnniMin: decimal.RequireFromString("20"), AnniMax: nil, CAA: decimal.RequireFromString("1.10")},
		},
		CSDScaglioni: []calc.ScaglioneCSD{
			{RapportoMin: decimal.RequireFromString("0.000"), RapportoMax: decPtrLocal("1.000"), Coefficiente: decimal.RequireFromString("1.000")},
			{RapportoMin: decimal.RequireFromString("1.000"), RapportoMax: nil, Coefficiente: decimal.RequireFromString("0.900")},
		},
		CAANeutro: decimal.RequireFromString("1.000"),
		CSDNeutro: decimal.RequireFromString("1.000"),
	}
}

func intPtr(v int) *int       { return &v }
func strPtr(v string) *string { return &v }
func decPtrLocal(v string) *decimal.Decimal {
	d := decimal.RequireFromString(v)
	return &d
}

func TestCalcola_AssociazioneOrdinaria(t *testing.T) {
	dati := DatiDomanda{
		ClasseAttivitaCodice:  "B",
		NumeroSquadreFederali: 3, // scaglione 2-3 -> incremento 1
		AnniAttivita:          decimal.RequireFromString("12"),
		PrimaStagione:         false,
		FDMinuti:              decimal.RequireFromString("500"),
	}

	fabbisogno, coeff, err := Calcola(dati, parametricoTest())
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	// peso base B=2, incremento=1 -> punteggio 3, x60 = 180
	if !fabbisogno.FRCalcolato.Equal(decimal.RequireFromString("180.000")) {
		t.Errorf("FRCalcolato = %s, atteso 180.000", fabbisogno.FRCalcolato)
	}
	if !fabbisogno.FRFinale.Equal(decimal.RequireFromString("180.000")) {
		t.Errorf("FRFinale = %s, atteso 180.000 (FD 500 non è il tetto)", fabbisogno.FRFinale)
	}
	if !coeff.CRS.Equal(decimal.RequireFromString("1.10")) {
		t.Errorf("CRS = %s, atteso 1.10 (classe B)", coeff.CRS)
	}
	if !coeff.CAA.Equal(decimal.RequireFromString("1.05")) {
		t.Errorf("CAA = %s, atteso 1.05 (10-20 anni)", coeff.CAA)
	}
}

func TestCalcola_PrimaStagione_ValoriNeutri(t *testing.T) {
	dati := DatiDomanda{
		ClasseAttivitaCodice:  "E",
		NumeroSquadreFederali: 10,                              // andrebbe scaglione >6 -> incremento 3, ma prima stagione -> neutro 0
		AnniAttivita:          decimal.RequireFromString("15"), // andrebbe CAA 1.05, ma prima stagione -> neutro 1.00
		PrimaStagione:         true,
		FDMinuti:              decimal.RequireFromString("1000"),
	}

	fabbisogno, coeff, err := Calcola(dati, parametricoTest())
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	// peso base E=4, incremento neutro=0 -> punteggio 4, x60 = 240
	if !fabbisogno.FRCalcolato.Equal(decimal.RequireFromString("240.000")) {
		t.Errorf("FRCalcolato = %s, atteso 240.000 (incremento squadre neutro per prima stagione)", fabbisogno.FRCalcolato)
	}
	if !coeff.CAA.Equal(decimal.RequireFromString("1.000")) {
		t.Errorf("CAA = %s, atteso 1.000 neutro (prima stagione)", coeff.CAA)
	}
}

func TestCalcola_FDInferioreAlCalcolato_FRFinaleUgualeFD(t *testing.T) {
	dati := DatiDomanda{
		ClasseAttivitaCodice:  "E",
		NumeroSquadreFederali: 10,
		AnniAttivita:          decimal.RequireFromString("15"),
		PrimaStagione:         false,
		FDMinuti:              decimal.RequireFromString("100"), // molto inferiore al calcolato
	}

	fabbisogno, _, err := Calcola(dati, parametricoTest())
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if !fabbisogno.FRFinale.Equal(decimal.RequireFromString("100")) {
		t.Errorf("FRFinale = %s, atteso 100 (FD è il tetto)", fabbisogno.FRFinale)
	}
}

func TestCalcola_CSD_UsaRapportoFDSuFRCalcolato(t *testing.T) {
	dati := DatiDomanda{
		ClasseAttivitaCodice:  "A",
		NumeroSquadreFederali: 0,
		AnniAttivita:          decimal.RequireFromString("15"),
		PrimaStagione:         false,
		FDMinuti:              decimal.RequireFromString("120"), // FR calcolato = 1*60=60; rapporto FD/FR = 2.0 -> CSD scaglione >1.000 = 0.900
	}

	_, coeff, err := Calcola(dati, parametricoTest())
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if !coeff.CSD.Equal(decimal.RequireFromString("0.900")) {
		t.Errorf("CSD = %s, atteso 0.900 (rapporto FD/FR = 2.0)", coeff.CSD)
	}
}

func TestCalcola_ClasseSconosciuta_Errore(t *testing.T) {
	dati := DatiDomanda{
		ClasseAttivitaCodice: "Z",
		FDMinuti:             decimal.RequireFromString("100"),
	}
	_, _, err := Calcola(dati, parametricoTest())
	if err == nil {
		t.Error("atteso errore per classe attività sconosciuta")
	}
}
