package roundrobin

import "testing"

const semeBlocchiGaraTest = "6d33dc55a8d0350abd83794f03a6d0814d8cd87850f1f90869b0ba13316b52c4"

func TestSceglieVincitoreBloccoGara_UnSoloCandidato(t *testing.T) {
	candidati := []CandidatoBloccoGara{
		{AssociazioneID: "a1", CRS: d("1.20"), CP: d("1.000")},
	}
	esito, err := SceglieVincitoreBloccoGara(candidati, semeBlocchiGaraTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if esito.AssociazioneID != "a1" {
		t.Errorf("vincitore = %s, atteso a1", esito.AssociazioneID)
	}
}

func TestSceglieVincitoreBloccoGara_VinceCRSMaggiore(t *testing.T) {
	candidati := []CandidatoBloccoGara{
		{AssociazioneID: "a1", CRS: d("1.20"), CP: d("5.000")}, // CP alto ma CRS basso: non conta finché CRS decide
		{AssociazioneID: "a2", CRS: d("2.00"), CP: d("1.000")},
	}
	esito, err := SceglieVincitoreBloccoGara(candidati, semeBlocchiGaraTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if esito.AssociazioneID != "a2" {
		t.Errorf("vincitore = %s, atteso a2 (CRS maggiore)", esito.AssociazioneID)
	}
}

func TestSceglieVincitoreBloccoGara_ParitaCRS_VinceCPMaggiore(t *testing.T) {
	candidati := []CandidatoBloccoGara{
		{AssociazioneID: "a1", CRS: d("1.35"), CP: d("1.000")},
		{AssociazioneID: "a2", CRS: d("1.35"), CP: d("1.607")},
	}
	esito, err := SceglieVincitoreBloccoGara(candidati, semeBlocchiGaraTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if esito.AssociazioneID != "a2" {
		t.Errorf("vincitore = %s, atteso a2 (CP maggiore a parità di CRS)", esito.AssociazioneID)
	}
}

func TestSceglieVincitoreBloccoGara_ParitaTotale_RicorreASorteggio(t *testing.T) {
	candidati := []CandidatoBloccoGara{
		{AssociazioneID: "a1", CRS: d("1.60"), CP: d("1.600")},
		{AssociazioneID: "a2", CRS: d("1.60"), CP: d("1.600")},
	}
	esito, err := SceglieVincitoreBloccoGara(candidati, semeBlocchiGaraTest)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if !esito.SorteggioEseguito {
		t.Fatal("atteso ricorso al sorteggio con parità totale")
	}
	if esito.Verbale == nil {
		t.Fatal("atteso verbale di sorteggio")
	}
}

func TestSceglieVincitoreBloccoGara_NessunCandidato(t *testing.T) {
	_, err := SceglieVincitoreBloccoGara(nil, semeBlocchiGaraTest)
	if err == nil {
		t.Error("atteso errore con lista candidati vuota")
	}
}
