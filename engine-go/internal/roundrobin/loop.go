package roundrobin

import (
	"fmt"
	"sort"

	"github.com/provincia/palestre-engine/internal/calc"
	"github.com/provincia/palestre-engine/internal/sorteggio"
	"github.com/shopspring/decimal"
)

// InputEsecuzione raccoglie tutti i dati necessari a un'esecuzione della Fase 8
// (assegnazione progressiva, art. B.17-22).
type InputEsecuzione struct {
	Fasce              []Fascia
	Richieste          []Richiesta
	BlocchiAllenamento []BloccoAllenamento
	Associazioni       []Associazione
	// VAIniziale copre il valore già assegnato prima dell'avvio (es. blocchi gara, Fase 6-7).
	VAIniziale map[string]decimal.Decimal
	// StatoIniziale porta le assegnazioni pregresse (blocchi gara) dentro i limiti di
	// concentrazione art. B.19 e nel tie-break di contiguità art. B.20: i minuti gara
	// contano nel tetto settimanale e l'impianto del blocco gara conta come "già usato".
	StatoIniziale map[string]StatoConcentrazione
	Limiti        LimitiConcentrazione
	TolleranzaISF decimal.Decimal
	// QuotaNuoveAssociazioniPct (art. 12 Doc Principale, parametro 🔧, default 0 =
	// disattivata — vedi docs/SPEC.md §7-bis.1): finché le fasce assegnate ad
	// associazioni PrimaStagione sono meno di floor(pct × numero fasce totali), il pool
	// di candidati di una fascia contesa si restringe alle sole prima_stagione SE almeno
	// una è candidata (altrimenti nessuna restrizione: la quota non spreca fasce che
	// nessuna nuova associazione richiede).
	QuotaNuoveAssociazioniPct decimal.Decimal
	SemeHex                   string
}

// Assegnazione è l'esito di una singola fascia assegnata durante il round-robin.
// BloccoAllenamentoID è vuoto per le assegnazioni singole.
type Assegnazione struct {
	FasciaID            string
	AssociazioneID      string
	BloccoAllenamentoID string
	RoundNumero         int
	SorteggioVerbale    *sorteggio.Verbale
}

// Esito è il risultato completo dell'esecuzione.
type Esito struct {
	Assegnazioni  []Assegnazione
	RoundEseguiti int
}

type statoAssociazione struct {
	fr                     decimal.Decimal
	cp                     decimal.Decimal
	va                     decimal.Decimal
	primaStagione          bool
	minutiGrezzi           int
	slotPerImpianto        map[string]int
	fascePregiateAssegnate int
	impiantiUsati          map[string]bool
	assegnataInQuestoRound bool
}

type statoBlocco struct {
	blocco *BloccoAllenamento
	rotto  bool
}

// Esegui esegue l'intera Fase 8 (B.17-22): ordine di esame determinato una volta,
// assegnazione per round con tetto di sicurezza = numero totale di fasce, gestione
// atomica dei blocchi allenamento (art. B.20) con rottura e ricandidatura individuale
// automatica (decisione stakeholder) quando una loro fascia viene presa da altri prima
// che il blocco possa vincere.
func Esegui(in InputEsecuzione) (Esito, error) {
	fasceByID := make(map[string]Fascia, len(in.Fasce))
	for _, f := range in.Fasce {
		fasceByID[f.ID] = f
	}

	stati := make(map[string]*statoAssociazione, len(in.Associazioni))
	for _, a := range in.Associazioni {
		va := decimal.Zero
		if v, ok := in.VAIniziale[a.ID]; ok {
			va = v
		}
		s := &statoAssociazione{
			fr:              a.FR,
			cp:              a.CP,
			va:              va,
			primaStagione:   a.PrimaStagione,
			slotPerImpianto: map[string]int{},
			impiantiUsati:   map[string]bool{},
		}
		if iniziale, ok := in.StatoIniziale[a.ID]; ok {
			s.minutiGrezzi = iniziale.MinutiGrezziAssegnati
			s.fascePregiateAssegnate = iniziale.FascePregiateAssegnate
			for impianto, n := range iniziale.SlotPerImpianto {
				s.slotPerImpianto[impianto] = n
				if n > 0 {
					s.impiantiUsati[impianto] = true
				}
			}
		}
		stati[a.ID] = s
	}

	richiesteByFascia := make(map[string][]Richiesta)
	for _, r := range in.Richieste {
		richiesteByFascia[r.FasciaID] = append(richiesteByFascia[r.FasciaID], r)
	}

	blocchiPerAssocFascia := make(map[string]map[string]*statoBlocco)
	blocchiCheContengono := make(map[string][]*statoBlocco)
	for i := range in.BlocchiAllenamento {
		b := &in.BlocchiAllenamento[i]
		sb := &statoBlocco{blocco: b}
		if blocchiPerAssocFascia[b.AssociazioneID] == nil {
			blocchiPerAssocFascia[b.AssociazioneID] = map[string]*statoBlocco{}
		}
		for _, fID := range b.FasceID {
			blocchiPerAssocFascia[b.AssociazioneID][fID] = sb
			blocchiCheContengono[fID] = append(blocchiCheContengono[fID], sb)
		}
	}

	ordineEsame := OrdineEsameFasce(in.Fasce, in.Richieste)
	indiceEsame := make(map[string]int, len(ordineEsame))
	for i, fID := range ordineEsame {
		indiceEsame[fID] = i
	}

	fasciaAssegnata := make(map[string]bool, len(in.Fasce))
	var risultati []Assegnazione

	maxRound := len(in.Fasce)
	if maxRound == 0 {
		return Esito{}, nil
	}

	// art. 12 Doc Principale: N = floor(pct × numero fasce totali). Contatore aggiornato
	// via registraFasceNuove ad ogni assegnazione vinta da una prima_stagione.
	quotaTarget := decimal.NewFromInt(int64(len(in.Fasce))).Mul(in.QuotaNuoveAssociazioniPct).Floor().IntPart()
	fasceAssegnateANuove := int64(0)

	round := 0
	for round < maxRound {
		round++
		for _, s := range stati {
			s.assegnataInQuestoRound = false
		}

		progressoNelRound := false

		for _, fasciaID := range ordineEsame {
			if fasciaAssegnata[fasciaID] {
				continue
			}
			fascia := fasceByID[fasciaID]

			candidati, bloccoPerAssoc, err := costruisciCandidati(
				fasciaID, fascia, richiesteByFascia[fasciaID], stati,
				blocchiPerAssocFascia, fasciaAssegnata, indiceEsame, fasceByID, in.Limiti,
			)
			if err != nil {
				return Esito{}, err
			}
			if len(candidati) == 0 {
				continue
			}

			if fasceAssegnateANuove < quotaTarget {
				candidati = restringiPerQuotaNuove(candidati, stati)
			}

			esito, err := SceglieVincitore(candidati, in.TolleranzaISF, in.SemeHex)
			if err != nil {
				return Esito{}, fmt.Errorf("fascia %s: %w", fasciaID, err)
			}

			if stati[esito.AssociazioneID].primaStagione {
				sb := bloccoPerAssoc[esito.AssociazioneID]
				if sb != nil {
					fasceAssegnateANuove += int64(len(sb.blocco.FasceID))
				} else {
					fasceAssegnateANuove++
				}
			}

			sb := bloccoPerAssoc[esito.AssociazioneID]
			if sb != nil {
				for _, fID := range sb.blocco.FasceID {
					assegna(&risultati, fasciaAssegnata, stati, fasceByID, blocchiCheContengono,
						fID, esito.AssociazioneID, sb.blocco.ID, round, sb, esito.Verbale)
					esito.Verbale = nil // il verbale va allegato una sola volta al record, non ripetuto per ogni fascia del blocco
				}
			} else {
				assegna(&risultati, fasciaAssegnata, stati, fasceByID, blocchiCheContengono,
					fasciaID, esito.AssociazioneID, "", round, nil, esito.Verbale)
			}
			progressoNelRound = true
		}

		if !progressoNelRound {
			break // art. B.22.3: nessuna ulteriore assegnazione compatibile
		}
		if tutteLeFasceAssegnate(in.Fasce, fasciaAssegnata) {
			break // art. B.22.1
		}
		if tutteLeAssociazioniHannoRaggiuntoFR(stati) {
			break // art. B.22.2
		}
	}

	return Esito{Assegnazioni: risultati, RoundEseguiti: round}, nil
}

func costruisciCandidati(
	fasciaID string,
	fascia Fascia,
	richieste []Richiesta,
	stati map[string]*statoAssociazione,
	blocchiPerAssocFascia map[string]map[string]*statoBlocco,
	fasciaAssegnata map[string]bool,
	indiceEsame map[string]int,
	fasceByID map[string]Fascia,
	limiti LimitiConcentrazione,
) ([]CandidatoFascia, map[string]*statoBlocco, error) {
	var candidati []CandidatoFascia
	bloccoPerAssoc := make(map[string]*statoBlocco)

	for _, r := range richieste {
		stato, ok := stati[r.AssociazioneID]
		if !ok {
			continue
		}
		if stato.assegnataInQuestoRound {
			continue
		}
		isf, definito := calc.CalcolaISF(stato.va, stato.fr)
		if !definito || !isf.LessThan(decimal.NewFromInt(1)) {
			continue // FR=0 (mai candidato) oppure fabbisogno già raggiunto
		}

		var sb *statoBlocco
		if m, ok := blocchiPerAssocFascia[r.AssociazioneID]; ok {
			if candidatoSb, inBlocco := m[fasciaID]; inBlocco && !candidatoSb.rotto {
				primaLibera := primaFasciaLiberaDelBlocco(candidatoSb.blocco, fasciaAssegnata, indiceEsame)
				if primaLibera != fasciaID {
					continue // non è ancora il turno di questo blocco nell'ordine di esame
				}
				if !bloccoRispettaLimiti(candidatoSb.blocco, statoConcentrazioneDi(stato), limiti, fasceByID) {
					continue
				}
				sb = candidatoSb
			}
		}
		if sb == nil {
			if !RispettaLimiti(statoConcentrazioneDi(stato), limiti, fascia) {
				continue
			}
		}

		candidati = append(candidati, CandidatoFascia{
			AssociazioneID:              r.AssociazioneID,
			ISF:                         isf,
			ContiguoODisponeGiaImpianto: stato.impiantiUsati[fascia.ImpiantoID],
			OrdinePreferenza:            r.OrdinePreferenza,
			CP:                          stato.cp,
		})
		if sb != nil {
			bloccoPerAssoc[r.AssociazioneID] = sb
		}
	}

	return candidati, bloccoPerAssoc, nil
}

// restringiPerQuotaNuove implementa il pre-filtro art. 12: se almeno un candidato è di
// un'associazione prima_stagione, il pool si restringe a quelli (poi la catena B.20
// normale decide tra loro); altrimenti il pool resta invariato — la quota non spreca
// fasce che nessuna nuova associazione ha richiesto.
func restringiPerQuotaNuove(candidati []CandidatoFascia, stati map[string]*statoAssociazione) []CandidatoFascia {
	var nuove []CandidatoFascia
	for _, c := range candidati {
		if stati[c.AssociazioneID].primaStagione {
			nuove = append(nuove, c)
		}
	}
	if len(nuove) > 0 {
		return nuove
	}
	return candidati
}

func primaFasciaLiberaDelBlocco(b *BloccoAllenamento, fasciaAssegnata map[string]bool, indiceEsame map[string]int) string {
	var libere []string
	for _, fID := range b.FasceID {
		if !fasciaAssegnata[fID] {
			libere = append(libere, fID)
		}
	}
	if len(libere) == 0 {
		return ""
	}
	sort.Slice(libere, func(i, j int) bool { return indiceEsame[libere[i]] < indiceEsame[libere[j]] })
	return libere[0]
}

func bloccoRispettaLimiti(b *BloccoAllenamento, statoIniziale StatoConcentrazione, limiti LimitiConcentrazione, fasceByID map[string]Fascia) bool {
	sim := StatoConcentrazione{
		MinutiGrezziAssegnati:  statoIniziale.MinutiGrezziAssegnati,
		SlotPerImpianto:        map[string]int{},
		FascePregiateAssegnate: statoIniziale.FascePregiateAssegnate,
	}
	for k, v := range statoIniziale.SlotPerImpianto {
		sim.SlotPerImpianto[k] = v
	}
	for _, fID := range b.FasceID {
		f := fasceByID[fID]
		if !RispettaLimiti(sim, limiti, f) {
			return false
		}
		sim.MinutiGrezziAssegnati += f.DurataMinutiGrezzi
		sim.SlotPerImpianto[f.ImpiantoID]++
		if f.Pregiata {
			sim.FascePregiateAssegnate++
		}
	}
	return true
}

func statoConcentrazioneDi(s *statoAssociazione) StatoConcentrazione {
	return StatoConcentrazione{
		MinutiGrezziAssegnati:  s.minutiGrezzi,
		SlotPerImpianto:        s.slotPerImpianto,
		FascePregiateAssegnate: s.fascePregiateAssegnate,
	}
}

func assegna(
	risultati *[]Assegnazione,
	fasciaAssegnata map[string]bool,
	stati map[string]*statoAssociazione,
	fasceByID map[string]Fascia,
	blocchiCheContengono map[string][]*statoBlocco,
	fasciaID, associazioneID, bloccoID string,
	round int,
	bloccoVincitore *statoBlocco,
	verbale *sorteggio.Verbale,
) {
	fascia := fasceByID[fasciaID]
	fasciaAssegnata[fasciaID] = true

	stato := stati[associazioneID]
	stato.va = stato.va.Add(fascia.ValorePonderato)
	stato.minutiGrezzi += fascia.DurataMinutiGrezzi
	stato.slotPerImpianto[fascia.ImpiantoID]++
	if fascia.Pregiata {
		stato.fascePregiateAssegnate++
	}
	stato.impiantiUsati[fascia.ImpiantoID] = true
	stato.assegnataInQuestoRound = true

	*risultati = append(*risultati, Assegnazione{
		FasciaID:            fasciaID,
		AssociazioneID:      associazioneID,
		BloccoAllenamentoID: bloccoID,
		RoundNumero:         round,
		SorteggioVerbale:    verbale,
	})

	for _, sb := range blocchiCheContengono[fasciaID] {
		if sb == bloccoVincitore {
			continue
		}
		sb.rotto = true
	}
}

func tutteLeFasceAssegnate(fasce []Fascia, fasciaAssegnata map[string]bool) bool {
	for _, f := range fasce {
		if !fasciaAssegnata[f.ID] {
			return false
		}
	}
	return true
}

func tutteLeAssociazioniHannoRaggiuntoFR(stati map[string]*statoAssociazione) bool {
	for _, s := range stati {
		isf, definito := calc.CalcolaISF(s.va, s.fr)
		if definito && isf.LessThan(decimal.NewFromInt(1)) {
			return false
		}
	}
	return true
}
