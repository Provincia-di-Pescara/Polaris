package roundrobin

import (
	"testing"

	"github.com/shopspring/decimal"
)

const semeLoopTest = "3fa1c2b3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e80"

func inputBase() InputEsecuzione {
	return InputEsecuzione{
		Limiti: LimitiConcentrazione{
			MinutiSettimanaliMax:  9999,
			SlotMaxStessoImpianto: 99,
			FascePregiateMax:      99,
		},
		TolleranzaISF: decimal.RequireFromString("0.005"),
		SemeHex:       semeLoopTest,
	}
}

func TestEsegui_DueAssociazioniQuattroFasceSingole(t *testing.T) {
	in := inputBase()
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "16:30", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f2", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "18:00", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f3", ImpiantoID: "imp1", Giorno: 2, OrarioInizio: "16:30", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f4", ImpiantoID: "imp1", Giorno: 2, OrarioInizio: "18:00", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	in.Richieste = []Richiesta{
		{AssociazioneID: "a1", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "a1", FasciaID: "f2", OrdinePreferenza: 2},
		{AssociazioneID: "a1", FasciaID: "f3", OrdinePreferenza: 3},
		{AssociazioneID: "a1", FasciaID: "f4", OrdinePreferenza: 4},
		{AssociazioneID: "a2", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "a2", FasciaID: "f2", OrdinePreferenza: 2},
		{AssociazioneID: "a2", FasciaID: "f3", OrdinePreferenza: 3},
		{AssociazioneID: "a2", FasciaID: "f4", OrdinePreferenza: 4},
	}
	in.Associazioni = []Associazione{
		{ID: "a1", FR: decimal.RequireFromString("180"), CP: decimal.RequireFromString("1.000")},
		{ID: "a2", FR: decimal.RequireFromString("180"), CP: decimal.RequireFromString("1.000")},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	if len(out.Assegnazioni) != 4 {
		t.Fatalf("attese 4 assegnazioni (tutte le fasce), trovate %d", len(out.Assegnazioni))
	}

	perAssociazione := map[string]int{}
	for _, a := range out.Assegnazioni {
		perAssociazione[a.AssociazioneID]++
	}
	if perAssociazione["a1"] != perAssociazione["a2"] {
		t.Errorf("distribuzione non equilibrata tra a1(%d) e a2(%d), atteso equilibrio via ISF crescente", perAssociazione["a1"], perAssociazione["a2"])
	}
}

func TestEsegui_UnaAssegnazionePerRound(t *testing.T) {
	in := inputBase()
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "16:30", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f2", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "18:00", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	// una sola associazione, richiede entrambe le fasce: non può prenderle entrambe nello stesso round.
	in.Richieste = []Richiesta{
		{AssociazioneID: "a1", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "a1", FasciaID: "f2", OrdinePreferenza: 2},
	}
	in.Associazioni = []Associazione{
		{ID: "a1", FR: decimal.RequireFromString("999"), CP: decimal.RequireFromString("1.000")},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	if len(out.Assegnazioni) != 2 {
		t.Fatalf("attese 2 assegnazioni totali (su round diversi), trovate %d", len(out.Assegnazioni))
	}
	if out.Assegnazioni[0].RoundNumero == out.Assegnazioni[1].RoundNumero {
		t.Errorf("le due assegnazioni sono nello stesso round (%d), atteso round diversi", out.Assegnazioni[0].RoundNumero)
	}
	if out.RoundEseguiti < 2 {
		t.Errorf("RoundEseguiti = %d, atteso almeno 2", out.RoundEseguiti)
	}
}

func TestEsegui_BloccoAllenamentoVinceIntero(t *testing.T) {
	in := inputBase()
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "16:30", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f2", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "18:00", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	in.BlocchiAllenamento = []BloccoAllenamento{
		{ID: "b1", AssociazioneID: "a1", FasceID: []string{"f1", "f2"}},
	}
	in.Richieste = []Richiesta{
		{AssociazioneID: "a1", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "a1", FasciaID: "f2", OrdinePreferenza: 1},
	}
	in.Associazioni = []Associazione{
		{ID: "a1", FR: decimal.RequireFromString("999"), CP: decimal.RequireFromString("1.000")},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	if len(out.Assegnazioni) != 2 {
		t.Fatalf("attese 2 assegnazioni (blocco intero), trovate %d", len(out.Assegnazioni))
	}
	for _, a := range out.Assegnazioni {
		if a.BloccoAllenamentoID != "b1" {
			t.Errorf("fascia %s: BloccoAllenamentoID = %q, atteso b1", a.FasciaID, a.BloccoAllenamentoID)
		}
		if a.AssociazioneID != "a1" {
			t.Errorf("fascia %s assegnata a %s, atteso a1", a.FasciaID, a.AssociazioneID)
		}
	}
	// blocco atomico: entrambe le fasce nello STESSO round (consumano un solo round-slot, decisione stakeholder Q17)
	if out.Assegnazioni[0].RoundNumero != out.Assegnazioni[1].RoundNumero {
		t.Errorf("le due fasce del blocco sono in round diversi (%d, %d), atteso stesso round",
			out.Assegnazioni[0].RoundNumero, out.Assegnazioni[1].RoundNumero)
	}
}

func TestEsegui_BloccoRottoRicandidaturaSingola(t *testing.T) {
	in := inputBase()
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "16:30", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f2", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "18:00", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	in.BlocchiAllenamento = []BloccoAllenamento{
		{ID: "b1", AssociazioneID: "a1", FasceID: []string{"f1", "f2"}},
	}
	in.Richieste = []Richiesta{
		{AssociazioneID: "a1", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "a1", FasciaID: "f2", OrdinePreferenza: 1},
		// a2 vuole SOLO f1 come richiesta singola, con ISF già a 0 (favorito su a1 che parte da ISF 0 pari,
		// ma a2 ha FR molto più basso quindi il primo minuto assegnato lo sazia subito: usiamo CP per forzare
		// la vittoria di a2 su f1 nel primo round tramite un ISF iniziale identico e priorità a2 su preferenza/CP
		// -- qui semplifichiamo dando ad a2 una preferenza qualsiasi, il punto è farla vincere f1.
		{AssociazioneID: "a2", FasciaID: "f1", OrdinePreferenza: 1},
	}
	in.Associazioni = []Associazione{
		{ID: "a1", FR: decimal.RequireFromString("999"), CP: decimal.RequireFromString("1.000")},
		{ID: "a2", FR: decimal.RequireFromString("999"), CP: decimal.RequireFromString("2.000")}, // CP più alto -> vince f1 a parità di ISF/preferenza
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	var assegF1, assegF2 *Assegnazione
	for i := range out.Assegnazioni {
		switch out.Assegnazioni[i].FasciaID {
		case "f1":
			assegF1 = &out.Assegnazioni[i]
		case "f2":
			assegF2 = &out.Assegnazioni[i]
		}
	}

	if assegF1 == nil || assegF1.AssociazioneID != "a2" {
		t.Fatalf("f1 atteso assegnato ad a2 (CP maggiore), trovato %+v", assegF1)
	}
	if assegF1.BloccoAllenamentoID != "" {
		t.Errorf("f1 assegnata singolarmente ad a2, non dovrebbe avere BloccoAllenamentoID, trovato %q", assegF1.BloccoAllenamentoID)
	}
	if assegF2 == nil || assegF2.AssociazioneID != "a1" {
		t.Fatalf("f2 attesa assegnata ad a1 (ricandidatura individuale dopo rottura blocco), trovato %+v", assegF2)
	}
	if assegF2.BloccoAllenamentoID != "" {
		t.Errorf("f2 assegnata ad a1 come ricandidatura singola, non dovrebbe avere BloccoAllenamentoID, trovato %q", assegF2.BloccoAllenamentoID)
	}
}

func TestEsegui_ChiusuraPerFabbisognoRaggiunto(t *testing.T) {
	in := inputBase()
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "16:30", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
		{ID: "f2", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "18:00", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	in.Richieste = []Richiesta{
		{AssociazioneID: "a1", FasciaID: "f1", OrdinePreferenza: 1},
		{AssociazioneID: "a1", FasciaID: "f2", OrdinePreferenza: 2},
	}
	// FR di 90: dopo la prima assegnazione (90 minuti) a1 ha raggiunto il fabbisogno e non compete più.
	in.Associazioni = []Associazione{
		{ID: "a1", FR: decimal.RequireFromString("90"), CP: decimal.RequireFromString("1.000")},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}

	if len(out.Assegnazioni) != 1 {
		t.Fatalf("attesa 1 sola assegnazione (FR raggiunto dopo la prima), trovate %d", len(out.Assegnazioni))
	}
}

func TestEsegui_ChiusuraNessunaAssegnazioneCompatibile(t *testing.T) {
	in := inputBase()
	in.Fasce = []Fascia{
		{ID: "f1", ImpiantoID: "imp1", Giorno: 1, OrarioInizio: "16:30", DurataMinutiGrezzi: 90, ValorePonderato: decimal.RequireFromString("90")},
	}
	// nessuna richiesta per f1: nessuna assegnazione possibile, il loop deve terminare senza errore.
	in.Associazioni = []Associazione{
		{ID: "a1", FR: decimal.RequireFromString("90"), CP: decimal.RequireFromString("1.000")},
	}

	out, err := Esegui(in)
	if err != nil {
		t.Fatalf("errore inatteso: %v", err)
	}
	if len(out.Assegnazioni) != 0 {
		t.Errorf("attese 0 assegnazioni, trovate %d", len(out.Assegnazioni))
	}
}
