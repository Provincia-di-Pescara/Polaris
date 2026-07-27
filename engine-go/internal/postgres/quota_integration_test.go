package postgres

import (
	"context"
	"testing"

	"github.com/shopspring/decimal"
)

// Verifica che CaricaParametricoAttivo legga la colonna quota_nuove_associazioni_pct
// (migration 000006) e che il valore raggiunga davvero roundrobin.Esegui tramite
// EseguiRoundRobin — non solo che il loader non fallisca.
func TestIntegrazione_QuotaNuoveAssociazioni_DefaultZero(t *testing.T) {
	pool := connessioneTest(t)
	ctx := context.Background()

	parametrico, err := CaricaParametricoAttivo(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if !parametrico.QuotaNuoveAssociazioniPct.Equal(decimal.Zero) {
		t.Errorf("QuotaNuoveAssociazioniPct = %s, atteso 0 (default seed)", parametrico.QuotaNuoveAssociazioniPct)
	}
}

// Scenario end-to-end: una nuova versione parametrica con quota 100% deve far vincere
// l'associazione prima_stagione su una fascia contesa anche quando l'altra avrebbe CP
// maggiore — il meccanismo dal DB fino al risultato persistito.
func TestIntegrazione_QuotaNuoveAssociazioni_ByPassaCPSullaFasciaContesta(t *testing.T) {
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

	// CaricaParametricoAttivo prende SEMPRE la versione con valida_dal più recente a
	// livello globale: inserire una nuova versione qui contamina ogni altro test/uso
	// manuale su questo DB persistente finché non viene ripulita. Cleanup esplicito
	// nell'ordine giusto delle FK (nessuna di queste ha ON DELETE CASCADE verso
	// stagioni_sportive/parametrico_versioni, a differenza degli slot).
	var stagioneID, elaborazioneID, versioneIDCleanup string
	var stagioniPrecedentiIDs, domandaIDs, impiantoIDs, associazioneIDs, personaIDs []string
	t.Cleanup(func() {
		pulisci := func(query string, args ...any) {
			if _, err := pool.Exec(ctx, query, args...); err != nil {
				t.Errorf("cleanup fallito (%s): %v", query, err)
			}
		}
		if elaborazioneID != "" {
			pulisci(`DELETE FROM assegnazioni WHERE elaborazione_id = $1`, elaborazioneID)
			pulisci(`DELETE FROM elaborazioni WHERE id = $1`, elaborazioneID)
		}
		if len(domandaIDs) > 0 {
			pulisci(`DELETE FROM domande WHERE id = ANY($1)`, domandaIDs)
		}
		if versioneIDCleanup != "" {
			pulisci(`DELETE FROM csd_scaglioni WHERE parametrico_versione_id = $1`, versioneIDCleanup)
			pulisci(`DELETE FROM parametrico_versioni WHERE id = $1`, versioneIDCleanup)
		}
		if stagioneID != "" {
			pulisci(`DELETE FROM stagioni_sportive WHERE id = $1`, stagioneID)
		}
		for _, id := range stagioniPrecedentiIDs {
			pulisci(`DELETE FROM stagioni_sportive WHERE id = $1`, id)
		}
		if len(associazioneIDs) > 0 {
			pulisci(`DELETE FROM associazioni WHERE id = ANY($1)`, associazioneIDs)
		}
		if len(personaIDs) > 0 {
			pulisci(`DELETE FROM persone_fisiche WHERE id = ANY($1)`, personaIDs)
		}
		if len(impiantoIDs) > 0 {
			pulisci(`DELETE FROM impianti WHERE id = ANY($1)`, impiantoIDs)
		}
	})

	// nuova versione parametrica: copia i default della versione attiva ma con quota 100%
	var versioneID string
	err := pool.QueryRow(ctx, `
		INSERT INTO parametrico_versioni (
			moltiplicatore_minuti_per_punto, peso_fascia_pregiata, minuti_settimanali_max,
			slot_max_stesso_impianto, fasce_pregiate_max, giornate_gara_max,
			incremento_squadre_neutro, caa_neutro, csd_neutro, tolleranza_isf_pct,
			quota_nuove_associazioni_pct
		)
		SELECT moltiplicatore_minuti_per_punto, peso_fascia_pregiata, minuti_settimanali_max,
		       slot_max_stesso_impianto, fasce_pregiate_max, giornate_gara_max,
		       incremento_squadre_neutro, caa_neutro, csd_neutro, tolleranza_isf_pct,
		       1.0000
		FROM parametrico_versioni ORDER BY valida_dal DESC LIMIT 1
		RETURNING id
	`).Scan(&versioneID)
	if err != nil {
		t.Fatalf("setup nuova versione parametrica: %v", err)
	}
	// nessuno scaglione CSD per questa versione: copiali dalla precedente per non rompere l'istruttoria
	if _, err := pool.Exec(ctx, `
		INSERT INTO csd_scaglioni (parametrico_versione_id, rapporto_fd_fr_min, rapporto_fd_fr_max, coefficiente)
		SELECT $1, rapporto_fd_fr_min, rapporto_fd_fr_max, coefficiente
		FROM csd_scaglioni WHERE parametrico_versione_id <> $1
	`, versioneID); err != nil {
		t.Fatalf("setup scaglioni CSD: %v", err)
	}

	versioneIDCleanup = versioneID

	stagioneID = must(`INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2033-09-01', '2034-06-30')`,
		"quota-test-"+sfx)
	impiantoID := must(`INSERT INTO impianti (denominazione) VALUES ($1)`, "Palestra Quota "+sfx)
	impiantoIDs = []string{impiantoID}
	spazioID := must(`INSERT INTO spazi_sportivi (impianto_id, denominazione) VALUES ($1, $2)`, impiantoID, "Campo "+sfx)
	slotID := must(`INSERT INTO slot_settimana_tipo (stagione_id, spazio_id, giorno_settimana, orario_inizio, orario_fine) VALUES ($1, $2, 1, '16:00', '17:30')`, stagioneID, spazioID)

	personaID := must(`INSERT INTO persone_fisiche (codice_fiscale, nome, cognome, oidc_subject, oidc_provider) VALUES ($1, 'Test', 'Quota', $2, 'spid')`,
		"TSTQTA-"+sfx, "sub-quota-"+sfx)
	personaIDs = []string{personaID}
	assocNuovaID := must(`INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva) VALUES ($1, $2)`, "ASD Quota Nuova "+sfx, "92"+sfx+"001")
	assocStoricaID := must(`INSERT INTO associazioni (denominazione, codice_fiscale_partita_iva, data_costituzione) VALUES ($1, $2, '2010-01-01')`, "ASD Quota Storica "+sfx, "92"+sfx+"002")
	associazioneIDs = []string{assocNuovaID, assocStoricaID}

	// assocStorica ha già partecipato in una stagione precedente (data_inizio anteriore):
	// EseguiIstruttoria calcola prima_stagione=false per la sua domanda in QUESTA
	// stagione. assocNuova non ha alcuna domanda pregressa -> prima_stagione=true.
	// Senza questa distinzione entrambe risulterebbero "prima stagione" (nessuna storia)
	// e la quota non discriminerebbe nulla.
	stagionePrecedenteID := must(`INSERT INTO stagioni_sportive (nome, data_inizio, data_fine) VALUES ($1, '2031-09-01', '2032-06-30')`,
		"quota-test-precedente-"+sfx)
	stagioniPrecedentiIDs = []string{stagionePrecedenteID}
	domandaPrecedenteID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'A', 60, 500, 'ammessa')`,
		"PROT-QUOTA-"+sfx+"-0", assocStoricaID, stagionePrecedenteID, personaID)
	domandaIDs = append(domandaIDs, domandaPrecedenteID)

	domandaNuovaID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'A', 60, 500, 'ammessa')`,
		"PROT-QUOTA-"+sfx+"-1", assocNuovaID, stagioneID, personaID)
	// classe E (peso più alto) per garantire a assocStorica un CP maggiore a parità di CSD/CAA neutri,
	// cosicché senza la quota vincerebbe lei per CP — dimostra che la quota bypassa quel criterio
	domandaStoricaID := must(`
		INSERT INTO domande (numero_protocollo, associazione_id, stagione_id, presentata_da_persona_fisica_id,
			classe_attivita_codice, fabbisogno_minimo_minuti, fabbisogno_ottimale_minuti, stato)
		VALUES ($1, $2, $3, $4, 'E', 60, 500, 'ammessa')`,
		"PROT-QUOTA-"+sfx+"-2", assocStoricaID, stagioneID, personaID)
	domandaIDs = append(domandaIDs, domandaNuovaID, domandaStoricaID)

	for _, d := range []string{domandaNuovaID, domandaStoricaID} {
		if _, err := pool.Exec(ctx, `INSERT INTO preferenze (domanda_id, slot_id, ordine_preferenza) VALUES ($1, $2, 1)`, d, slotID); err != nil {
			t.Fatalf("setup preferenza: %v", err)
		}
	}

	if _, err := EseguiIstruttoria(ctx, pool, stagioneID); err != nil {
		t.Fatalf("EseguiIstruttoria: %v", err)
	}

	var cpNuova, cpStorica string
	if err := pool.QueryRow(ctx, `SELECT cp::text FROM coefficienti_associazione WHERE domanda_id = $1`, domandaNuovaID).Scan(&cpNuova); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT cp::text FROM coefficienti_associazione WHERE domanda_id = $1`, domandaStoricaID).Scan(&cpStorica); err != nil {
		t.Fatal(err)
	}
	if !decimal.RequireFromString(cpStorica).GreaterThan(decimal.RequireFromString(cpNuova)) {
		t.Fatalf("precondizione test non soddisfatta: CP storica (%s) deve essere > CP nuova (%s)", cpStorica, cpNuova)
	}

	esito, elaborazioneID, err := EseguiRoundRobin(ctx, pool, stagioneID, semeGaraTest)
	if err != nil {
		t.Fatalf("EseguiRoundRobin: %v", err)
	}
	if len(esito.Assegnazioni) != 1 || esito.Assegnazioni[0].AssociazioneID != assocNuovaID {
		t.Fatalf("con quota 100%% doveva vincere la prima_stagione nonostante CP minore: %+v", esito.Assegnazioni)
	}

	var associazionePersistita string
	if err := pool.QueryRow(ctx, `SELECT associazione_id FROM assegnazioni WHERE elaborazione_id = $1 AND slot_id = $2`, elaborazioneID, slotID).Scan(&associazionePersistita); err != nil {
		t.Fatal(err)
	}
	if associazionePersistita != assocNuovaID {
		t.Errorf("persistito associazione_id = %s, atteso %s (nuova)", associazionePersistita, assocNuovaID)
	}
}
