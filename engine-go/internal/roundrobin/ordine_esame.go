package roundrobin

import (
	"fmt"
	"sort"
)

// OrdineEsameFasce implementa art. B.17: ordine decrescente di associazioni richiedenti,
// a parità precedenza alle fasce pregiate, a ulteriore parità ordine cronologico
// (giorno, orario di inizio). Determinato una sola volta prima della Fase 8.
func OrdineEsameFasce(fasce []Fascia, richieste []Richiesta) []string {
	conteggio := make(map[string]int, len(fasce))
	for _, r := range richieste {
		conteggio[r.FasciaID]++
	}

	ordinate := make([]Fascia, len(fasce))
	copy(ordinate, fasce)

	sort.SliceStable(ordinate, func(i, j int) bool {
		fi, fj := ordinate[i], ordinate[j]

		ci, cj := conteggio[fi.ID], conteggio[fj.ID]
		if ci != cj {
			return ci > cj
		}
		if fi.Pregiata != fj.Pregiata {
			return fi.Pregiata
		}
		return chiaveCronologica(fi) < chiaveCronologica(fj)
	})

	ids := make([]string, len(ordinate))
	for i, f := range ordinate {
		ids[i] = f.ID
	}
	return ids
}

func chiaveCronologica(f Fascia) string {
	return fmt.Sprintf("%d-%s", f.Giorno, f.OrarioInizio)
}
