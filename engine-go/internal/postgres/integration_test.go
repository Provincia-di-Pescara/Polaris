package postgres

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

// Test di integrazione contro Postgres reale (schema + seed di db/migrations applicati).
// Skippato se TEST_DATABASE_URL non è impostata — vedi CLAUDE.md per come lanciarlo.
func connessioneTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL non impostata, salto il test di integrazione")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connessione a Postgres: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

const semeIntegrationTest = "2b9e6b2f5c8a4d1e0f3c7b6a9d8e5f4c1b0a3d6e9f8c7b6a5d4e3f2c1b0a9d8e"

func TestIntegrazione_IstruttoriaERoundRobin(t *testing.T) {
	pool := connessioneTest(t)
	ctx := context.Background()

	var stagioneID, impiantoID, spazioID, slot1ID, slot2ID, personaID, assoc1ID, assoc2ID string

	must := func(query string, args ...any) string {
		var id string
		if err := pool.QueryRow(ctx, query+" RETURNING id", args...).Scan(&id); err != nil {
			t.Fatalf("setup fixture (%s): %v", query, err)
		}
		return id
	}

	// suffisso per-esecuzione su ogni valore UNIQUE: il test deve restare rieseguibile
	// su un DB locale persistente (in CI il DB è sempre fresco e non si vede)
	sfx := suffissoCasuale(t)
	stagioneID = must(`INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, $2, $3)`,
		"2027/2028 - test integrazione "+sfx, "2027-09-01", "2028-06-30")
	impiantoID = must(`INSERT INTO impianti (denominazione) VALUES ($1)`, "Palestra Integrazione")
	spazioID = must(`INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, $2)`, impiantoID, "Palestra grande")
	slot1ID = must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 1, '16:30', '18:00')`,
		stagioneID, spazioID)
	slot2ID = must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 1, '18:00', '19:30')`,
		stagioneID, spazioID)
	personaID = must(`INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Integrazione', $2, 'spid')`,
		"TSTNTG-"+sfx, "sub-integrazione-"+sfx)
	assoc1ID = must(`INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2)`, "ASD Integrazione Uno "+sfx, "90"+sfx+"001")
	assoc2ID = must(`INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2)`, "ASD Integrazione Due "+sfx, "90"+sfx+"002")

	domanda1ID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'A', 60, 500, 'ammessa')`,
		"PROT-TEST-"+sfx+"-1", assoc1ID, stagioneID, personaID)
	domanda2ID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'A', 60, 500, 'ammessa')`,
		"PROT-TEST-"+sfx+"-2", assoc2ID, stagioneID, personaID)

	for _, d := range []string{domanda1ID, domanda2ID} {
		if _, err := pool.Exec(ctx, `INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, 1)`, d, slot1ID); err != nil {
			t.Fatalf("setup preferenza slot1: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, 2)`, d, slot2ID); err != nil {
			t.Fatalf("setup preferenza slot2: %v", err)
		}
	}

	// --- Fase 4: istruttoria ---
	numCalcolate, err := EseguiIstruttoria(ctx, pool, stagioneID)
	if err != nil {
		t.Fatalf("EseguiIstruttoria: %v", err)
	}
	if numCalcolate != 2 {
		t.Fatalf("EseguiIstruttoria ha calcolato %d domande, attese 2", numCalcolate)
	}

	var frFinaleTxt, crsTxt, caaTxt, csdTxt, cpTxt string
	var primaStagione bool
	err = pool.QueryRow(ctx, `SELECT fr_finale_minuti::text FROM fabbisogni_riconosciuti WHERE domanda_id = $1`, domanda1ID).Scan(&frFinaleTxt)
	if err != nil {
		t.Fatalf("lettura fabbisogno persistito: %v", err)
	}
	// classe A peso_base=1, incremento neutro=0 (prima stagione, nessuna domanda in stagioni precedenti),
	// moltiplicatore placeholder 60 -> FR calcolato = 60; FD=500 non è il tetto -> FR finale = 60.
	if !decimal.RequireFromString(frFinaleTxt).Equal(decimal.RequireFromString("60.000")) {
		t.Errorf("FR finale persistito = %s, atteso 60.000", frFinaleTxt)
	}

	err = pool.QueryRow(ctx, `SELECT crs::text, caa::text, csd::text, cp::text, prima_stagione FROM coefficienti_associazione WHERE domanda_id = $1`, domanda1ID).
		Scan(&crsTxt, &caaTxt, &csdTxt, &cpTxt, &primaStagione)
	if err != nil {
		t.Fatalf("lettura coefficienti persistiti: %v", err)
	}
	if !primaStagione {
		t.Error("prima_stagione persistito = false, atteso true (nessuna domanda in stagioni precedenti)")
	}
	if !decimal.RequireFromString(caaTxt).Equal(decimal.RequireFromString("1.000")) {
		t.Errorf("CAA persistito = %s, atteso 1.000 (neutro, prima stagione)", caaTxt)
	}

	// --- Fase 8: round-robin ---
	esito, elaborazioneID, err := EseguiRoundRobin(ctx, pool, stagioneID, semeIntegrationTest)
	if err != nil {
		t.Fatalf("EseguiRoundRobin: %v", err)
	}
	if len(esito.Assegnazioni) != 2 {
		t.Fatalf("EseguiRoundRobin: %d assegnazioni in memoria, attese 2", len(esito.Assegnazioni))
	}

	var numAssegnazioniDB int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assegnazioni WHERE elaborazione_id = $1`, elaborazioneID).Scan(&numAssegnazioniDB); err != nil {
		t.Fatalf("conteggio assegnazioni persistite: %v", err)
	}
	if numAssegnazioniDB != 2 {
		t.Fatalf("assegnazioni persistite in DB = %d, attese 2", numAssegnazioniDB)
	}

	slotAssegnati := map[string]bool{}
	rows, err := pool.Query(ctx, `SELECT slot_id, tipo, valore_minuti::text FROM assegnazioni WHERE elaborazione_id = $1`, elaborazioneID)
	if err != nil {
		t.Fatalf("lettura assegnazioni persistite: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var slotID, tipo, valoreTxt string
		if err := rows.Scan(&slotID, &tipo, &valoreTxt); err != nil {
			t.Fatalf("scan assegnazione: %v", err)
		}
		slotAssegnati[slotID] = true
		if tipo != "singola" {
			t.Errorf("tipo assegnazione = %s, atteso singola (nessun blocco allenamento in questo scenario)", tipo)
		}
		if !decimal.RequireFromString(valoreTxt).Equal(decimal.RequireFromString("90")) {
			t.Errorf("valore_minuti = %s, atteso 90 (durata slot, nessuna fascia pregiata)", valoreTxt)
		}
	}
	if !slotAssegnati[slot1ID] || !slotAssegnati[slot2ID] {
		t.Errorf("attesi entrambi gli slot assegnati, trovato: %+v", slotAssegnati)
	}

	var statoElaborazione string
	if err := pool.QueryRow(ctx, `SELECT stato FROM elaborazioni WHERE id = $1`, elaborazioneID).Scan(&statoElaborazione); err != nil {
		t.Fatalf("lettura stato elaborazione: %v", err)
	}
	if statoElaborazione != "completata" {
		t.Errorf("stato elaborazione = %s, atteso completata", statoElaborazione)
	}
}
