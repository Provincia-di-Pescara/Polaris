# StatisticheView backoffice — collegamento API reali

## Obiettivo

Chiudere l'ultima vista backoffice ancora su mock (`StatisticheView.tsx`), collegandola a un nuovo endpoint di aggregazione. Chiude "UI Fase 5" lato backoffice al 100%.

## Architettura

Un endpoint backend nuovo, sola lettura, nessuna tabella/migration nuova:

- `GET /backoffice/stagioni/:id/statistiche` — `richiedeRuolo('admin','operatore')`, scoped alla stagione (path param, stesso pattern delle altre route `/backoffice/stagioni/:id/...`). 404 se stagione inesistente, 400 su id malformato (22P02, mapping già in uso altrove).
- `repository/statistiche.ts` (nuovo, top-level come `domande.ts`/`osservazioni.ts`) — una funzione `calcolaStatisticheStagione(db, stagioneId)` che esegue le query di aggregazione e ritorna un oggetto tipizzato.
- `StatisticheView.tsx` riscritta: `useOutletContext` per la stagione selezionata dall'Header (stesso pattern di `ImpiantiSpaziView`), fetch dell'endpoint, niente più dati mock.

## Metriche (tutte scoped alla stagione selezionata)

Tutte le query filtrano `assegnazioni.stato IN ('provvisoria','validata')` (assegnazioni attive) e `slot_settimana_tipo.indisponibile_permanente = false` dove rilevante — stesso paio di invarianti applicativi già documentati per la concertazione (CLAUDE.md, blocco 3/4).

1. **Tasso utilizzo impianti**: `SUM(valore_minuti attivo) / SUM(durata_minuti di tutti gli slot non indisponibili della stagione)`, minuti grezzi (mai ponderati — vincolo fisso progetto).
2. **Fasce pregiate assegnate %**: stesso rapporto del punto 1, filtrato a `slot.pregiata = true`.
3. **ISF medio associazioni**: media di ISF cumulativo per associazione (`Σ valore_minuti attivo / fr_finale_minuti`) sulle associazioni con `fr_finale_minuti > 0` nella stagione (associazioni FR=0 escluse, ISF N/A — regola già consolidata nel motore). Riusa la stessa forma SQL già condivisa tra `propostaProvvisoria.ts`/`settimanaTipoDefinitiva.ts` (ISF cumulativo per associazione via window function), qui aggregata con `AVG(...)`.
4. **Soci & atleti coinvolti**: `SUM(numero_atleti_partecipanti)` sulle `domande` con `stato = 'ammessa'` della stagione.

## Grafici

- **Distribuzione minuti per disciplina**: per ogni assegnazione attiva, disciplina = intersezione tra `domanda_discipline` (discipline dichiarate nella domanda) e `spazio_disciplina_compatibile` dello spazio del suo slot. Se l'intersezione ha più di una disciplina, `valore_minuti` è diviso equamente tra le discipline dell'intersezione (euristica esplicita, documentata nel codice — non è una regola normativa, solo un criterio di visualizzazione). Se l'intersezione è vuota (dato incoerente, non dovrebbe capitare ma non è vincolato da FK), l'assegnazione è esclusa dal grafico e basta.
- **Saturazione per impianto** (sostituisce "per comune" del mock — lo schema non ha una colonna comune strutturata, solo `indirizzo` testo libero): stessa formula del KPI 1, raggruppata per `impianti.denominazione`.

## Rappresentazione dati

Stesso principio decimal-as-string già seguito per il parametrico: percentuali/ISF sono `NUMERIC` letti via `::text`, mai binding numerico diretto — evita arrotondamenti float lato driver `pg`.

## Test

- `repository/statistiche.test.ts` — Postgres reale, fixture con stagione/impianti/slot/domande/assegnazioni note, valori attesi calcolati a mano per tutte e 4 le metriche + i 2 grafici (inclusi i casi limite: associazione FR=0 esclusa da ISF medio, disciplina con intersezione vuota esclusa dal grafico, intersezione multi-disciplina con lo split equo verificato numericamente).
- `server.statistiche.test.ts` — 403 per ruolo non autorizzato (nessuno, l'endpoint è admin+operatore — verificare comunque che un token con audience sbagliata sia rifiutato), 404 stagione inesistente, 400 id malformato, 200 con shape della risposta.
- `StatisticheView.realBackend.test.tsx` — smoke test end-to-end (pattern richiesto dalla final review del blocco precedente, "collegamento 4 view backoffice"): un valore reale che fa il giro Postgres→JSON backend→tipo TS→DOM.

## Fuori scope

- Nessuna colonna "comune" strutturata (valutata e scartata in fase di brainstorming — fuori scope, si usa "per impianto").
- Nessun confronto multi-stagione (solo la stagione selezionata dall'Header, stesso pattern delle altre view già collegate).
