package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/provincia/palestre-engine/internal/istruttoria"
	"github.com/shopspring/decimal"
)

type domandaDaCalcolare struct {
	domandaID string
	dati      istruttoria.DatiDomanda
}

func caricaDomandeAmmesse(ctx context.Context, pool *pgxpool.Pool, stagioneID string) ([]domandaDaCalcolare, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			d.id,
			d.classe_attivita_codice,
			d.livello_campionato,
			d.numero_squadre_federali_stagione_precedente,
			d.fabbisogno_ottimale_minuti::text,
			CASE WHEN a.data_costituzione IS NULL THEN NULL
			     ELSE ((s.data_inizio - a.data_costituzione)::numeric / 365.25)::text
			END AS anni_attivita,
			NOT EXISTS (
				SELECT 1 FROM domande d2
				JOIN stagioni_sportive s2 ON s2.id = d2.stagione_id
				WHERE d2.associazione_id = d.associazione_id
				  AND d2.stato = 'ammessa'
				  AND s2.data_inizio < s.data_inizio
			) AS prima_stagione
		FROM domande d
		JOIN associazioni a ON a.id = d.associazione_id
		JOIN stagioni_sportive s ON s.id = d.stagione_id
		WHERE d.stagione_id = $1 AND d.stato = 'ammessa'
	`, stagioneID)
	if err != nil {
		return nil, fmt.Errorf("caricamento domande ammesse: %w", err)
	}
	defer rows.Close()

	var out []domandaDaCalcolare
	for rows.Next() {
		var (
			domandaID         string
			classeCodice      *string
			livelloCampionato *string
			numeroSquadre     int
			fdTxt             string
			anniAttivitaTxt   *string
			primaStagione     bool
		)
		if err := rows.Scan(&domandaID, &classeCodice, &livelloCampionato, &numeroSquadre, &fdTxt, &anniAttivitaTxt, &primaStagione); err != nil {
			return nil, fmt.Errorf("caricamento domande ammesse: %w", err)
		}
		if classeCodice == nil {
			return nil, fmt.Errorf("domanda %s ammessa senza classe_attivita_codice: dato di istruttoria mancante", domandaID)
		}
		fd, err := decimalDaTesto(fdTxt)
		if err != nil {
			return nil, err
		}

		anniAttivita := decimal.Zero
		if !primaStagione {
			if anniAttivitaTxt == nil {
				return nil, fmt.Errorf("domanda %s: associazione senza data_costituzione, impossibile calcolare CAA (non è prima stagione)", domandaID)
			}
			anniAttivita, err = decimalDaTesto(*anniAttivitaTxt)
			if err != nil {
				return nil, err
			}
		}

		out = append(out, domandaDaCalcolare{
			domandaID: domandaID,
			dati: istruttoria.DatiDomanda{
				ClasseAttivitaCodice:  *classeCodice,
				LivelloCampionato:     livelloCampionato,
				NumeroSquadreFederali: numeroSquadre,
				AnniAttivita:          anniAttivita,
				PrimaStagione:         primaStagione,
				FDMinuti:              fd,
			},
		})
	}
	return out, rows.Err()
}

// EseguiIstruttoria implementa la Fase 4 (art. B.8): calcola fabbisogno riconosciuto e
// coefficienti per tutte le domande ammesse della stagione e li persiste in una singola
// transazione (o tutte le domande sono aggiornate, o nessuna).
func EseguiIstruttoria(ctx context.Context, pool *pgxpool.Pool, stagioneID string) (int, error) {
	parametrico, err := CaricaParametricoAttivo(ctx, pool)
	if err != nil {
		return 0, err
	}

	domande, err := caricaDomandeAmmesse(ctx, pool, stagioneID)
	if err != nil {
		return 0, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("apertura transazione istruttoria: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op se già committata

	for _, d := range domande {
		fabbisogno, coeff, err := istruttoria.Calcola(d.dati, parametrico.Istruttoria)
		if err != nil {
			return 0, fmt.Errorf("domanda %s: %w", d.domandaID, err)
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO fabbisogni_riconosciuti
				(domanda_id, parametrico_versione_id, peso_base, incremento_squadre, fr_calcolato_minuti, fd_minuti, fr_finale_minuti)
			VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric)
			ON CONFLICT (domanda_id) DO UPDATE SET
				parametrico_versione_id = EXCLUDED.parametrico_versione_id,
				peso_base = EXCLUDED.peso_base,
				incremento_squadre = EXCLUDED.incremento_squadre,
				fr_calcolato_minuti = EXCLUDED.fr_calcolato_minuti,
				fd_minuti = EXCLUDED.fd_minuti,
				fr_finale_minuti = EXCLUDED.fr_finale_minuti,
				calcolato_il = now()
		`, d.domandaID, parametrico.VersioneID, fabbisogno.PesoBase, fabbisogno.IncrementoSquadre,
			fabbisogno.FRCalcolato.String(), d.dati.FDMinuti.String(), fabbisogno.FRFinale.String())
		if err != nil {
			return 0, fmt.Errorf("persistenza fabbisogno domanda %s: %w", d.domandaID, err)
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO coefficienti_associazione
				(domanda_id, parametrico_versione_id, crs, caa, csd, cp, prima_stagione)
			VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7)
			ON CONFLICT (domanda_id) DO UPDATE SET
				parametrico_versione_id = EXCLUDED.parametrico_versione_id,
				crs = EXCLUDED.crs,
				caa = EXCLUDED.caa,
				csd = EXCLUDED.csd,
				cp = EXCLUDED.cp,
				prima_stagione = EXCLUDED.prima_stagione,
				calcolato_il = now()
		`, d.domandaID, parametrico.VersioneID, coeff.CRS.String(), coeff.CAA.String(),
			coeff.CSD.String(), coeff.CP.String(), d.dati.PrimaStagione)
		if err != nil {
			return 0, fmt.Errorf("persistenza coefficienti domanda %s: %w", d.domandaID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit transazione istruttoria: %w", err)
	}

	return len(domande), nil
}
