package sorteggio

import "testing"

// Seme di 32 byte in esadecimale (64 caratteri), come da specifica art. B.38.
const semeTest = "fc50cd227b21f1f4b80ddbfdb268cc2f54a051e35caa8504582f0e0a5d465f86"
const semeTestAlt = "3526005a48d813af35b1587cc32b295cb44ae70ec9b44f87119932a79249a3bc"

func TestEsegui_RankSonoPermutazioneDa1AN(t *testing.T) {
	candidati := []string{"assoc-3", "assoc-1", "assoc-2"}

	v, err := Esegui(semeTest, candidati)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	visti := map[int]bool{}
	for _, c := range v.Candidati {
		if visti[c.Rank] {
			t.Errorf("rank %d assegnato più di una volta", c.Rank)
		}
		visti[c.Rank] = true
	}
	for r := 1; r <= len(candidati); r++ {
		if !visti[r] {
			t.Errorf("rank %d mancante", r)
		}
	}
}

func TestEsegui_OrdineCanonicoPerAssociazioneIDCrescente(t *testing.T) {
	candidati := []string{"z-assoc", "a-assoc", "m-assoc"}

	v, err := Esegui(semeTest, candidati)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	atteso := []string{"a-assoc", "m-assoc", "z-assoc"}
	for i, id := range atteso {
		if v.Candidati[i].AssociazioneID != id || v.Candidati[i].OrdineCanonico != i+1 {
			t.Errorf("posizione %d: atteso %s (ordine %d), trovato %s (ordine %d)",
				i, id, i+1, v.Candidati[i].AssociazioneID, v.Candidati[i].OrdineCanonico)
		}
	}
}

func TestEsegui_DeterministicoIndipendenteDallOrdineInput(t *testing.T) {
	v1, err := Esegui(semeTest, []string{"assoc-1", "assoc-2", "assoc-3"})
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	v2, err := Esegui(semeTest, []string{"assoc-3", "assoc-1", "assoc-2"})
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	if v1.HashVerbale != v2.HashVerbale {
		t.Errorf("hash_verbale diverso per lo stesso seme+candidati in ordine input diverso: %s vs %s", v1.HashVerbale, v2.HashVerbale)
	}
	if v1.VincitoreAssociazioneID != v2.VincitoreAssociazioneID {
		t.Errorf("vincitore diverso: %s vs %s", v1.VincitoreAssociazioneID, v2.VincitoreAssociazioneID)
	}
}

func TestEsegui_VincitoreHaRankUno(t *testing.T) {
	v, err := Esegui(semeTest, []string{"assoc-1", "assoc-2", "assoc-3", "assoc-4", "assoc-5"})
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	var vincitore *EsitoCandidato
	for i := range v.Candidati {
		if v.Candidati[i].AssociazioneID == v.VincitoreAssociazioneID {
			vincitore = &v.Candidati[i]
		}
	}
	if vincitore == nil {
		t.Fatal("vincitore non trovato tra i candidati")
	}
	if vincitore.Rank != 1 {
		t.Errorf("il vincitore ha rank %d, atteso 1", vincitore.Rank)
	}
}

func TestEsegui_HMACOrdinatoCoerenteConRank(t *testing.T) {
	v, err := Esegui(semeTest, []string{"assoc-1", "assoc-2", "assoc-3", "assoc-4"})
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	for i := 0; i < len(v.Candidati)-1; i++ {
		var hmacRankI, hmacRankI1 string
		for _, c := range v.Candidati {
			if c.Rank == i+1 {
				hmacRankI = c.HMACHex
			}
			if c.Rank == i+2 {
				hmacRankI1 = c.HMACHex
			}
		}
		if hmacRankI >= hmacRankI1 {
			t.Errorf("rank %d (hmac %s) dovrebbe precedere rank %d (hmac %s) in ordine crescente", i+1, hmacRankI, i+2, hmacRankI1)
		}
	}
}

func TestEsegui_SemeDiversoProduceHashVerbaleDiverso(t *testing.T) {
	candidati := []string{"assoc-1", "assoc-2", "assoc-3"}

	v1, err := Esegui(semeTest, candidati)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	v2, err := Esegui(semeTestAlt, candidati)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	if v1.HashVerbale == v2.HashVerbale {
		t.Error("hash_verbale identico per semi diversi, atteso diverso")
	}
}

func TestEsegui_CandidatoInPiuCambiaHashVerbale(t *testing.T) {
	v1, err := Esegui(semeTest, []string{"assoc-1", "assoc-2"})
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	v2, err := Esegui(semeTest, []string{"assoc-1", "assoc-2", "assoc-3"})
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	if v1.HashVerbale == v2.HashVerbale {
		t.Error("hash_verbale identico con set di candidati diverso, atteso diverso")
	}
}

func TestEsegui_ListaCandidatiVuota(t *testing.T) {
	_, err := Esegui(semeTest, []string{})
	if err == nil {
		t.Error("atteso errore con lista candidati vuota")
	}
}

func TestEsegui_CandidatiDuplicati(t *testing.T) {
	_, err := Esegui(semeTest, []string{"assoc-1", "assoc-1"})
	if err == nil {
		t.Error("atteso errore con associazione_id duplicato")
	}
}

func TestEsegui_SemeNonEsadecimale(t *testing.T) {
	_, err := Esegui("questo-non-e-hex", []string{"assoc-1"})
	if err == nil {
		t.Error("atteso errore con seme non esadecimale")
	}
}

func TestEsegui_SemeLunghezzaErrata(t *testing.T) {
	_, err := Esegui("a1b2", []string{"assoc-1"})
	if err == nil {
		t.Error("atteso errore con seme troppo corto (non 32 byte)")
	}
}

func TestEsegui_MetadatiAlgoritmo(t *testing.T) {
	v, err := Esegui(semeTest, []string{"assoc-1"})
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if v.Algoritmo != "hmac-sha256-rank-asc" {
		t.Errorf("Algoritmo = %s, atteso hmac-sha256-rank-asc", v.Algoritmo)
	}
	if v.AlgoritmoVersione != "v1" {
		t.Errorf("AlgoritmoVersione = %s, atteso v1", v.AlgoritmoVersione)
	}
	if v.SemeHex != semeTest {
		t.Errorf("SemeHex = %s, atteso %s", v.SemeHex, semeTest)
	}
}
