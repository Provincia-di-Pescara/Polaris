package roundrobin

import (
	"fmt"

	"github.com/provincia/palestre-engine/internal/sorteggio"
	"github.com/shopspring/decimal"
)

// CandidatoBloccoGara è un'associazione in concorrenza sul medesimo blocco gara (art. B.14).
type CandidatoBloccoGara struct {
	AssociazioneID string
	CRS            decimal.Decimal
	CP             decimal.Decimal
}

// SceglieVincitoreBloccoGara implementa la catena di priorità art. B.14 per la
// concorrenza sui blocchi gara — DIVERSA da quella delle fasce ordinarie (art. B.20-21):
// qui non si usa l'ISF, si parte direttamente da:
// 1. maggiore coefficiente di rilevanza sportiva (CRS);
// 2. maggiore coefficiente di priorità (CP);
// 3. sorteggio tracciato.
func SceglieVincitoreBloccoGara(candidati []CandidatoBloccoGara, semeHex string) (EsitoVincitore, error) {
	if len(candidati) == 0 {
		return EsitoVincitore{}, fmt.Errorf("nessun candidato per il blocco gara")
	}
	if len(candidati) == 1 {
		return EsitoVincitore{AssociazioneID: candidati[0].AssociazioneID}, nil
	}

	pool := restringiCRS(candidati)
	if len(pool) == 1 {
		return EsitoVincitore{AssociazioneID: pool[0].AssociazioneID}, nil
	}

	pool = restringiCPGara(pool)
	if len(pool) == 1 {
		return EsitoVincitore{AssociazioneID: pool[0].AssociazioneID}, nil
	}

	ids := make([]string, len(pool))
	for i, c := range pool {
		ids[i] = c.AssociazioneID
	}
	verbale, err := sorteggio.Esegui(semeHex, ids)
	if err != nil {
		return EsitoVincitore{}, fmt.Errorf("sorteggio tracciato blocco gara: %w", err)
	}
	return EsitoVincitore{
		AssociazioneID:    verbale.VincitoreAssociazioneID,
		SorteggioEseguito: true,
		Verbale:           &verbale,
	}, nil
}

func restringiCRS(pool []CandidatoBloccoGara) []CandidatoBloccoGara {
	massimo := pool[0].CRS
	for _, c := range pool {
		if c.CRS.GreaterThan(massimo) {
			massimo = c.CRS
		}
	}
	var ristretto []CandidatoBloccoGara
	for _, c := range pool {
		if c.CRS.Equal(massimo) {
			ristretto = append(ristretto, c)
		}
	}
	return ristretto
}

func restringiCPGara(pool []CandidatoBloccoGara) []CandidatoBloccoGara {
	massimo := pool[0].CP
	for _, c := range pool {
		if c.CP.GreaterThan(massimo) {
			massimo = c.CP
		}
	}
	var ristretto []CandidatoBloccoGara
	for _, c := range pool {
		if c.CP.Equal(massimo) {
			ristretto = append(ristretto, c)
		}
	}
	return ristretto
}
