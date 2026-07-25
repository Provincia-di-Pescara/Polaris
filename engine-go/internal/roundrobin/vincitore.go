package roundrobin

import (
	"fmt"

	"github.com/provincia/palestre-engine/internal/calc"
	"github.com/provincia/palestre-engine/internal/sorteggio"
	"github.com/shopspring/decimal"
)

// CandidatoFascia raccoglie tutto ciò che serve alla catena di priorità art. B.20-21
// per una singola fascia in esame. ContiguoODisponeGiaImpianto è il criterio 2
// dell'art. B.20 (fascia contigua a una già assegnata nello stesso impianto, oppure
// l'associazione dispone già di assegnazioni in quell'impianto) — calcolato dal
// chiamante sullo stato live del round (decisione stakeholder: presenza conta anche
// se assegnata prima nello stesso round). OrdinePreferenza è quello indicato
// dall'associazione per QUESTA fascia specifica (1 = più preferita).
type CandidatoFascia struct {
	AssociazioneID              string
	ISF                         decimal.Decimal
	ContiguoODisponeGiaImpianto bool
	OrdinePreferenza            int
	CP                          decimal.Decimal
}

// EsitoVincitore è il risultato dell'assegnazione di una fascia a un round-robin.
type EsitoVincitore struct {
	AssociazioneID    string
	SorteggioEseguito bool
	Verbale           *sorteggio.Verbale
}

// SceglieVincitore implementa la catena di priorità completa art. B.20-21:
// 1. minore ISF (entro la tolleranza di parità);
// 2. contiguità/concentrazione sull'impianto;
// 3. maggiore preferenza espressa per la fascia;
// 4. maggiore coefficiente di priorità (CP);
// 5. sorteggio tracciato.
// Ogni criterio restringe il pool ai soli candidati che lo soddisfano meglio; si passa
// al criterio successivo solo se il pool resta con più di un candidato.
func SceglieVincitore(candidati []CandidatoFascia, tolleranzaISF decimal.Decimal, semeHex string) (EsitoVincitore, error) {
	if len(candidati) == 0 {
		return EsitoVincitore{}, fmt.Errorf("nessun candidato per la fascia")
	}
	if len(candidati) == 1 {
		return EsitoVincitore{AssociazioneID: candidati[0].AssociazioneID}, nil
	}

	pool := candidati

	pool = restringiISF(pool, tolleranzaISF)
	if len(pool) == 1 {
		return EsitoVincitore{AssociazioneID: pool[0].AssociazioneID}, nil
	}

	pool = restringiContiguita(pool)
	if len(pool) == 1 {
		return EsitoVincitore{AssociazioneID: pool[0].AssociazioneID}, nil
	}

	pool = restringiPreferenza(pool)
	if len(pool) == 1 {
		return EsitoVincitore{AssociazioneID: pool[0].AssociazioneID}, nil
	}

	pool = restringiCP(pool)
	if len(pool) == 1 {
		return EsitoVincitore{AssociazioneID: pool[0].AssociazioneID}, nil
	}

	ids := make([]string, len(pool))
	for i, c := range pool {
		ids[i] = c.AssociazioneID
	}
	verbale, err := sorteggio.Esegui(semeHex, ids)
	if err != nil {
		return EsitoVincitore{}, fmt.Errorf("sorteggio tracciato: %w", err)
	}
	return EsitoVincitore{
		AssociazioneID:    verbale.VincitoreAssociazioneID,
		SorteggioEseguito: true,
		Verbale:           &verbale,
	}, nil
}

func restringiISF(pool []CandidatoFascia, tolleranza decimal.Decimal) []CandidatoFascia {
	minISF := pool[0].ISF
	for _, c := range pool {
		if calc.ISFMinore(c.ISF, minISF) {
			minISF = c.ISF
		}
	}
	var ristretto []CandidatoFascia
	for _, c := range pool {
		if calc.ISFInTolleranza(c.ISF, minISF, tolleranza) {
			ristretto = append(ristretto, c)
		}
	}
	return ristretto
}

func restringiContiguita(pool []CandidatoFascia) []CandidatoFascia {
	var conContiguita []CandidatoFascia
	for _, c := range pool {
		if c.ContiguoODisponeGiaImpianto {
			conContiguita = append(conContiguita, c)
		}
	}
	if len(conContiguita) > 0 {
		return conContiguita
	}
	return pool
}

func restringiPreferenza(pool []CandidatoFascia) []CandidatoFascia {
	migliore := pool[0].OrdinePreferenza
	for _, c := range pool {
		if c.OrdinePreferenza < migliore {
			migliore = c.OrdinePreferenza
		}
	}
	var ristretto []CandidatoFascia
	for _, c := range pool {
		if c.OrdinePreferenza == migliore {
			ristretto = append(ristretto, c)
		}
	}
	return ristretto
}

func restringiCP(pool []CandidatoFascia) []CandidatoFascia {
	massimo := pool[0].CP
	for _, c := range pool {
		if c.CP.GreaterThan(massimo) {
			massimo = c.CP
		}
	}
	var ristretto []CandidatoFascia
	for _, c := range pool {
		if c.CP.Equal(massimo) {
			ristretto = append(ristretto, c)
		}
	}
	return ristretto
}
