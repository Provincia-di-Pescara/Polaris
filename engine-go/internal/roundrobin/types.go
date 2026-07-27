// Package roundrobin implementa l'assegnazione progressiva delle fasce (Allegato B,
// Fasi 6-9: blocchi gara, ordine esame, assegnazione per round, chiusura).
package roundrobin

import "github.com/shopspring/decimal"

// Fascia è uno slot della settimana tipo (art. B.3).
type Fascia struct {
	ID                 string
	ImpiantoID         string
	Giorno             int // 1=lunedì .. 7=domenica
	OrarioInizio       string
	DurataMinutiGrezzi int
	Pregiata           bool
	ValorePonderato    decimal.Decimal // durata, eventualmente x peso fascia pregiata (art. A.9) — usato per VA/ISF
	OmologataGara      bool
}

// Richiesta è una fascia richiesta da un'associazione, con ordine di preferenza
// (1 = più preferita, coerente con art. B.6).
type Richiesta struct {
	AssociazioneID   string
	FasciaID         string
	OrdinePreferenza int
}

// BloccoAllenamento è un gruppo di fasce richieste come indivisibili (art. B.6, secondo comma).
type BloccoAllenamento struct {
	ID             string
	AssociazioneID string
	FasceID        []string
}

// Associazione è lo stato di un'associazione candidata al round-robin.
// PrimaStagione (art. 12 Doc Principale: tutela nuove associazioni) determina
// l'eleggibilità alla quota di precedenza — vedi InputEsecuzione.QuotaNuoveAssociazioniPct.
type Associazione struct {
	ID            string
	FR            decimal.Decimal
	CP            decimal.Decimal
	PrimaStagione bool
}
