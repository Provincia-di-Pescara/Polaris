package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/provincia/palestre-engine/internal/calc"
	"github.com/provincia/palestre-engine/internal/istruttoria"
	"github.com/provincia/palestre-engine/internal/roundrobin"
	"github.com/shopspring/decimal"
)

// ParametricoCaricato raccoglie la versione parametrica attiva (l'ultima pubblicata per
// valida_dal, vedi CLAUDE.md) e le tabelle di scaglioni normative, pronte per
// calc/istruttoria/roundrobin.
type ParametricoCaricato struct {
	VersioneID         string
	Istruttoria        istruttoria.Parametrico
	Limiti             roundrobin.LimitiConcentrazione
	TolleranzaISF      decimal.Decimal
	PesoFasciaPregiata decimal.Decimal
}

func decimalDaTesto(s string) (decimal.Decimal, error) {
	d, err := decimal.NewFromString(s)
	if err != nil {
		return decimal.Decimal{}, fmt.Errorf("valore decimal non valido %q: %w", s, err)
	}
	return d, nil
}

func decimalDaTestoNullable(s *string) (decimal.Decimal, bool, error) {
	if s == nil {
		return decimal.Decimal{}, false, nil
	}
	d, err := decimalDaTesto(*s)
	if err != nil {
		return decimal.Decimal{}, false, err
	}
	return d, true, nil
}

// CaricaParametricoAttivo carica l'ultima versione parametrica pubblicata e tutte le
// tabelle di scaglioni collegate (versionate e normative globali).
func CaricaParametricoAttivo(ctx context.Context, pool *pgxpool.Pool) (ParametricoCaricato, error) {
	var (
		versioneID                                                                  string
		moltiplicatoreTxt, pesoFasciaTxt, caaNeutroTxt, csdNeutroTxt, tolleranzaTxt string
		minutiSettimanaliMax, slotMax, fascePregiateMax, giornateGaraMax            int
	)
	err := pool.QueryRow(ctx, `
		SELECT id,
		       moltiplicatore_minuti_per_punto::text,
		       peso_fascia_pregiata::text,
		       minuti_settimanali_max::integer,
		       slot_max_stesso_impianto,
		       fasce_pregiate_max,
		       giornate_gara_max,
		       caa_neutro::text,
		       csd_neutro::text,
		       tolleranza_isf_pct::text
		FROM parametrico_versioni
		ORDER BY valida_dal DESC
		LIMIT 1
	`).Scan(&versioneID, &moltiplicatoreTxt, &pesoFasciaTxt, &minutiSettimanaliMax,
		&slotMax, &fascePregiateMax, &giornateGaraMax, &caaNeutroTxt, &csdNeutroTxt, &tolleranzaTxt)
	if err != nil {
		return ParametricoCaricato{}, fmt.Errorf("caricamento parametrico attivo: %w", err)
	}

	moltiplicatore, err := decimalDaTesto(moltiplicatoreTxt)
	if err != nil {
		return ParametricoCaricato{}, err
	}
	pesoFascia, err := decimalDaTesto(pesoFasciaTxt)
	if err != nil {
		return ParametricoCaricato{}, err
	}
	caaNeutro, err := decimalDaTesto(caaNeutroTxt)
	if err != nil {
		return ParametricoCaricato{}, err
	}
	csdNeutro, err := decimalDaTesto(csdNeutroTxt)
	if err != nil {
		return ParametricoCaricato{}, err
	}
	tolleranza, err := decimalDaTesto(tolleranzaTxt)
	if err != nil {
		return ParametricoCaricato{}, err
	}

	incrementoScaglioni, err := caricaIncrementoSquadreScaglioni(ctx, pool)
	if err != nil {
		return ParametricoCaricato{}, err
	}
	crsScaglioni, err := caricaCRSScaglioni(ctx, pool)
	if err != nil {
		return ParametricoCaricato{}, err
	}
	caaScaglioni, err := caricaCAAScaglioni(ctx, pool)
	if err != nil {
		return ParametricoCaricato{}, err
	}
	csdScaglioni, err := caricaCSDScaglioni(ctx, pool, versioneID)
	if err != nil {
		return ParametricoCaricato{}, err
	}

	return ParametricoCaricato{
		VersioneID: versioneID,
		Istruttoria: istruttoria.Parametrico{
			MoltiplicatoreMinutiPerPunto: moltiplicatore,
			IncrementoSquadreScaglioni:   incrementoScaglioni,
			CRSScaglioni:                 crsScaglioni,
			CAAScaglioni:                 caaScaglioni,
			CSDScaglioni:                 csdScaglioni,
			CAANeutro:                    caaNeutro,
			CSDNeutro:                    csdNeutro,
		},
		Limiti: roundrobin.LimitiConcentrazione{
			MinutiSettimanaliMax:  minutiSettimanaliMax,
			SlotMaxStessoImpianto: slotMax,
			FascePregiateMax:      fascePregiateMax,
			GiornateGaraMax:       giornateGaraMax,
		},
		TolleranzaISF:      tolleranza,
		PesoFasciaPregiata: pesoFascia,
	}, nil
}

func caricaIncrementoSquadreScaglioni(ctx context.Context, pool *pgxpool.Pool) ([]calc.ScaglioneSquadre, error) {
	rows, err := pool.Query(ctx, `SELECT squadre_min, squadre_max, incremento FROM incremento_squadre_scaglioni ORDER BY squadre_min`)
	if err != nil {
		return nil, fmt.Errorf("scaglioni incremento squadre: %w", err)
	}
	defer rows.Close()

	var out []calc.ScaglioneSquadre
	for rows.Next() {
		var min, incr int
		var max *int
		if err := rows.Scan(&min, &max, &incr); err != nil {
			return nil, fmt.Errorf("scaglioni incremento squadre: %w", err)
		}
		out = append(out, calc.ScaglioneSquadre{SquadreMin: min, SquadreMax: max, Incremento: incr})
	}
	return out, rows.Err()
}

func caricaCRSScaglioni(ctx context.Context, pool *pgxpool.Pool) ([]calc.ScaglioneCRS, error) {
	rows, err := pool.Query(ctx, `SELECT classe_attivita_codice, livello, crs::text FROM crs_scaglioni`)
	if err != nil {
		return nil, fmt.Errorf("scaglioni CRS: %w", err)
	}
	defer rows.Close()

	var out []calc.ScaglioneCRS
	for rows.Next() {
		var classe string
		var livello *string
		var crsTxt string
		if err := rows.Scan(&classe, &livello, &crsTxt); err != nil {
			return nil, fmt.Errorf("scaglioni CRS: %w", err)
		}
		crs, err := decimalDaTesto(crsTxt)
		if err != nil {
			return nil, err
		}
		out = append(out, calc.ScaglioneCRS{ClasseCodice: classe, Livello: livello, CRS: crs})
	}
	return out, rows.Err()
}

func caricaCAAScaglioni(ctx context.Context, pool *pgxpool.Pool) ([]calc.ScaglioneCAA, error) {
	rows, err := pool.Query(ctx, `SELECT anni_min::text, anni_max::text, caa::text FROM caa_scaglioni ORDER BY anni_min`)
	if err != nil {
		return nil, fmt.Errorf("scaglioni CAA: %w", err)
	}
	defer rows.Close()

	var out []calc.ScaglioneCAA
	for rows.Next() {
		var anniMinTxt string
		var anniMaxTxt *string
		var caaTxt string
		if err := rows.Scan(&anniMinTxt, &anniMaxTxt, &caaTxt); err != nil {
			return nil, fmt.Errorf("scaglioni CAA: %w", err)
		}
		anniMin, err := decimalDaTesto(anniMinTxt)
		if err != nil {
			return nil, err
		}
		anniMax, haMax, err := decimalDaTestoNullable(anniMaxTxt)
		if err != nil {
			return nil, err
		}
		caa, err := decimalDaTesto(caaTxt)
		if err != nil {
			return nil, err
		}
		s := calc.ScaglioneCAA{AnniMin: anniMin, CAA: caa}
		if haMax {
			s.AnniMax = &anniMax
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func caricaCSDScaglioni(ctx context.Context, pool *pgxpool.Pool, versioneID string) ([]calc.ScaglioneCSD, error) {
	rows, err := pool.Query(ctx, `
		SELECT rapporto_fd_fr_min::text, rapporto_fd_fr_max::text, coefficiente::text
		FROM csd_scaglioni
		WHERE parametrico_versione_id = $1
		ORDER BY rapporto_fd_fr_min
	`, versioneID)
	if err != nil {
		return nil, fmt.Errorf("scaglioni CSD: %w", err)
	}
	defer rows.Close()

	var out []calc.ScaglioneCSD
	for rows.Next() {
		var rapportoMinTxt string
		var rapportoMaxTxt *string
		var coefficienteTxt string
		if err := rows.Scan(&rapportoMinTxt, &rapportoMaxTxt, &coefficienteTxt); err != nil {
			return nil, fmt.Errorf("scaglioni CSD: %w", err)
		}
		rapportoMin, err := decimalDaTesto(rapportoMinTxt)
		if err != nil {
			return nil, err
		}
		rapportoMax, haMax, err := decimalDaTestoNullable(rapportoMaxTxt)
		if err != nil {
			return nil, err
		}
		coefficiente, err := decimalDaTesto(coefficienteTxt)
		if err != nil {
			return nil, err
		}
		s := calc.ScaglioneCSD{RapportoMin: rapportoMin, Coefficiente: coefficiente}
		if haMax {
			s.RapportoMax = &rapportoMax
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
