package roundrobin

import (
	"reflect"
	"testing"
)

func TestOrdineEsameFasce_PerNumeroRichiedentiDecrescente(t *testing.T) {
	fasce := []Fascia{
		{ID: "f1", Giorno: 1, OrarioInizio: "16:30"},
		{ID: "f2", Giorno: 1, OrarioInizio: "18:00"},
		{ID: "f3", Giorno: 1, OrarioInizio: "19:30"},
	}
	richieste := []Richiesta{
		{FasciaID: "f1", AssociazioneID: "a1"},
		{FasciaID: "f2", AssociazioneID: "a1"},
		{FasciaID: "f2", AssociazioneID: "a2"},
		{FasciaID: "f2", AssociazioneID: "a3"},
		{FasciaID: "f3", AssociazioneID: "a1"},
		{FasciaID: "f3", AssociazioneID: "a2"},
	}

	got := OrdineEsameFasce(fasce, richieste)

	atteso := []string{"f2", "f3", "f1"} // 3, 2, 1 richiedenti
	if !reflect.DeepEqual(got, atteso) {
		t.Errorf("OrdineEsameFasce = %v, atteso %v", got, atteso)
	}
}

func TestOrdineEsameFasce_ParitaRichiedenti_PrecedenzaFasciaPregiata(t *testing.T) {
	fasce := []Fascia{
		{ID: "normale", Giorno: 1, OrarioInizio: "10:00", Pregiata: false},
		{ID: "pregiata", Giorno: 1, OrarioInizio: "17:00", Pregiata: true},
	}
	richieste := []Richiesta{
		{FasciaID: "normale", AssociazioneID: "a1"},
		{FasciaID: "pregiata", AssociazioneID: "a1"},
	}

	got := OrdineEsameFasce(fasce, richieste)

	atteso := []string{"pregiata", "normale"}
	if !reflect.DeepEqual(got, atteso) {
		t.Errorf("OrdineEsameFasce = %v, atteso %v", got, atteso)
	}
}

func TestOrdineEsameFasce_ParitaRichiedentiEPregiata_OrdineCronologico(t *testing.T) {
	fasce := []Fascia{
		{ID: "martedi-17", Giorno: 2, OrarioInizio: "17:00"},
		{ID: "lunedi-19", Giorno: 1, OrarioInizio: "19:00"},
		{ID: "lunedi-17", Giorno: 1, OrarioInizio: "17:00"},
	}
	richieste := []Richiesta{
		{FasciaID: "martedi-17", AssociazioneID: "a1"},
		{FasciaID: "lunedi-19", AssociazioneID: "a1"},
		{FasciaID: "lunedi-17", AssociazioneID: "a1"},
	}

	got := OrdineEsameFasce(fasce, richieste)

	atteso := []string{"lunedi-17", "lunedi-19", "martedi-17"}
	if !reflect.DeepEqual(got, atteso) {
		t.Errorf("OrdineEsameFasce = %v, atteso %v", got, atteso)
	}
}

func TestOrdineEsameFasce_FasciaSenzaRichiedenti(t *testing.T) {
	fasce := []Fascia{
		{ID: "richiesta", Giorno: 1, OrarioInizio: "10:00"},
		{ID: "orfana", Giorno: 1, OrarioInizio: "09:00"},
	}
	richieste := []Richiesta{
		{FasciaID: "richiesta", AssociazioneID: "a1"},
	}

	got := OrdineEsameFasce(fasce, richieste)

	// la fascia senza richiedenti resta in coda (0 richiedenti), ordine cronologico irrilevante qui
	atteso := []string{"richiesta", "orfana"}
	if !reflect.DeepEqual(got, atteso) {
		t.Errorf("OrdineEsameFasce = %v, atteso %v", got, atteso)
	}
}
