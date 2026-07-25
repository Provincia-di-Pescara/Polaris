package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/provincia/palestre-engine/internal/gara"
)

// EseguiBlocchiGara implementa la Fase 6 (art. B.12-B.14) end-to-end: carica le
// richieste di giornata gara in esame con i coefficienti della catena di priorità
// (richiede EseguiIstruttoria già eseguita), individua per ciascuna gli slot ammissibili
// (art. B.13: spazio compatibile con una disciplina della domanda e, se richiesto,
// impianto omologato per quella disciplina), esegue l'assegnazione deterministica e
// persiste tutto in transazione.
func EseguiBlocchiGara(ctx context.Context, pool *pgxpool.Pool, stagioneID, semeHex string) (gara.Esito, string, error) {
	parametrico, err := CaricaParametricoAttivo(ctx, pool)
	if err != nil {
		return gara.Esito{}, "", err
	}

	slots, err := caricaSlotLiberi(ctx, pool, stagioneID)
	if err != nil {
		return gara.Esito{}, "", err
	}
	richieste, domandaPerRichiesta, err := caricaRichiesteGara(ctx, pool, stagioneID)
	if err != nil {
		return gara.Esito{}, "", err
	}

	esito, err := gara.Esegui(richieste, slots, parametrico.Limiti.GiornateGaraMax, semeHex)
	if err != nil {
		return gara.Esito{}, "", fmt.Errorf("esecuzione blocchi gara: %w", err)
	}

	elaborazioneID, err := persistiEsitoBlocchiGara(ctx, pool, stagioneID, parametrico.VersioneID, slots, domandaPerRichiesta, esito)
	if err != nil {
		return gara.Esito{}, "", err
	}
	return esito, elaborazioneID, nil
}

// caricaSlotLiberi legge gli slot della stagione senza un'assegnazione attiva, con gli
// orari in minuti dalla mezzanotte (il test di consecutività del package gara).
func caricaSlotLiberi(ctx context.Context, pool *pgxpool.Pool, stagioneID string) ([]gara.Slot, error) {
	rows, err := pool.Query(ctx, `
		SELECT st.id, st.spazio_id, sp.impianto_id, st.giorno_settimana,
		       (EXTRACT(EPOCH FROM st.orario_inizio) / 60)::int,
		       (EXTRACT(EPOCH FROM st.orario_fine) / 60)::int
		FROM slot_settimana_tipo st
		JOIN spazi_sportivi sp ON sp.id = st.spazio_id
		WHERE st.stagione_id = $1 AND st.indisponibile_permanente = false
		  AND NOT EXISTS (
		      SELECT 1 FROM assegnazioni a
		      WHERE a.slot_id = st.id AND a.stato IN ('provvisoria', 'validata')
		  )
	`, stagioneID)
	if err != nil {
		return nil, fmt.Errorf("caricamento slot liberi: %w", err)
	}
	defer rows.Close()

	var out []gara.Slot
	for rows.Next() {
		var s gara.Slot
		if err := rows.Scan(&s.ID, &s.SpazioID, &s.ImpiantoID, &s.Giorno, &s.InizioMinuti, &s.FineMinuti); err != nil {
			return nil, fmt.Errorf("caricamento slot liberi: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// caricaRichiesteGara legge le richieste in esame delle domande ammesse con CRS/CP
// dall'istruttoria e per ciascuna calcola in SQL l'insieme degli slot ammissibili
// (art. B.13): spazio compatibile con una disciplina della domanda; se la richiesta
// esige l'omologazione, lo spazio deve essere omologato per una disciplina della domanda.
func caricaRichiesteGara(ctx context.Context, pool *pgxpool.Pool, stagioneID string) ([]gara.Richiesta, map[string]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT r.id, d.id, d.associazione_id, co.crs::text, co.cp::text
		FROM richieste_giornata_gara r
		JOIN domande d ON d.id = r.domanda_id
		JOIN coefficienti_associazione co ON co.domanda_id = d.id
		WHERE d.stagione_id = $1 AND d.stato = 'ammessa' AND r.stato = 'in_esame'
	`, stagioneID)
	if err != nil {
		return nil, nil, fmt.Errorf("caricamento richieste gara: %w", err)
	}
	defer rows.Close()

	var richieste []gara.Richiesta
	domandaPerRichiesta := map[string]string{}
	for rows.Next() {
		var r gara.Richiesta
		var domandaID, crsTxt, cpTxt string
		if err := rows.Scan(&r.ID, &domandaID, &r.AssociazioneID, &crsTxt, &cpTxt); err != nil {
			return nil, nil, fmt.Errorf("caricamento richieste gara: %w", err)
		}
		if r.CRS, err = decimalDaTesto(crsTxt); err != nil {
			return nil, nil, err
		}
		if r.CP, err = decimalDaTesto(cpTxt); err != nil {
			return nil, nil, err
		}
		r.SlotAmmissibili = map[string]bool{}
		domandaPerRichiesta[r.ID] = domandaID
		richieste = append(richieste, r)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	rows.Close()

	ammissibili, err := pool.Query(ctx, `
		SELECT r.id, st.id
		FROM richieste_giornata_gara r
		JOIN domande d ON d.id = r.domanda_id
		JOIN slot_settimana_tipo st ON st.stagione_id = d.stagione_id AND st.indisponibile_permanente = false
		JOIN spazi_sportivi sp ON sp.id = st.spazio_id
		WHERE d.stagione_id = $1 AND d.stato = 'ammessa' AND r.stato = 'in_esame'
		  AND EXISTS (
		      SELECT 1 FROM domanda_discipline dd
		      JOIN spazio_disciplina_compatibile sdc
		        ON sdc.disciplina_codice = dd.disciplina_codice AND sdc.spazio_id = sp.id
		      WHERE dd.domanda_id = d.id
		  )
		  AND (
		      NOT r.necessita_impianto_omologato
		      OR EXISTS (
		          SELECT 1 FROM domanda_discipline dd2
		          WHERE dd2.domanda_id = d.id AND dd2.disciplina_codice = ANY(COALESCE(sp.omologazioni, '{}'))
		      )
		  )
	`, stagioneID)
	if err != nil {
		return nil, nil, fmt.Errorf("caricamento ammissibilità slot gara: %w", err)
	}
	defer ammissibili.Close()

	perRichiesta := map[string]map[string]bool{}
	for ammissibili.Next() {
		var richiestaID, slotID string
		if err := ammissibili.Scan(&richiestaID, &slotID); err != nil {
			return nil, nil, fmt.Errorf("caricamento ammissibilità slot gara: %w", err)
		}
		if perRichiesta[richiestaID] == nil {
			perRichiesta[richiestaID] = map[string]bool{}
		}
		perRichiesta[richiestaID][slotID] = true
	}
	if err := ammissibili.Err(); err != nil {
		return nil, nil, err
	}
	for i := range richieste {
		if m, ok := perRichiesta[richieste[i].ID]; ok {
			richieste[i].SlotAmmissibili = m
		}
	}
	return richieste, domandaPerRichiesta, nil
}

// persistiEsitoBlocchiGara scrive in transazione: la riga elaborazioni, una riga
// assegnazioni per OGNI slot del blocco (tipo blocco_gara, valore in minuti grezzi —
// art. B.14: le fasce gara concorrono per il loro valore in minuti), l'aggiornamento di
// stato delle richieste e gli eventuali verbali di sorteggio (art. B.14 → B.38).
func persistiEsitoBlocchiGara(
	ctx context.Context,
	pool *pgxpool.Pool,
	stagioneID, parametricoVersioneID string,
	slots []gara.Slot,
	domandaPerRichiesta map[string]string,
	esito gara.Esito,
) (string, error) {
	durataPerSlot := make(map[string]int, len(slots))
	for _, s := range slots {
		durataPerSlot[s.ID] = s.FineMinuti - s.InizioMinuti
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("apertura transazione blocchi gara: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op se già committata

	var elaborazioneID string
	err = tx.QueryRow(ctx, `
		INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, conclusa_il, stato)
		VALUES ($1, 'blocchi_gara', $2, now(), 'completata')
		RETURNING id
	`, stagioneID, parametricoVersioneID).Scan(&elaborazioneID)
	if err != nil {
		return "", fmt.Errorf("inserimento elaborazione blocchi gara: %w", err)
	}

	for _, a := range esito.Assegnazioni {
		domandaID, ok := domandaPerRichiesta[a.RichiestaID]
		if !ok {
			return "", fmt.Errorf("nessuna domanda per richiesta gara %s", a.RichiestaID)
		}
		for _, slotID := range a.SlotIDs {
			if _, err := tx.Exec(ctx, `
				INSERT INTO assegnazioni
					(slot_id, domanda_id, associazione_id, elaborazione_id, tipo, richiesta_giornata_gara_id, valore_minuti)
				VALUES ($1, $2, $3, $4, 'blocco_gara', $5, $6::numeric)
			`, slotID, domandaID, a.AssociazioneID, elaborazioneID, a.RichiestaID, durataPerSlot[slotID]); err != nil {
				return "", fmt.Errorf("inserimento assegnazione gara slot %s: %w", slotID, err)
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE richieste_giornata_gara SET stato = 'assegnata' WHERE id = $1`, a.RichiestaID); err != nil {
			return "", fmt.Errorf("aggiornamento stato richiesta %s: %w", a.RichiestaID, err)
		}
		if a.SorteggioVerbale != nil {
			if err := persistiVerbaleSorteggio(ctx, tx, elaborazioneID, "B.14",
				"concorrenza sul medesimo blocco gara a parità di CRS e CP", a.SorteggioVerbale); err != nil {
				return "", err
			}
		}
	}

	for _, richiestaID := range esito.NonAssegnate {
		if _, err := tx.Exec(ctx, `UPDATE richieste_giornata_gara SET stato = 'non_assegnata' WHERE id = $1`, richiestaID); err != nil {
			return "", fmt.Errorf("aggiornamento stato richiesta non assegnata %s: %w", richiestaID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit transazione blocchi gara: %w", err)
	}
	return elaborazioneID, nil
}
