// Package sorteggio implementa il sorteggio tracciato dell'art. B.38:
// algoritmo hmac-sha256-rank-asc, deterministico e riproducibile da terzi
// a partire dal solo seme pubblicato e dalla lista dei candidati.
package sorteggio

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

const (
	Algoritmo         = "hmac-sha256-rank-asc"
	AlgoritmoVersione = "v1"
	semeByteLen       = 32
)

// EsitoCandidato è la riga di sorteggio_candidati per un'associazione partecipante.
type EsitoCandidato struct {
	AssociazioneID string
	OrdineCanonico int
	HMACHex        string
	Rank           int
}

// Verbale è il record persistito in sorteggi (+ sorteggio_candidati).
type Verbale struct {
	Algoritmo               string
	AlgoritmoVersione       string
	SemeHex                 string
	Candidati               []EsitoCandidato
	VincitoreAssociazioneID string
	HashVerbale             string
}

// Esegui calcola il sorteggio. associazioneIDs può arrivare in qualsiasi ordine:
// viene sempre riordinato in ordine canonico (associazione_id crescente) prima del calcolo,
// così il risultato non dipende dall'ordine di iterazione/inserimento DB del chiamante.
func Esegui(semeHex string, associazioneIDs []string) (Verbale, error) {
	chiave, err := decodificaSeme(semeHex)
	if err != nil {
		return Verbale{}, err
	}

	candidati, err := ordineCanonico(associazioneIDs)
	if err != nil {
		return Verbale{}, err
	}

	esiti := make([]EsitoCandidato, len(candidati))
	for i, id := range candidati {
		mac := hmac.New(sha256.New, chiave)
		mac.Write([]byte(id))
		esiti[i] = EsitoCandidato{
			AssociazioneID: id,
			OrdineCanonico: i + 1,
			HMACHex:        hex.EncodeToString(mac.Sum(nil)),
		}
	}

	assegnaRank(esiti)

	return Verbale{
		Algoritmo:               Algoritmo,
		AlgoritmoVersione:       AlgoritmoVersione,
		SemeHex:                 semeHex,
		Candidati:               esiti,
		VincitoreAssociazioneID: vincitore(esiti),
		HashVerbale:             calcolaHashVerbale(semeHex, esiti),
	}, nil
}

func decodificaSeme(semeHex string) ([]byte, error) {
	b, err := hex.DecodeString(semeHex)
	if err != nil {
		return nil, fmt.Errorf("seme non esadecimale: %w", err)
	}
	if len(b) != semeByteLen {
		return nil, fmt.Errorf("seme di %d byte, atteso %d byte (%d caratteri hex)", len(b), semeByteLen, semeByteLen*2)
	}
	return b, nil
}

func ordineCanonico(associazioneIDs []string) ([]string, error) {
	if len(associazioneIDs) == 0 {
		return nil, fmt.Errorf("lista candidati vuota")
	}
	visti := make(map[string]bool, len(associazioneIDs))
	ordinati := make([]string, len(associazioneIDs))
	copy(ordinati, associazioneIDs)
	sort.Strings(ordinati)
	for _, id := range ordinati {
		if visti[id] {
			return nil, fmt.Errorf("associazione_id duplicato tra i candidati: %s", id)
		}
		visti[id] = true
	}
	return ordinati, nil
}

// assegnaRank ordina per HMAC crescente (confronto lessicografico su stringa hex a
// lunghezza fissa = confronto numerico big-endian) e assegna rank 1..N. In caso di
// collisione HMAC (probabilità trascurabile con SHA-256), il pareggio è risolto in modo
// deterministico sull'associazione_id crescente, per mantenere l'ordine totale definito.
func assegnaRank(esiti []EsitoCandidato) {
	ordinati := make([]int, len(esiti))
	for i := range ordinati {
		ordinati[i] = i
	}
	sort.Slice(ordinati, func(a, b int) bool {
		ia, ib := ordinati[a], ordinati[b]
		if esiti[ia].HMACHex != esiti[ib].HMACHex {
			return esiti[ia].HMACHex < esiti[ib].HMACHex
		}
		return esiti[ia].AssociazioneID < esiti[ib].AssociazioneID
	})
	for rank, idx := range ordinati {
		esiti[idx].Rank = rank + 1
	}
}

func vincitore(esiti []EsitoCandidato) string {
	for _, c := range esiti {
		if c.Rank == 1 {
			return c.AssociazioneID
		}
	}
	return ""
}

// calcolaHashVerbale produce l'hash di tamper-evidence sull'intero esito del sorteggio.
// Formato: concatenazione testuale deterministica (non JSON, per evitare ambiguità di
// canonicalizzazione tra implementazioni in linguaggi diversi), poi SHA-256 in hex.
func calcolaHashVerbale(semeHex string, esiti []EsitoCandidato) string {
	var b strings.Builder
	b.WriteString(Algoritmo)
	b.WriteByte('\n')
	b.WriteString(AlgoritmoVersione)
	b.WriteByte('\n')
	b.WriteString(semeHex)
	b.WriteByte('\n')
	for _, c := range esiti {
		fmt.Fprintf(&b, "%s|%s|%d\n", c.AssociazioneID, c.HMACHex, c.Rank)
	}
	somma := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(somma[:])
}
