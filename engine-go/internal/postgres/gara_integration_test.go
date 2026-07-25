package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"testing"

	"github.com/shopspring/decimal"
)

const semeGaraTest = "7f3e9a1c5b8d2f4e6a0c9b7d5e3f1a8c6b4d2e0f9a7c5b3d1e8f6a4c2b0d9e7f"

func suffissoCasuale(t *testing.T) string {
	t.Helper()
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}

// Scenario end-to-end Fase 6 (blocchi gara) → Fase 8 (round-robin):
//   - assoc1 chiede una giornata di gara (impianto omologato, 2 slot consecutivi sabato)
//   - dopo i blocchi gara, i minuti assegnati devono contare come VA iniziale (art. B.15):
//     assoc1 col fabbisogno già coperto non riceve fasce allenamento nel round-robin
//   - gli slot del blocco gara non devono rientrare tra le fasce disponibili della Fase 8
func TestIntegrazione_BlocchiGaraPoiRoundRobin(t *testing.T) {
	pool := connessioneTest(t)
	ctx := context.Background()
	sfx := suffissoCasuale(t)

	must := func(query string, args ...any) string {
		var id string
		if err := pool.QueryRow(ctx, query+" RETURNING id", args...).Scan(&id); err != nil {
			t.Fatalf("setup fixture (%s): %v", query, err)
		}
		return id
	}
	exec := func(query string, args ...any) {
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("setup fixture (%s): %v", query, err)
		}
	}

	disciplina := "TESTGARA-" + sfx
	exec(`INSERT INTO discipline_sportive (codice, denominazione) VALUES ($1, 'Disciplina test gara')`, disciplina)

	stagioneID := must(`INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2029-09-01', '2030-06-30')`,
		"gara-test-"+sfx)
	impiantoID := must(`INSERT INTO impianti (denominazione) VALUES ($1)`, "Palestra Gara "+sfx)
	spazioID := must(`INSERT INTO spazi_sportivi (impianto_id, denominazione, omologazioni) VALUES ($1, $2, $3)`,
		impiantoID, "Campo omologato", []string{disciplina})
	exec(`INSERT INTO spazio_disciplina_compatibile (spazio_id, disciplina_codice) VALUES ($1, $2)`, spazioID, disciplina)

	// sabato: due slot consecutivi (blocco gara candidato) — giorno 6
	slotGara1 := must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 6, '09:00', '10:30')`, stagioneID, spazioID)
	slotGara2 := must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 6, '10:30', '12:00')`, stagioneID, spazioID)
	// feriali: due slot NON consecutivi per gli allenamenti
	slotFeriale1 := must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 1, '16:00', '17:30')`, stagioneID, spazioID)
	slotFeriale2 := must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 3, '16:00', '17:30')`, stagioneID, spazioID)

	personaID := must(`INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Gara', $2, 'spid')`,
		"TSTGRA80A01H50"+sfx[:1], "sub-gara-"+sfx)
	assoc1ID := must(`INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2)`, "ASD Gara Uno "+sfx, "91"+sfx+"001")
	assoc2ID := must(`INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2)`, "ASD Gara Due "+sfx, "91"+sfx+"002")

	domanda1ID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'A', 60, 500, 'ammessa')`,
		"PROT-GARA-"+sfx+"-1", assoc1ID, stagioneID, personaID)
	domanda2ID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'A', 60, 500, 'ammessa')`,
		"PROT-GARA-"+sfx+"-2", assoc2ID, stagioneID, personaID)

	exec(`INSERT INTO domanda_discipline (domanda_id, disciplina_codice) VALUES ($1, $2)`, domanda1ID, disciplina)
	exec(`INSERT INTO domanda_discipline (domanda_id, disciplina_codice) VALUES ($1, $2)`, domanda2ID, disciplina)

	richiestaGaraID := must(`
		INSERT INTO richieste_giornata_gara (domanda_id, federazione, campionato, categoria, necessita_impianto_omologato)
		VALUES ($1, 'FED-TEST', 'Campionato test', 'Serie T', true)`, domanda1ID)

	// preferenze allenamento per entrambe sulle fasce feriali
	for _, d := range []string{domanda1ID, domanda2ID} {
		exec(`INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, 1)`, d, slotFeriale1)
		exec(`INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, 2)`, d, slotFeriale2)
	}

	// --- Fase 4: istruttoria (prerequisito: CRS/CP calcolati) ---
	if _, err := EseguiIstruttoria(ctx, pool, stagioneID); err != nil {
		t.Fatalf("EseguiIstruttoria: %v", err)
	}

	// --- Fase 6: blocchi gara ---
	esitoGara, elabGaraID, err := EseguiBlocchiGara(ctx, pool, stagioneID, semeGaraTest)
	if err != nil {
		t.Fatalf("EseguiBlocchiGara: %v", err)
	}
	if len(esitoGara.Assegnazioni) != 1 {
		t.Fatalf("attesa 1 assegnazione gara, avute %d", len(esitoGara.Assegnazioni))
	}
	if esitoGara.Assegnazioni[0].AssociazioneID != assoc1ID {
		t.Fatalf("blocco gara assegnato a %s, attesa assoc1 %s", esitoGara.Assegnazioni[0].AssociazioneID, assoc1ID)
	}

	// persistenza: 2 righe assegnazioni tipo blocco_gara legate alla richiesta
	rows, err := pool.Query(ctx, `
		SELECT slot_id, tipo, richiesta_giornata_gara_id, valore_minuti::text
		FROM assegnazioni WHERE elaborazione_id = $1 ORDER BY slot_id`, elabGaraID)
	if err != nil {
		t.Fatalf("lettura assegnazioni gara: %v", err)
	}
	defer rows.Close()
	slotAssegnati := map[string]bool{}
	n := 0
	for rows.Next() {
		var slotID, tipo, valoreTxt string
		var richiestaID *string
		if err := rows.Scan(&slotID, &tipo, &richiestaID, &valoreTxt); err != nil {
			t.Fatalf("scan assegnazione gara: %v", err)
		}
		n++
		slotAssegnati[slotID] = true
		if tipo != "blocco_gara" {
			t.Errorf("tipo = %s, atteso blocco_gara", tipo)
		}
		if richiestaID == nil || *richiestaID != richiestaGaraID {
			t.Errorf("richiesta_giornata_gara_id mancante o errato")
		}
		// B.14: valore in minuti GREZZI dello slot (90 minuti)
		if !decimal.RequireFromString(valoreTxt).Equal(decimal.RequireFromString("90")) {
			t.Errorf("valore_minuti = %s, atteso 90", valoreTxt)
		}
	}
	if n != 2 || !slotAssegnati[slotGara1] || !slotAssegnati[slotGara2] {
		t.Fatalf("attese 2 assegnazioni sui 2 slot gara consecutivi, trovate %d: %v", n, slotAssegnati)
	}

	var statoRichiesta string
	if err := pool.QueryRow(ctx, `SELECT stato FROM richieste_giornata_gara WHERE id = $1`, richiestaGaraID).Scan(&statoRichiesta); err != nil {
		t.Fatal(err)
	}
	if statoRichiesta != "assegnata" {
		t.Errorf("stato richiesta = %s, atteso assegnata", statoRichiesta)
	}

	// --- Fase 8: round-robin — i 180 minuti gara di assoc1 coprono già FR=60 (VA iniziale
	// art. B.15), quindi assoc1 non deve ricevere fasce allenamento; gli slot gara non
	// devono comparire tra le fasce disponibili.
	esitoRR, elabRRID, err := EseguiRoundRobin(ctx, pool, stagioneID, semeGaraTest)
	if err != nil {
		t.Fatalf("EseguiRoundRobin: %v", err)
	}
	for _, a := range esitoRR.Assegnazioni {
		if a.AssociazioneID == assoc1ID {
			t.Errorf("assoc1 (FR già coperto dal blocco gara) non doveva ricevere fasce allenamento: %+v", a)
		}
		if a.FasciaID == slotGara1 || a.FasciaID == slotGara2 {
			t.Errorf("uno slot del blocco gara è stato riassegnato nel round-robin: %+v", a)
		}
	}
	if len(esitoRR.Assegnazioni) == 0 {
		t.Fatal("assoc2 doveva ricevere almeno una fascia allenamento")
	}
	var numRR int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assegnazioni WHERE elaborazione_id = $1 AND associazione_id = $2`, elabRRID, assoc1ID).Scan(&numRR); err != nil {
		t.Fatal(err)
	}
	if numRR != 0 {
		t.Errorf("assegnazioni round-robin persistite per assoc1 = %d, attese 0", numRR)
	}

	fmt.Println("scenario blocchi gara → round-robin completato")
}
