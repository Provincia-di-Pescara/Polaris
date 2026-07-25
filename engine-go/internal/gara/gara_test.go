package gara

import (
	"testing"

	"github.com/shopspring/decimal"
)

// Fixture: due slot consecutivi (fine==inizio) nello stesso spazio/giorno formano un
// blocco gara candidato (Doc Principale art. 9: "almeno due slot consecutivi").

func slotConsecutivi(spazioID, impiantoID string, giorno int, inizio int, quanti int, durata int) []Slot {
	var out []Slot
	for i := 0; i < quanti; i++ {
		out = append(out, Slot{
			ID:           spazioID + "-s" + string(rune('a'+i)),
			SpazioID:     spazioID,
			ImpiantoID:   impiantoID,
			Giorno:       giorno,
			InizioMinuti: inizio + i*durata,
			FineMinuti:   inizio + (i+1)*durata,
		})
	}
	return out
}

func ammissibiliTutti(slots []Slot) map[string]bool {
	m := make(map[string]bool, len(slots))
	for _, s := range slots {
		m[s.ID] = true
	}
	return m
}

const semeTest = "8b1a4bd0dbb52c53e2b6231fdc0000ea2b0aa78e6f28974e5b0c8a4f5fb1d2c3"

func dec(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func TestRichiestaUnicaVinceBloccoDiDueSlotConsecutivi(t *testing.T) {
	slots := slotConsecutivi("spazio-1", "imp-1", 6, 9*60, 3, 120)
	r := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.0"), CP: dec("1.0"), SlotAmmissibili: ammissibiliTutti(slots)}

	esito, err := Esegui([]Richiesta{r}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 1 {
		t.Fatalf("attese 1 assegnazione, avute %d", len(esito.Assegnazioni))
	}
	a := esito.Assegnazioni[0]
	if a.RichiestaID != "r1" || a.AssociazioneID != "assoc-1" {
		t.Fatalf("assegnazione errata: %+v", a)
	}
	// blocco canonico = i primi due slot consecutivi in ordine di orario
	if len(a.SlotIDs) != 2 || a.SlotIDs[0] != slots[0].ID || a.SlotIDs[1] != slots[1].ID {
		t.Fatalf("slot del blocco errati: %v", a.SlotIDs)
	}
	if len(esito.NonAssegnate) != 0 {
		t.Fatalf("nessuna richiesta doveva restare non assegnata: %v", esito.NonAssegnate)
	}
}

func TestSlotNonConsecutiviNonFormanoBlocco(t *testing.T) {
	// due slot nello stesso spazio/giorno ma con un buco in mezzo
	slots := []Slot{
		{ID: "s1", SpazioID: "spazio-1", ImpiantoID: "imp-1", Giorno: 6, InizioMinuti: 9 * 60, FineMinuti: 10 * 60},
		{ID: "s2", SpazioID: "spazio-1", ImpiantoID: "imp-1", Giorno: 6, InizioMinuti: 11 * 60, FineMinuti: 12 * 60},
	}
	r := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.0"), CP: dec("1.0"), SlotAmmissibili: ammissibiliTutti(slots)}

	esito, err := Esegui([]Richiesta{r}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 0 || len(esito.NonAssegnate) != 1 {
		t.Fatalf("attesa nessuna assegnazione e 1 non assegnata: %+v", esito)
	}
}

func TestSlotConsecutiviDiSpaziDiversiNonFormanoBlocco(t *testing.T) {
	slots := []Slot{
		{ID: "s1", SpazioID: "spazio-1", ImpiantoID: "imp-1", Giorno: 6, InizioMinuti: 9 * 60, FineMinuti: 10 * 60},
		{ID: "s2", SpazioID: "spazio-2", ImpiantoID: "imp-1", Giorno: 6, InizioMinuti: 10 * 60, FineMinuti: 11 * 60},
	}
	r := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.0"), CP: dec("1.0"), SlotAmmissibili: ammissibiliTutti(slots)}

	esito, err := Esegui([]Richiesta{r}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 0 {
		t.Fatalf("slot di spazi diversi non devono formare un blocco: %+v", esito.Assegnazioni)
	}
}

func TestSlotNonAmmissibiliEsclusi(t *testing.T) {
	slots := slotConsecutivi("spazio-1", "imp-1", 6, 9*60, 2, 120)
	r := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.0"), CP: dec("1.0"), SlotAmmissibili: map[string]bool{}}

	esito, err := Esegui([]Richiesta{r}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 0 || len(esito.NonAssegnate) != 1 {
		t.Fatalf("richiesta senza slot ammissibili doveva restare non assegnata: %+v", esito)
	}
}

func TestConcorrenzaStessoBloccoVinceCRSMaggioreEIlPerdenteRipiega(t *testing.T) {
	// un solo blocco in spazio-1, un secondo blocco in spazio-2: chi perde il primo
	// deve ripiegare sul secondo nell'iterazione successiva
	slots := append(
		slotConsecutivi("spazio-1", "imp-1", 6, 9*60, 2, 120),
		slotConsecutivi("spazio-2", "imp-2", 6, 9*60, 2, 120)...,
	)
	tutti := ammissibiliTutti(slots)
	r1 := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.100"), CP: dec("1.0"), SlotAmmissibili: tutti}
	r2 := Richiesta{ID: "r2", AssociazioneID: "assoc-2", CRS: dec("1.050"), CP: dec("2.0"), SlotAmmissibili: tutti}

	esito, err := Esegui([]Richiesta{r1, r2}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 2 {
		t.Fatalf("attese 2 assegnazioni: %+v", esito)
	}
	perAssoc := map[string]string{}
	for _, a := range esito.Assegnazioni {
		perAssoc[a.AssociazioneID] = a.SlotIDs[0]
	}
	// CRS maggiore (assoc-1) prende il blocco canonico in spazio-1, assoc-2 ripiega su spazio-2
	if perAssoc["assoc-1"] != "spazio-1-sa" {
		t.Fatalf("assoc-1 (CRS maggiore) doveva vincere il blocco di spazio-1, ha %s", perAssoc["assoc-1"])
	}
	if perAssoc["assoc-2"] != "spazio-2-sa" {
		t.Fatalf("assoc-2 doveva ripiegare sul blocco di spazio-2, ha %s", perAssoc["assoc-2"])
	}
}

func TestParitaCRSVinceCPMaggiore(t *testing.T) {
	slots := slotConsecutivi("spazio-1", "imp-1", 6, 9*60, 2, 120)
	tutti := ammissibiliTutti(slots)
	r1 := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.100"), CP: dec("0.950"), SlotAmmissibili: tutti}
	r2 := Richiesta{ID: "r2", AssociazioneID: "assoc-2", CRS: dec("1.100"), CP: dec("1.045"), SlotAmmissibili: tutti}

	esito, err := Esegui([]Richiesta{r1, r2}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 1 || esito.Assegnazioni[0].AssociazioneID != "assoc-2" {
		t.Fatalf("doveva vincere assoc-2 (CP maggiore a parità di CRS): %+v", esito.Assegnazioni)
	}
	if len(esito.NonAssegnate) != 1 || esito.NonAssegnate[0] != "r1" {
		t.Fatalf("r1 doveva restare non assegnata: %v", esito.NonAssegnate)
	}
}

func TestParitaTotaleRisoltaConSorteggioTracciato(t *testing.T) {
	slots := slotConsecutivi("spazio-1", "imp-1", 6, 9*60, 2, 120)
	tutti := ammissibiliTutti(slots)
	r1 := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.0"), CP: dec("1.0"), SlotAmmissibili: tutti}
	r2 := Richiesta{ID: "r2", AssociazioneID: "assoc-2", CRS: dec("1.0"), CP: dec("1.0"), SlotAmmissibili: tutti}

	esito, err := Esegui([]Richiesta{r1, r2}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 1 {
		t.Fatalf("attesa 1 assegnazione: %+v", esito)
	}
	if esito.Assegnazioni[0].SorteggioVerbale == nil {
		t.Fatal("parità totale: il verbale di sorteggio deve essere presente")
	}
	// determinismo: stessa esecuzione ripetuta → stesso vincitore
	esito2, err := Esegui([]Richiesta{r2, r1}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if esito2.Assegnazioni[0].AssociazioneID != esito.Assegnazioni[0].AssociazioneID {
		t.Fatal("l'esito deve essere indipendente dall'ordine di input delle richieste")
	}
}

func TestLimiteGiornateGaraPerAssociazione(t *testing.T) {
	// stessa associazione, due richieste, due blocchi disponibili, max 1 giornata gara
	slots := append(
		slotConsecutivi("spazio-1", "imp-1", 6, 9*60, 2, 120),
		slotConsecutivi("spazio-2", "imp-2", 7, 9*60, 2, 120)...,
	)
	tutti := ammissibiliTutti(slots)
	r1 := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.0"), CP: dec("1.0"), SlotAmmissibili: tutti}
	r2 := Richiesta{ID: "r2", AssociazioneID: "assoc-1", CRS: dec("1.0"), CP: dec("1.0"), SlotAmmissibili: tutti}

	esito, err := Esegui([]Richiesta{r1, r2}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	if len(esito.Assegnazioni) != 1 || len(esito.NonAssegnate) != 1 {
		t.Fatalf("con GiornateGaraMax=1 solo una richiesta doveva passare: %+v", esito)
	}
}

func TestDeterminismoConOrdineSlotPermutato(t *testing.T) {
	slots := append(
		slotConsecutivi("spazio-1", "imp-1", 6, 9*60, 2, 120),
		slotConsecutivi("spazio-2", "imp-2", 6, 9*60, 2, 120)...,
	)
	inverso := []Slot{slots[3], slots[2], slots[1], slots[0]}
	tutti := ammissibiliTutti(slots)
	r1 := Richiesta{ID: "r1", AssociazioneID: "assoc-1", CRS: dec("1.100"), CP: dec("1.0"), SlotAmmissibili: tutti}
	r2 := Richiesta{ID: "r2", AssociazioneID: "assoc-2", CRS: dec("1.050"), CP: dec("1.0"), SlotAmmissibili: tutti}

	a, err := Esegui([]Richiesta{r1, r2}, slots, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Esegui([]Richiesta{r2, r1}, inverso, 1, semeTest)
	if err != nil {
		t.Fatal(err)
	}
	perAssocA := map[string][]string{}
	for _, x := range a.Assegnazioni {
		perAssocA[x.AssociazioneID] = x.SlotIDs
	}
	for _, x := range b.Assegnazioni {
		if len(perAssocA[x.AssociazioneID]) != len(x.SlotIDs) {
			t.Fatalf("esiti diversi con input permutato: %+v vs %+v", a.Assegnazioni, b.Assegnazioni)
		}
		for i := range x.SlotIDs {
			if perAssocA[x.AssociazioneID][i] != x.SlotIDs[i] {
				t.Fatalf("esiti diversi con input permutato: %+v vs %+v", a.Assegnazioni, b.Assegnazioni)
			}
		}
	}
}
