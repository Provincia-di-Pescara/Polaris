# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Sistema telematico di assegnazione di spazi sportivi pubblici (palestre scolastiche di competenza provinciale). Obiettivo: eliminare discrezionalità umana nell'assegnazione, sostituendola con regole matematiche deterministiche, tracciabili e riproducibili da terzi.

**Stato attuale: pre-implementazione.** Nessun codice ancora scritto. In corso analisi requisiti e attesa chiarimenti da stakeholder su punti aperti (vedi "Domande aperte" sotto). Non avviare implementazione di motore di calcolo, schema DB definitivo o CRUD business finché questi punti non sono chiusi.

## Documenti di riferimento (fonte di verità normativa)

Cartella `documenti/`, formato .docx (leggere con estrazione XML via zipfile+regex, il tool Read nativo non gestisce binari .docx):

- `Documento_Principale_-_Sistema_Assegnazione_Spazi_Sportivi__Completo_.docx` — principi generali, fasi procedimento, tutela nuove associazioni, GDPR.
- `Allegato_A_-_Criteri_di_Assegnazione__Completo_.docx` — formule: fabbisogno riconosciuto (FR), indice di soddisfazione (ISF), coefficienti (CRS, CAA, CSD, CP).
- `Allegato_B_-_Procedura_Operativa__Completo_.docx` — procedura operativa passo-passo (16 fasi, artt. B.1-B.39): dall'accreditamento alla settimana tipo definitiva.

Ogni regola di business implementata deve essere riconducibile a un articolo preciso di questi documenti. Non introdurre logiche non esplicitamente scritte (istruzione esplicita del committente).

**Allegato parametrico**: documento con i valori numerici concreti (moltiplicatore Peso→minuti, pesi fasce pregiate, soglie limiti concentrazione, tolleranza parità ISF, formula CSD, valori neutri prima stagione, soglie decadenza) è **ancora da produrre** dallo stakeholder. Blocca l'implementazione del motore di calcolo (Fase 2).

## Architettura target (5 container)

1. **DB — PostgreSQL.** Single source of truth. Vincoli relazionali rigidi, exclusion constraint contro sovrapposizioni slot, lock transazionali per gestire concorrenza in fase di concertazione.
2. **Motore algoritmico — Go.** Microservizio puro, isolato: solo calcolo (FR/ISF/CP, ordine esame fasce, loop round-robin, sorteggio tracciato). Nessuna dipendenza da HTTP/auth/CRUD — deve restare testabile in isolamento per garantire determinismo e riproducibilità bit-esatta (requisito esplicito e ripetuto nei documenti: art. 28 Doc Principale, art. B.1 Allegato B).
3. **Backend API/Backoffice — Node.js + TypeScript.** Autenticazione OIDC (SPID/CIE) per frontend pubblico, autenticazione locale per frontend admin, validazione, CRUD, orchestrazione delle fasi procedurali, coda verso il motore Go. Riusa le regole di business del motore Go via RPC — non duplicare logica di calcolo in Node.
4. **Frontend pubblico — React/Vue + TypeScript.** Accesso associazioni (e scuole, che seguono iter di delega manuale) via SPID/CIE/eIDAS. Richiesta delega/abilitazione per una o più associazioni, domanda, preferenze, concertazione, calendario.
5. **Frontend admin (backoffice provincia) — React/Vue + TypeScript.** Login locale (no OIDC). Primo avvio: wizard di seeding SMTP + creazione primo account admin con validazione via link email (niente credenziali in `.env`). Due ruoli: **admin** (tutto, incluse impostazioni/parametri: SMTP, OIDC, parametri di sistema, loghi, utenti backoffice) e **operatore** (operatività pratica: deleghe, CRUD palestre/slot, istruttoria — non impostazioni/parametri).

Infrastruttura: Docker, CI/CD via GitHub Actions → GHCR, reverse proxy davanti ai frontend/API.

## Vincoli progettuali non negoziabili

- **Determinismo**: stesso input → stesso output, sempre. Vietato usare fonti di non-determinismo non seedate (orologio di sistema, ordine di iterazione di map non ordinate, float non specificato) nel motore Go.
- **Sorteggio tracciato**: seme pubblicato prima dell'elaborazione, algoritmo deterministico e documentato pubblicamente, verbale automatico, esito riproducibile da terzi.
- **Tracciabilità**: ogni operazione registrata con persona fisica, associazione rappresentata, ruolo, data/ora (art. 53 Doc Principale, art. B.39 Allegato B).
- **Unità di misura**: tutti i conteggi rilevanti (fabbisogno, valore assegnato, limiti di concentrazione) sono espressi in minuti, mai in numero di slot (le fasce hanno durate diverse).
- **Denaro**: i corrispettivi per l'uso delle palestre non transitano mai dalla piattaforma (regolati direttamente tra associazioni e istituzioni scolastiche).

## Domande aperte (bloccanti per fasi successive)

Elenco completo delle domande analitiche (arrotondamenti/collisioni ISF, lock DB in concertazione, struttura audit log/sorteggio tracciato, casi di stallo nel loop round-robin) è stato posto allo stakeholder e non ancora risposto integralmente. Non fissare valori arbitrari per tolleranze, tetti round, o strategie di lock senza conferma esplicita.
