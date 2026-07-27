package roundrobin

import (
	"testing"

	"github.com/shopspring/decimal"
)

const semeQuotaTest = "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b"

// Meccanismo (art. 12 Doc Principale, decisione documentata in docs/SPEC.md §7-bis.1):
// N = floor(pct × numero fasce disponibili). Finché le fasce assegnate ad associazioni
// prima_stagione sono < N, il pool di candidati di una fascia contesa si restringe alle
// sole prima_stagione SE almeno una è candidata (altrimenti pool intero, nessuno spreco).

func TestQuota_Zero_NonAlteraLaCatenaNormale(t *testing.T) {
	// default: quota disattivata, il vecchio comportamento (CP decide) non deve cambiare
	in := inputBase()
	in.QuotaNuoveAssociazioniPct = decimal.Zero
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	in.Richieste = []Richiesta{
		{AssociazioneID: "nuova", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "storica", FasciaID: "f1", OrdinePreferenza: 1},
	}
	in.Associazioni = []Associazione{
		{ID: "nuova", FR: decimal.RequireFromString("90"), CP: decimal.RequireFromString("1.000"), PrimaStagione: true},
		{ID: "storica", FR: decimal.RequireFromString("90"), CP: decimal.RequireFromString("2.000"), PrimaStagione: false},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Assegnazioni) != 1 || out.Assegnazioni[0].AssociazioneID != "storica" {
		t.Fatalf("con quota=0 doveva vincere CP maggiore (storica): %+v", out.Assegnazioni)
	}
}

func TestQuota_RistretteAiCandidatiPrimaStagioneFinoAlRaggiungimento(t *testing.T) {
	// 2 fasce, quota 50% -> N = floor(0.5*2) = 1. Su f1 "nuova" e "storica" concorrono:
	// a parità di tutto il resto CP deciderebbe per storica, ma la quota (non ancora
	// raggiunta) restringe il pool alle sole prima_stagione -> vince "nuova".
	// Su f2 la quota è già raggiunta (1 fascia assegnata a nuova) -> torna la catena
	// normale, vince CP maggiore (storica).
	in := inputBase()
	in.QuotaNuoveAssociazioniPct = decimal.RequireFromString("0.50")
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f2", ImpiantoID: "imp1", Giorno: 2, DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	in.Richieste = []Richiesta{
		{AssociazioneID: "nuova", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "nuova", FasciaID: "f2", OrdinePreferenza: 2},
		{AssociazioneID: "storica", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "storica", FasciaID: "f2", OrdinePreferenza: 2},
	}
	in.Associazioni = []Associazione{
		{ID: "nuova", FR: decimal.RequireFromString("9999"), CP: decimal.RequireFromString("1.000"), PrimaStagione: true},
		{ID: "storica", FR: decimal.RequireFromString("9999"), CP: decimal.RequireFromString("2.000"), PrimaStagione: false},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatal(err)
	}
	perFascia := map[string]string{}
	for _, a := range out.Assegnazioni {
		perFascia[a.FasciaID] = a.AssociazioneID
	}
	if perFascia["f1"] != "nuova" {
		t.Errorf("f1: quota non ancora raggiunta, doveva vincere la prima-stagione: %v", perFascia)
	}
	if perFascia["f2"] != "storica" {
		t.Errorf("f2: quota già raggiunta da f1, doveva decidere CP (storica): %v", perFascia)
	}
}

func TestQuota_NonSprecaFasceSeNessunaNuovaCandidata(t *testing.T) {
	// quota 100% ma la richiesta su f1 è solo di un'associazione storica: nessuna
	// prima_stagione candidata -> il pool resta intero, la fascia va assegnata comunque.
	in := inputBase()
	in.QuotaNuoveAssociazioniPct = decimal.RequireFromString("1.00")
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	in.Richieste = []Richiesta{
		{AssociazioneID: "storica", FasciaID: "f1", OrdinePreferenza: 1},
	}
	in.Associazioni = []Associazione{
		{ID: "storica", FR: decimal.RequireFromString("90"), CP: decimal.RequireFromString("1.000"), PrimaStagione: false},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Assegnazioni) != 1 || out.Assegnazioni[0].AssociazioneID != "storica" {
		t.Fatalf("nessuna prima_stagione candidata: la fascia doveva comunque essere assegnata: %+v", out.Assegnazioni)
	}
}

func TestQuota_BloccoAllenamentoContaTutteLeSueFasce(t *testing.T) {
	// blocco di 2 fasce vinto da una prima_stagione deve saturare da solo N=2 (quota 100%
	// su 2 fasce totali): la terza fascia (fuori blocco) torna alla catena normale.
	in := inputBase()
	in.QuotaNuoveAssociazioniPct = decimal.RequireFromString("1.00")
	in.Limiti.SlotMaxStessoImpianto = 99
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f2", ImpiantoID: "imp1", Giorno: 2, DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	in.BlocchiAllenamento = []BloccoAllenamento{
		{ID: "b1", AssociazioneID: "nuova", FasceID: []string{"f1", "f2"}},
	}
	in.Richieste = []Richiesta{
		{AssociazioneID: "nuova", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "nuova", FasciaID: "f2", OrdinePreferenza: 1},
	}
	in.Associazioni = []Associazione{
		{ID: "nuova", FR: decimal.RequireFromString("9999"), CP: decimal.RequireFromString("1.000"), PrimaStagione: true},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Assegnazioni) != 2 {
		t.Fatalf("attese 2 assegnazioni (blocco intero): %+v", out.Assegnazioni)
	}
	for _, a := range out.Assegnazioni {
		if a.AssociazioneID != "nuova" {
			t.Errorf("assegnazione inattesa: %+v", a)
		}
	}
}
