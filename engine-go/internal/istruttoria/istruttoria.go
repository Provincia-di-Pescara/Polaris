// Package istruttoria calcola fabbisogno riconosciuto e coefficienti (Fase 4, art. B.8)
// per una domanda ammessa, orchestrando i calcolatori puri di internal/calc.
//
// Assunzione esplicita (non specificata univocamente in Allegato A/B, che parlano di
// "fabbisogno dichiarato (FD)" al singolare mentre il Documento Principale art. 5 elenca
// sia "fabbisogno minimo indispensabile" che "fabbisogno ottimale desiderato" come dati
// distinti raccolti in domanda): FD ai fini del calcolo FR/CSD è il **fabbisogno ottimale
// desiderato** (fabbisogno_ottimale_minuti in DB), non il minimo. Il minimo resta dato
// informativo. Da confermare con l'Ente.
package istruttoria

import (
	"fmt"

	"github.com/provincia/palestre-engine/internal/calc"
	"github.com/shopspring/decimal"
)

// Parametrico raccoglie dalla tabella parametrico_versioni (+ scaglioni collegati) tutto
// ciò che serve al calcolo per una versione specifica, congelata per l'elaborazione.
type Parametrico struct {
	MoltiplicatoreMinutiPerPunto decimal.Decimal
	IncrementoSquadreScaglioni   []calc.ScaglioneSquadre
	CRSScaglioni                 []calc.ScaglioneCRS
	CAAScaglioni                 []calc.ScaglioneCAA
	CSDScaglioni                 []calc.ScaglioneCSD
	CAANeutro                    decimal.Decimal
	CSDNeutro                    decimal.Decimal
}

// DatiDomanda raccoglie i dati grezzi di una domanda ammessa necessari al calcolo.
type DatiDomanda struct {
	ClasseAttivitaCodice  string
	LivelloCampionato     *string // solo per classe C (provinciale/regionale)
	NumeroSquadreFederali int
	AnniAttivita          decimal.Decimal
	PrimaStagione         bool
	FDMinuti              decimal.Decimal
}

// Fabbisogno è il risultato da persistere in fabbisogni_riconosciuti.
type Fabbisogno struct {
	PesoBase          int
	IncrementoSquadre int
	FRCalcolato       decimal.Decimal
	FRFinale          decimal.Decimal
}

// Coefficienti è il risultato da persistere in coefficienti_associazione.
type Coefficienti struct {
	CRS decimal.Decimal
	CAA decimal.Decimal
	CSD decimal.Decimal
	CP  decimal.Decimal
}

var pesoBasePerClasse = map[string]int{"A": 1, "B": 2, "C": 2, "D": 3, "E": 4}

// Calcola implementa art. A.4/A.5 (fabbisogno) e A.6/A.7/A.11/A.12 (coefficienti) per
// una singola domanda, applicando i valori neutri di prima stagione dove previsti
// (art. A.4, A.7: incremento squadre e CAA, non il CRS che dipende solo dalla classe
// dichiarata quest'anno).
func Calcola(dati DatiDomanda, p Parametrico) (Fabbisogno, Coefficienti, error) {
	pesoBase, ok := pesoBasePerClasse[dati.ClasseAttivitaCodice]
	if !ok {
		return Fabbisogno{}, Coefficienti{}, fmt.Errorf("classe attività sconosciuta: %s", dati.ClasseAttivitaCodice)
	}

	incrementoSquadre := 0
	if !dati.PrimaStagione {
		var err error
		incrementoSquadre, err = calc.IncrementoSquadre(p.IncrementoSquadreScaglioni, dati.NumeroSquadreFederali)
		if err != nil {
			return Fabbisogno{}, Coefficienti{}, fmt.Errorf("incremento squadre: %w", err)
		}
	}

	frCalcolato, frFinale := calc.CalcolaFR(pesoBase, incrementoSquadre, p.MoltiplicatoreMinutiPerPunto, dati.FDMinuti)

	crs, err := calc.LookupCRS(p.CRSScaglioni, dati.ClasseAttivitaCodice, dati.LivelloCampionato)
	if err != nil {
		return Fabbisogno{}, Coefficienti{}, fmt.Errorf("CRS: %w", err)
	}

	caa := p.CAANeutro
	if !dati.PrimaStagione {
		caa, err = calc.LookupCAA(p.CAAScaglioni, dati.AnniAttivita)
		if err != nil {
			return Fabbisogno{}, Coefficienti{}, fmt.Errorf("CAA: %w", err)
		}
	}

	csd := p.CSDNeutro
	if !dati.PrimaStagione && !frCalcolato.IsZero() {
		rapporto := dati.FDMinuti.Div(frCalcolato)
		csd, err = calc.LookupCSD(p.CSDScaglioni, rapporto)
		if err != nil {
			return Fabbisogno{}, Coefficienti{}, fmt.Errorf("CSD: %w", err)
		}
	}

	cp := calc.CalcolaCP(crs, caa, csd)

	return Fabbisogno{
			PesoBase:          pesoBase,
			IncrementoSquadre: incrementoSquadre,
			FRCalcolato:       frCalcolato,
			FRFinale:          frFinale,
		}, Coefficienti{
			CRS: crs,
			CAA: caa,
			CSD: csd,
			CP:  cp,
		}, nil
}
