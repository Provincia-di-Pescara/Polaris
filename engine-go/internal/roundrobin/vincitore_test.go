package roundrobin

import (
	"testing"

	"github.com/shopspring/decimal"
)

const semeVincitoreTest = "cf195b69b833fcd5cd515505e0065ec18fbfae93891d197f4cca2e1d60751620"

func d(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func TestSceglieVincitore_UnSoloCandidato(t *testing.T) {
	candidati := []CandidatoFascia{
		{AssociazioneID: "a1", ISF: d("0.300")},
	}
	esito, err := SceglieVincitore(candidati, d("0.005"), semeVincitoreTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if esito.AssociazioneID != "a1" {
		t.Errorf("vincitore = %s, atteso a1", esito.AssociazioneID)
	}
	if esito.SorteggioEseguito {
		t.Error("non atteso sorteggio con un solo candidato")
	}
}

func TestSceglieVincitore_ISFPiuBassoFuoriTolleranza(t *testing.T) {
	candidati := []CandidatoFascia{
		{AssociazioneID: "a1", ISF: d("0.300")},
		{AssociazioneID: "a2", ISF: d("0.700")},
	}
	esito, err := SceglieVincitore(candidati, d("0.005"), semeVincitoreTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if esito.AssociazioneID != "a1" {
		t.Errorf("vincitore = %s, atteso a1 (ISF più basso)", esito.AssociazioneID)
	}
}

func TestSceglieVincitore_ParitaISF_VinceContiguoODisponeGiaImpianto(t *testing.T) {
	candidati := []CandidatoFascia{
		{AssociazioneID: "a1", ISF: d("0.500"), ContiguoODisponeGiaImpianto: false},
		{AssociazioneID: "a2", ISF: d("0.502"), ContiguoODisponeGiaImpianto: true},
	}
	esito, err := SceglieVincitore(candidati, d("0.005"), semeVincitoreTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if esito.AssociazioneID != "a2" {
		t.Errorf("vincitore = %s, atteso a2 (contiguo/impianto già in uso)", esito.AssociazioneID)
	}
}

func TestSceglieVincitore_ParitaFinoAPreferenza_VinceMaggiorePreferenza(t *testing.T) {
	candidati := []CandidatoFascia{
		{AssociazioneID: "a1", ISF: d("0.500"), OrdinePreferenza: 3},
		{AssociazioneID: "a2", ISF: d("0.500"), OrdinePreferenza: 1},
	}
	esito, err := SceglieVincitore(candidati, d("0.005"), semeVincitoreTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if esito.AssociazioneID != "a2" {
		t.Errorf("vincitore = %s, atteso a2 (ordine preferenza 1 = più preferita)", esito.AssociazioneID)
	}
}

func TestSceglieVincitore_ParitaFinoACP_VinceCPMaggiore(t *testing.T) {
	candidati := []CandidatoFascia{
		{AssociazioneID: "a1", ISF: d("0.500"), OrdinePreferenza: 1, CP: d("1.100")},
		{AssociazioneID: "a2", ISF: d("0.500"), OrdinePreferenza: 1, CP: d("1.350")},
	}
	esito, err := SceglieVincitore(candidati, d("0.005"), semeVincitoreTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if esito.AssociazioneID != "a2" {
		t.Errorf("vincitore = %s, atteso a2 (CP maggiore)", esito.AssociazioneID)
	}
}

func TestSceglieVincitore_ParitaTotale_RicorreASorteggio(t *testing.T) {
	candidati := []CandidatoFascia{
		{AssociazioneID: "a1", ISF: d("0.500"), OrdinePreferenza: 1, CP: d("1.100")},
		{AssociazioneID: "a2", ISF: d("0.500"), OrdinePreferenza: 1, CP: d("1.100")},
		{AssociazioneID: "a3", ISF: d("0.500"), OrdinePreferenza: 1, CP: d("1.100")},
	}
	esito, err := SceglieVincitore(candidati, d("0.005"), semeVincitoreTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if !esito.SorteggioEseguito {
		t.Fatal("atteso ricorso al sorteggio con parità totale")
	}
	if esito.Verbale == nil {
		t.Fatal("atteso verbale di sorteggio")
	}
	trovato := false
	for _, c := range candidati {
		if c.AssociazioneID == esito.AssociazioneID {
			trovato = true
		}
	}
	if !trovato {
		t.Errorf("vincitore %s non è tra i candidati", esito.AssociazioneID)
	}
}

func TestSceglieVincitore_NessunCandidato(t *testing.T) {
	_, err := SceglieVincitore(nil, d("0.005"), semeVincitoreTest)
	if err == nil {
		t.Error("atteso errore con lista candidati vuota")
	}
}
