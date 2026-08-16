# Parametrico normativo (valori default, CSD, sorteggio tracciato)

Riferimento a `docs/claude/regole-calcolo.md` per le regole di calcolo consolidate — questo file copre i valori numerici di default e le specifiche tecniche derivate.

## Valori di default allegato parametrico (seed iniziale — 🔺 da validare con Ente prima del go-live)

Tutti editabili via UI admin, tutti in tabella `allegato_parametrico` versionata (vedi `docs/claude/regole-calcolo.md`). I valori sotto sono placeholder di sviluppo scelti per coerenza interna, non valori concordati con l'Ente:

- 🔺 Moltiplicatore Peso→minuti (art. A.5): **60 minuti per punto** di (Peso base + incremento squadre). Es. Classe A senza squadre federali (peso 1) → FR calcolato 60 min/sett; Classe E con >6 squadre (peso 4+3=7) → FR calcolato 420 min/sett. Soggetto comunque al tetto FR finale = min(FD, FR calcolato).
- 🔺 Peso ponderazione fasce pregiate (art. A.9): **1,25** (valore più basso dei due esempi citati nel documento, "1,25 o 1,50").
- 🔺 Limiti di concentrazione (art. 11 Doc Principale, art. B.19): minuti settimanali massimi = **600**; slot massimi stesso impianto = **4**; fasce pregiate massime = **2**; giornate di gara massime = **1**.
- Valori neutri prima stagione (art. A.4, A.7 — già indicati nel testo, non placeholder): incremento squadre = **0**; CAA = **1,00**.
- 🔺 CSD neutro (associazione prima stagione / nessuna penalizzazione): **1,00**, coerente con la scala CRS/CAA dove 1,00 = neutro.
- 🔺 Soglie mancato utilizzo (art. B.35): richiesta giustificazione al 1° mancato utilizzo non giustificato; diffida al **2°**; decadenza al **3°**.
- 🔺 Soglia "scostamento significativo" dichiarato/monitorato (art. 5 Doc Principale, art. B.36): **20%** di scostamento tra dichiarato e rilevato.
- 🔺 Soglia ISF "significativamente inferiore" per compensazione (art. A.15): differenza ISF ≥ **0,20** (20 punti percentuali) tra associazioni concorrenti attiva il principio di compensazione.

## Struttura CSD (art. A.11) — decisione architetturale, valori da tarare in sviluppo

Modellata come tabella a scaglioni, stessa shape di CRS/CAA (coerenza con Allegato A): `intervallo rapporto FD/FR → coefficiente CSD`. Placeholder iniziale, da validare con simulazioni su dataset di test prima di Fase 2 (obiettivo: scoraggiare FD gonfiato senza penalizzare esigenze legittime):

| Rapporto FD/FR | CSD placeholder |
|---|---|
| ≤ 1,00 | 1,00 |
| 1,00 – 1,50 | 0,95 |
| 1,50 – 2,00 | 0,90 |
| > 2,00 | 0,85 |

## Specifica verbale di sorteggio tracciato (art. B.38)

Algoritmo: HMAC-SHA256(seme, candidato_id), ranking crescente sul valore esadecimale.

- **Seme**: generato con CSPRNG (`crypto/rand` Go), 32 byte, encoding hex, pubblicato prima dell'elaborazione.
- **Ordine canonico candidati**: lista candidati ordinata per `associazione_id` (UUID) ASC prima del calcolo — garantisce che il verbale pubblicato sia riproducibile indipendentemente dall'ordine di iterazione/inserimento DB.
- **Calcolo per candidato**: `hmac = HMAC-SHA256(key = decode_hex(seme), message = UTF8(associazione_id))`, rappresentato come stringa hex lowercase.
- **Ranking**: ordinamento crescente per confronto lessicografico della stringa hex (equivalente a confronto numerico big-endian). Vince il candidato con hmac più basso.
- **Verbale (record persistito)**: `sorteggio_id`, `procedura_id`, `articolo_riferimento` (es. "B.21", "B.14"), `contesto` (motivo del sorteggio), `seme_hex`, `timestamp_generazione_seme`, `candidati[]` (in ordine canonico), `algoritmo` = `"hmac-sha256-rank-asc"`, `algoritmo_versione` = `"v1"`, `risultati[]` (associazione_id + hmac_hex + rank, ordinati per rank), `vincitore_associazione_id`, `hash_verbale` (per tamper-evidence).
- **`hash_verbale`** (implementato in `engine-go/internal/sorteggio`): **non** JSON — concatenazione testuale deterministica (JSON "canonico" è ambiguo tra implementazioni/linguaggi diversi, inaccettabile per un hash che terzi devono poter ricalcolare). Formato esatto: `algoritmo + "\n" + algoritmo_versione + "\n" + seme_hex + "\n"`, poi per ciascun candidato in ordine di rank crescente `associazione_id + "|" + hmac_hex + "|" + rank + "\n"`; SHA-256 del risultato, hex lowercase. Pareggio HMAC (probabilità trascurabile): risolto su `associazione_id` crescente, per mantenere un ordine totale sempre definito.
- Retention: intera stagione + termine di impugnazione (vedi sezione retention sopra), mai 30gg.

Tutte le 20 domande analitiche del giro di revisione iniziale sono chiuse. Nessun blocco tecnico residuo per avvio Fase 1 (schema DB) e Fase 2 (motore Go). I valori 🔺 restano da validare con l'Ente ma non impediscono lo sviluppo, essendo parametrici e modificabili post-deploy senza migrazione di schema.
