# POLARIS

**P**iattaforma **O**rganizzativa per la **L**ocalizzazione e l'**A**ssegnazione delle **R**isorse e degli **I**mpianti **S**portivi

Sistema telematico per l'assegnazione degli spazi sportivi pubblici (palestre scolastiche di competenza provinciale), sviluppato per la Provincia di Pescara. Sostituisce la discrezionalità amministrativa nell'assegnazione con regole matematiche deterministiche, tracciabili e riproducibili da terzi.

## Obiettivi

- Massimo accesso alla pratica sportiva e pluralismo delle discipline
- Continuità dell'attività sportiva esistente e accesso di nuove realtà associative
- Riduzione della discrezionalità amministrativa
- Determinismo e riproducibilità: a parità di dati di ingresso, ogni elaborazione produce sempre lo stesso risultato
- Trasparenza e tracciabilità integrale del procedimento (incluso il sorteggio, sempre tracciato e verificabile da terzi)

## Stato del progetto

In sviluppo attivo.

- **Fase 1 — Schema dati (PostgreSQL)**: completata
- **Fase 2 — Motore algoritmico (Go)**: completata — calcolo fabbisogno riconosciuto e indice di soddisfazione, sorteggio tracciato, assegnazione progressiva per round con gestione di blocchi gara e blocchi allenamento
- **Fase 3 — Backend API (Node.js/TypeScript)**: da avviare
- **Fase 4 — Frontend pubblico e backoffice (React/TypeScript)**: da avviare

Dettagli su regole di business, decisioni tecniche e stato di avanzamento in [`CLAUDE.md`](./CLAUDE.md).

## Architettura

| Componente | Tecnologia | Ruolo |
|---|---|---|
| Database | PostgreSQL 18 | Single source of truth, vincoli relazionali rigidi |
| Motore algoritmico | Go 1.26 | Calcolo puro e deterministico: fabbisogno, indice di soddisfazione, sorteggio tracciato, assegnazione |
| Backend API | Node.js / TypeScript | Autenticazione OIDC (SPID/CIE), CRUD, orchestrazione del procedimento |
| Frontend pubblico | React 19 / TypeScript | Accesso associazioni sportive e istituzioni scolastiche |
| Frontend backoffice | React 19 / TypeScript | Gestione Provincia: parametri, impianti, istruttoria |

## Documentazione normativa

I criteri e la procedura implementati sono definiti in `documenti/`:

- Documento Principale — principi generali e fasi del procedimento
- Allegato A — criteri di determinazione del fabbisogno e delle priorità
- Allegato B — procedura operativa di assegnazione

## Sviluppo locale

Nessuna dipendenza da installare oltre a Docker: build, test e migrazioni girano in container. Comandi dettagliati in [`CLAUDE.md`](./CLAUDE.md).

```bash
# Schema database
docker run -d --name pg-palestre -e POSTGRES_PASSWORD=test -e POSTGRES_DB=palestre -p 5432:5432 postgres:18-alpine
psql postgresql://postgres:test@localhost:5432/palestre -f db/migrations/000001_init.up.sql
psql postgresql://postgres:test@localhost:5432/palestre -f db/migrations/000002_seed_valori_normativi.up.sql

# Motore Go
docker run --rm -v "$(pwd)/engine-go:/app" -w /app golang:1.26-alpine go test ./... -v
```

## Licenza

Distribuito con licenza [EUPL v. 1.2](./LICENSE), la licenza open source raccomandata per il software della Pubblica Amministrazione italiana ed europea.
