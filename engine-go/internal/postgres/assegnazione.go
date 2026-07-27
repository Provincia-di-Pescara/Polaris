package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/provincia/palestre-engine/internal/roundrobin"
	"github.com/provincia/palestre-engine/internal/sorteggio"
	"github.com/shopspring/decimal"
)

func valorePonderatoFascia(f roundrobin.Fascia, pesoFasciaPregiata decimal.Decimal) decimal.Decimal {
	durata := decimal.NewFromInt(int64(f.DurataMinutiGrezzi))
	if f.Pregiata {
		return durata.Mul(pesoFasciaPregiata)
	}
	return durata
}

// SnapshotRoundRobin è tutto ciò che serve a roundrobin.Esegui, più le mappe di
// corrispondenza necessarie a persistere il risultato (l'engine lavora solo con
// associazione_id/fascia_id, non conosce domanda_id).
type SnapshotRoundRobin struct {
	Input                    roundrobin.InputEsecuzione
	FasceByID                map[string]roundrobin.Fascia
	DomandaIDPerAssociazione map[string]string
}

func caricaFasce(ctx context.Context, pool *pgxpool.Pool, stagioneID string, pesoFasciaPregiata decimal.Decimal) ([]roundrobin.Fascia, error) {
	rows, err := pool.Query(ctx, `
		SELECT st.id, sp.impianto_id, st.giorno_settimana, to_char(st.orario_inizio, 'HH24:MI'),
		       st.durata_minuti, st.pregiata
		FROM slot_settimana_tipo st
		JOIN spazi_sportivi sp ON sp.id = st.spazio_id
		WHERE st.stagione_id = $1 AND st.indisponibile_permanente = false
		  -- esclusi gli slot con un'assegnazione attiva (blocchi gara della Fase 6):
		  -- il round-robin lavora solo sulle fasce ancora libere
		  AND NOT EXISTS (
		      SELECT 1 FROM assegnazioni a
		      WHERE a.slot_id = st.id AND a.stato IN ('provvisoria', 'validata')
		  )
	`, stagioneID)
	if err != nil {
		return nil, fmt.Errorf("caricamento fasce: %w", err)
	}
	defer rows.Close()

	var out []roundrobin.Fascia
	for rows.Next() {
		var f roundrobin.Fascia
		if err := rows.Scan(&f.ID, &f.ImpiantoID, &f.Giorno, &f.OrarioInizio, &f.DurataMinutiGrezzi, &f.Pregiata); err != nil {
			return nil, fmt.Errorf("caricamento fasce: %w", err)
		}
		f.ValorePonderato = valorePonderatoFascia(f, pesoFasciaPregiata)
		out = append(out, f)
	}
	return out, rows.Err()
}

func caricaRichieste(ctx context.Context, pool *pgxpool.Pool, stagioneID string) ([]roundrobin.Richiesta, error) {
	rows, err := pool.Query(ctx, `
		SELECT d.associazione_id, p.slot_id, p.ordine_preferenza
		FROM preferenze p
		JOIN domande d ON d.id = p.domanda_id
		WHERE d.stagione_id = $1 AND d.stato = 'ammessa'
	`, stagioneID)
	if err != nil {
		return nil, fmt.Errorf("caricamento richieste: %w", err)
	}
	defer rows.Close()

	var out []roundrobin.Richiesta
	for rows.Next() {
		var r roundrobin.Richiesta
		if err := rows.Scan(&r.AssociazioneID, &r.FasciaID, &r.OrdinePreferenza); err != nil {
			return nil, fmt.Errorf("caricamento richieste: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func caricaBlocchiAllenamento(ctx context.Context, pool *pgxpool.Pool, stagioneID string) ([]roundrobin.BloccoAllenamento, error) {
	rows, err := pool.Query(ctx, `
		SELECT b.id, d.associazione_id, array_agg(bs.slot_id::text ORDER BY bs.slot_id)
		FROM blocchi_allenamento_richiesti b
		JOIN domande d ON d.id = b.domanda_id
		JOIN blocco_allenamento_slot bs ON bs.blocco_id = b.id
		WHERE d.stagione_id = $1 AND d.stato = 'ammessa'
		GROUP BY b.id, d.associazione_id
	`, stagioneID)
	if err != nil {
		return nil, fmt.Errorf("caricamento blocchi allenamento: %w", err)
	}
	defer rows.Close()

	var out []roundrobin.BloccoAllenamento
	for rows.Next() {
		var b roundrobin.BloccoAllenamento
		if err := rows.Scan(&b.ID, &b.AssociazioneID, &b.FasceID); err != nil {
			return nil, fmt.Errorf("caricamento blocchi allenamento: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func caricaAssociazioniConFabbisogno(ctx context.Context, pool *pgxpool.Pool, stagioneID string) ([]roundrobin.Associazione, map[string]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT d.id, d.associazione_id, fr.fr_finale_minuti::text, co.cp::text, co.prima_stagione
		FROM domande d
		JOIN fabbisogni_riconosciuti fr ON fr.domanda_id = d.id
		JOIN coefficienti_associazione co ON co.domanda_id = d.id
		WHERE d.stagione_id = $1 AND d.stato = 'ammessa'
	`, stagioneID)
	if err != nil {
		return nil, nil, fmt.Errorf("caricamento associazioni/fabbisogno: %w", err)
	}
	defer rows.Close()

	var associazioni []roundrobin.Associazione
	domandaIDPerAssociazione := make(map[string]string)
	for rows.Next() {
		var domandaID, associazioneID, frTxt, cpTxt string
		var primaStagione bool
		if err := rows.Scan(&domandaID, &associazioneID, &frTxt, &cpTxt, &primaStagione); err != nil {
			return nil, nil, fmt.Errorf("caricamento associazioni/fabbisogno: %w", err)
		}
		fr, err := decimalDaTesto(frTxt)
		if err != nil {
			return nil, nil, err
		}
		cp, err := decimalDaTesto(cpTxt)
		if err != nil {
			return nil, nil, err
		}
		associazioni = append(associazioni, roundrobin.Associazione{ID: associazioneID, FR: fr, CP: cp, PrimaStagione: primaStagione})
		domandaIDPerAssociazione[associazioneID] = domandaID
	}
	return associazioni, domandaIDPerAssociazione, rows.Err()
}

// caricaStatoIniziale ricostruisce dalle assegnazioni attive pregresse (blocchi gara,
// Fase 6) il VA iniziale (art. B.15 — B.14: le fasce gara concorrono integralmente, in
// minuti grezzi, al soddisfacimento del FR) e lo stato di concentrazione iniziale
// (art. B.19: i minuti e gli slot gara contano nei limiti; art. B.20: l'impianto del
// blocco gara conta come "già usato" nel tie-break di contiguità).
func caricaStatoIniziale(ctx context.Context, pool *pgxpool.Pool, stagioneID string) (map[string]decimal.Decimal, map[string]roundrobin.StatoConcentrazione, error) {
	rows, err := pool.Query(ctx, `
		SELECT a.associazione_id, a.valore_minuti::text, st.durata_minuti, sp.impianto_id, st.pregiata
		FROM assegnazioni a
		JOIN slot_settimana_tipo st ON st.id = a.slot_id
		JOIN spazi_sportivi sp ON sp.id = st.spazio_id
		WHERE st.stagione_id = $1 AND a.stato IN ('provvisoria', 'validata')
	`, stagioneID)
	if err != nil {
		return nil, nil, fmt.Errorf("caricamento stato iniziale: %w", err)
	}
	defer rows.Close()

	vaIniziale := map[string]decimal.Decimal{}
	statoIniziale := map[string]roundrobin.StatoConcentrazione{}
	for rows.Next() {
		var associazioneID, valoreTxt, impiantoID string
		var durata int
		var pregiata bool
		if err := rows.Scan(&associazioneID, &valoreTxt, &durata, &impiantoID, &pregiata); err != nil {
			return nil, nil, fmt.Errorf("caricamento stato iniziale: %w", err)
		}
		valore, err := decimalDaTesto(valoreTxt)
		if err != nil {
			return nil, nil, err
		}
		vaIniziale[associazioneID] = vaIniziale[associazioneID].Add(valore)

		s, ok := statoIniziale[associazioneID]
		if !ok {
			s = roundrobin.StatoConcentrazione{SlotPerImpianto: map[string]int{}}
		}
		s.MinutiGrezziAssegnati += durata
		s.SlotPerImpianto[impiantoID]++
		if pregiata {
			s.FascePregiateAssegnate++
		}
		statoIniziale[associazioneID] = s
	}
	return vaIniziale, statoIniziale, rows.Err()
}

// CaricaSnapshotRoundRobin legge tutto quanto serve alla Fase 8 (art. B.17-22) per una
// stagione. Richiede che EseguiIstruttoria sia già stato eseguito (fabbisogni_riconosciuti
// e coefficienti_associazione popolati per le domande ammesse).
func CaricaSnapshotRoundRobin(ctx context.Context, pool *pgxpool.Pool, stagioneID string, parametrico ParametricoCaricato, semeHex string) (SnapshotRoundRobin, error) {
	fasce, err := caricaFasce(ctx, pool, stagioneID, parametrico.PesoFasciaPregiata)
	if err != nil {
		return SnapshotRoundRobin{}, err
	}
	richieste, err := caricaRichieste(ctx, pool, stagioneID)
	if err != nil {
		return SnapshotRoundRobin{}, err
	}
	blocchi, err := caricaBlocchiAllenamento(ctx, pool, stagioneID)
	if err != nil {
		return SnapshotRoundRobin{}, err
	}
	associazioni, domandaIDPerAssociazione, err := caricaAssociazioniConFabbisogno(ctx, pool, stagioneID)
	if err != nil {
		return SnapshotRoundRobin{}, err
	}
	vaIniziale, statoIniziale, err := caricaStatoIniziale(ctx, pool, stagioneID)
	if err != nil {
		return SnapshotRoundRobin{}, err
	}

	fasceByID := make(map[string]roundrobin.Fascia, len(fasce))
	for _, f := range fasce {
		fasceByID[f.ID] = f
	}

	return SnapshotRoundRobin{
		Input: roundrobin.InputEsecuzione{
			Fasce:                     fasce,
			Richieste:                 richieste,
			BlocchiAllenamento:        blocchi,
			Associazioni:              associazioni,
			VAIniziale:                vaIniziale,
			StatoIniziale:             statoIniziale,
			Limiti:                    parametrico.Limiti,
			TolleranzaISF:             parametrico.TolleranzaISF,
			QuotaNuoveAssociazioniPct: parametrico.QuotaNuoveAssociazioniPct,
			SemeHex:                   semeHex,
		},
		FasceByID:                fasceByID,
		DomandaIDPerAssociazione: domandaIDPerAssociazione,
	}, nil
}

// PersistiEsitoRoundRobin scrive l'esito del round-robin in transazione: la riga
// elaborazioni, tutte le assegnazioni e, dove è stato necessario, il verbale di
// sorteggio tracciato con i suoi candidati.
func PersistiEsitoRoundRobin(ctx context.Context, pool *pgxpool.Pool, stagioneID, parametricoVersioneID string, snapshot SnapshotRoundRobin, esito roundrobin.Esito) (elaborazioneID string, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("apertura transazione round-robin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op se già committata

	err = tx.QueryRow(ctx, `
		INSERT INTO elaborazioni (stagione_id, tipo, parametrico_versione_id, conclusa_il, stato, numero_round_eseguiti)
		VALUES ($1, 'prima_assegnazione', $2, now(), 'completata', $3)
		RETURNING id
	`, stagioneID, parametricoVersioneID, esito.RoundEseguiti).Scan(&elaborazioneID)
	if err != nil {
		return "", fmt.Errorf("inserimento elaborazione: %w", err)
	}

	for _, a := range esito.Assegnazioni {
		domandaID, ok := snapshot.DomandaIDPerAssociazione[a.AssociazioneID]
		if !ok {
			return "", fmt.Errorf("nessuna domanda trovata per associazione %s in questa stagione", a.AssociazioneID)
		}
		fascia, ok := snapshot.FasceByID[a.FasciaID]
		if !ok {
			return "", fmt.Errorf("fascia %s non trovata nello snapshot", a.FasciaID)
		}

		tipo := "singola"
		var bloccoID *string
		if a.BloccoAllenamentoID != "" {
			tipo = "blocco_allenamento"
			bloccoID = &a.BloccoAllenamentoID
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO assegnazioni
				(slot_id, domanda_id, associazione_id, elaborazione_id, tipo, blocco_allenamento_id, round_numero, valore_minuti)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric)
		`, a.FasciaID, domandaID, a.AssociazioneID, elaborazioneID, tipo, bloccoID, a.RoundNumero, fascia.ValorePonderato.String()); err != nil {
			return "", fmt.Errorf("inserimento assegnazione fascia %s: %w", a.FasciaID, err)
		}

		if a.SorteggioVerbale != nil {
			if err := persistiVerbaleSorteggio(ctx, tx, elaborazioneID, "B.21",
				"parità totale nella catena di priorità della fascia", a.SorteggioVerbale); err != nil {
				return "", err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit transazione round-robin: %w", err)
	}
	return elaborazioneID, nil
}

func persistiVerbaleSorteggio(ctx context.Context, tx pgx.Tx, elaborazioneID, articolo, contesto string, v *sorteggio.Verbale) error {
	var sorteggioID string
	err := tx.QueryRow(ctx, `
		INSERT INTO sorteggi
			(elaborazione_id, articolo_riferimento, contesto, seme_hex, algoritmo, algoritmo_versione, vincitore_associazione_id, hash_verbale)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`, elaborazioneID, articolo, contesto, v.SemeHex, v.Algoritmo, v.AlgoritmoVersione, v.VincitoreAssociazioneID, v.HashVerbale).Scan(&sorteggioID)
	if err != nil {
		return fmt.Errorf("inserimento verbale sorteggio: %w", err)
	}

	for _, c := range v.Candidati {
		if _, err := tx.Exec(ctx, `
			INSERT INTO sorteggio_candidati (sorteggio_id, associazione_id, ordine_canonico, hmac_hex, rank)
			VALUES ($1, $2, $3, $4, $5)
		`, sorteggioID, c.AssociazioneID, c.OrdineCanonico, c.HMACHex, c.Rank); err != nil {
			return fmt.Errorf("inserimento candidato sorteggio: %w", err)
		}
	}
	return nil
}
