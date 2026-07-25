// Package gara implementa l'assegnazione dei blocchi gara (Allegato B, Fase 6,
// art. B.12-B.14): individuazione delle soluzioni compatibili come coppie di slot
// consecutivi (Doc Principale art. 9: "almeno due slot consecutivi") e risoluzione
// della concorrenza sul medesimo blocco con la catena CRS → CP → sorteggio tracciato.
//
// Assunzione documentata (da confermare con l'Ente): il blocco gara è la coppia MINIMA
// di due slot consecutivi. I "requisiti tecnici" della richiesta (art. 8 Doc Principale)
// sono testo libero e non modellabili come vincolo automatico; eventuali fasce attigue
// aggiuntive (art. B.13) si gestiranno in concertazione.
//
// L'ammissibilità dei singoli slot per una richiesta (impianto omologato per la
// disciplina, spazio compatibile — art. B.13) è calcolata a monte dal chiamante (layer
// Postgres, via join SQL): qui arriva come insieme SlotAmmissibili, e il package resta
// puro e deterministico come il resto del motore.
package gara

import (
	"fmt"
	"sort"

	"github.com/provincia/palestre-engine/internal/roundrobin"
	"github.com/provincia/palestre-engine/internal/sorteggio"
	"github.com/shopspring/decimal"
)

// Slot è una fascia della settimana tipo vista dal matching gara. Gli orari sono in
// minuti dalla mezzanotte per rendere banale il test di consecutività.
type Slot struct {
	ID           string
	SpazioID     string
	ImpiantoID   string
	Giorno       int
	InizioMinuti int
	FineMinuti   int
}

// Richiesta è una richiesta di giornata di gara (art. B.12) con i coefficienti della
// catena di priorità art. B.14 e l'insieme degli slot ammissibili (art. B.13).
type Richiesta struct {
	ID              string
	AssociazioneID  string
	CRS             decimal.Decimal
	CP              decimal.Decimal
	SlotAmmissibili map[string]bool
}

// Assegnazione è un blocco gara assegnato: sempre due slot consecutivi, in ordine di
// orario. SorteggioVerbale è presente solo se la concorrenza è arrivata al sorteggio.
type Assegnazione struct {
	RichiestaID      string
	AssociazioneID   string
	SlotIDs          []string
	SorteggioVerbale *sorteggio.Verbale
}

// Esito è il risultato completo della Fase 6.
type Esito struct {
	Assegnazioni []Assegnazione
	NonAssegnate []string
}

// blocco è una coppia di slot consecutivi candidata. La chiave canonica ordina i
// blocchi in modo deterministico (spazio, giorno, orario).
type blocco struct {
	primo, secondo Slot
}

func (b blocco) chiave() string {
	return fmt.Sprintf("%s|%d|%06d|%s|%s", b.primo.SpazioID, b.primo.Giorno, b.primo.InizioMinuti, b.primo.ID, b.secondo.ID)
}

// blocchiCandidati enumera tutte le coppie di slot consecutivi (stesso spazio, stesso
// giorno, fine==inizio) in ordine canonico.
func blocchiCandidati(slots []Slot) []blocco {
	ordinati := make([]Slot, len(slots))
	copy(ordinati, slots)
	sort.Slice(ordinati, func(i, j int) bool {
		a, b := ordinati[i], ordinati[j]
		if a.SpazioID != b.SpazioID {
			return a.SpazioID < b.SpazioID
		}
		if a.Giorno != b.Giorno {
			return a.Giorno < b.Giorno
		}
		return a.InizioMinuti < b.InizioMinuti
	})

	var out []blocco
	for i := 0; i+1 < len(ordinati); i++ {
		a, b := ordinati[i], ordinati[i+1]
		if a.SpazioID == b.SpazioID && a.Giorno == b.Giorno && a.FineMinuti == b.InizioMinuti {
			out = append(out, blocco{primo: a, secondo: b})
		}
	}
	return out
}

// Esegui assegna i blocchi gara. Deterministico: ordine di esame canonico, concorrenza
// risolta per blocco con la catena art. B.14, chi perde un blocco ripiega sul successivo
// disponibile nell'iterazione seguente. GiornateGaraMax è il limite di concentrazione
// art. B.19 (per associazione, non per richiesta).
func Esegui(richieste []Richiesta, slots []Slot, giornateGaraMax int, semeHex string) (Esito, error) {
	blocchi := blocchiCandidati(slots)

	pending := make([]Richiesta, len(richieste))
	copy(pending, richieste)
	sort.Slice(pending, func(i, j int) bool { return pending[i].ID < pending[j].ID })

	slotOccupato := map[string]bool{}
	giornatePerAssoc := map[string]int{}
	var esito Esito

	// tetto di sicurezza: a ogni iterazione utile viene assegnato almeno un blocco
	for iterazione := 0; iterazione <= len(blocchi) && len(pending) > 0; iterazione++ {
		// candidatura: ogni richiesta pendente punta al primo blocco libero ammissibile
		candidatiPerBlocco := map[string][]Richiesta{}
		var chiaviBlocco []string
		bloccoPerChiave := map[string]blocco{}
		var senzaCandidato []string

		for _, r := range pending {
			if giornatePerAssoc[r.AssociazioneID]+1 > giornateGaraMax {
				senzaCandidato = append(senzaCandidato, r.ID)
				continue
			}
			trovato := false
			for _, b := range blocchi {
				if slotOccupato[b.primo.ID] || slotOccupato[b.secondo.ID] {
					continue
				}
				if !r.SlotAmmissibili[b.primo.ID] || !r.SlotAmmissibili[b.secondo.ID] {
					continue
				}
				k := b.chiave()
				if _, visto := candidatiPerBlocco[k]; !visto {
					chiaviBlocco = append(chiaviBlocco, k)
					bloccoPerChiave[k] = b
				}
				// la concorrenza art. B.14 è tra ASSOCIAZIONI: se più richieste della
				// stessa associazione puntano allo stesso blocco, candida solo la prima
				// (ordine deterministico per ID richiesta) — le altre restano pendenti
				// e ripiegheranno nelle iterazioni successive.
				stessaAssociazione := false
				for _, c := range candidatiPerBlocco[k] {
					if c.AssociazioneID == r.AssociazioneID {
						stessaAssociazione = true
						break
					}
				}
				if !stessaAssociazione {
					candidatiPerBlocco[k] = append(candidatiPerBlocco[k], r)
				}
				trovato = true
				break
			}
			if !trovato {
				senzaCandidato = append(senzaCandidato, r.ID)
			}
		}

		// chi non ha più nessun blocco possibile esce definitivamente
		if len(senzaCandidato) > 0 {
			esito.NonAssegnate = append(esito.NonAssegnate, senzaCandidato...)
			pending = rimuovi(pending, senzaCandidato)
		}
		if len(candidatiPerBlocco) == 0 {
			break
		}

		// assegnazione: blocchi in ordine canonico, un vincitore ciascuno
		sort.Strings(chiaviBlocco)
		assegnateQuestaIterazione := map[string]bool{}
		for _, k := range chiaviBlocco {
			b := bloccoPerChiave[k]
			if slotOccupato[b.primo.ID] || slotOccupato[b.secondo.ID] {
				continue
			}
			candidati := candidatiPerBlocco[k]

			var vincitore roundrobin.EsitoVincitore
			var err error
			if len(candidati) == 1 {
				vincitore = roundrobin.EsitoVincitore{AssociazioneID: candidati[0].AssociazioneID}
			} else {
				inGara := make([]roundrobin.CandidatoBloccoGara, len(candidati))
				for i, c := range candidati {
					inGara[i] = roundrobin.CandidatoBloccoGara{AssociazioneID: c.AssociazioneID, CRS: c.CRS, CP: c.CP}
				}
				vincitore, err = roundrobin.SceglieVincitoreBloccoGara(inGara, semeHex)
				if err != nil {
					return Esito{}, fmt.Errorf("blocco gara %s: %w", k, err)
				}
			}

			var richiestaVincitrice Richiesta
			for _, c := range candidati {
				if c.AssociazioneID == vincitore.AssociazioneID {
					richiestaVincitrice = c
					break
				}
			}

			slotOccupato[b.primo.ID] = true
			slotOccupato[b.secondo.ID] = true
			giornatePerAssoc[vincitore.AssociazioneID]++
			assegnateQuestaIterazione[richiestaVincitrice.ID] = true
			esito.Assegnazioni = append(esito.Assegnazioni, Assegnazione{
				RichiestaID:      richiestaVincitrice.ID,
				AssociazioneID:   vincitore.AssociazioneID,
				SlotIDs:          []string{b.primo.ID, b.secondo.ID},
				SorteggioVerbale: vincitore.Verbale,
			})
		}

		if len(assegnateQuestaIterazione) == 0 {
			break
		}
		pending = rimuoviSet(pending, assegnateQuestaIterazione)
	}

	// eventuali pendenti residue (esaurito il tetto di sicurezza) restano non assegnate
	for _, r := range pending {
		esito.NonAssegnate = append(esito.NonAssegnate, r.ID)
	}
	sort.Strings(esito.NonAssegnate)
	return esito, nil
}

func rimuovi(richieste []Richiesta, ids []string) []Richiesta {
	daTogliere := map[string]bool{}
	for _, id := range ids {
		daTogliere[id] = true
	}
	var out []Richiesta
	for _, r := range richieste {
		if !daTogliere[r.ID] {
			out = append(out, r)
		}
	}
	return out
}

func rimuoviSet(richieste []Richiesta, daTogliere map[string]bool) []Richiesta {
	var out []Richiesta
	for _, r := range richieste {
		if !daTogliere[r.ID] {
			out = append(out, r)
		}
	}
	return out
}
