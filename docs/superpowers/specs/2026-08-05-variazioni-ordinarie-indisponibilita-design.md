# Design — Variazioni ordinarie + indisponibilità sopravvenute

Data: 2026-08-05. Riferimento: `docs/SPEC.md` Fase 4 punto 8 (Fase 15 normativa, `Fase 15 - Gestione stagionale, monitoraggio e decadenza`), primo di più blocchi. Copre art. B.32 (variazioni ordinarie) e B.33 (indisponibilità sopravvenute degli impianti). Fuori da questo blocco: B.34 (rilevazione utilizzo effettivo), B.35 (mancato utilizzo → giustificazione/diffida/decadenza), B.36 (effetti sui coefficienti delle stagioni successive — tocca il motore Go, non solo CRUD Node).

Schema Fase 1 già pronto per B.33-35 (`indisponibilita_sopravvenute`, `utilizzi_effettivi`, `provvedimenti_mancato_utilizzo`) — questo blocco usa `indisponibilita_sopravvenute` invariata e introduce una tabella nuova per B.32 (`variazioni_ordinarie`, nessuna tabella esistente la copre: le variazioni sono per-occorrenza/data specifica, non permanenti come gli scambi di concertazione che riscrivono la settimana tipo).

## Fuori scope esplicito

- **B.34 Rilevazione utilizzo effettivo**, **B.35 Mancato utilizzo** (giustificazione→diffida→decadenza), **B.36 Effetti sulle stagioni successive** (penalizzazione CAA — motore Go): task futuri separati. Questo blocco registra solo gli eventi (indisponibilità, variazioni) che quei blocchi consumeranno.
- **Notifica email delle indisponibilità sopravvenute**: le persone fisiche autenticate via OIDC non garantiscono un claim email nei dati SPID/CIE — "notifica automatica" (B.33) è implementata come visibilità via API pubblica, non invio email. 🔺 Assunzione da confermare con l'Ente.
- **Conferma indisponibilità/recupero da parte dell'istituzione scolastica**: le istituzioni non hanno accesso diretto alla piattaforma (iter delega manuale mai implementato, stesso residuo noto dei blocchi precedenti) — B.33 resta un'azione solo backoffice.
- **Concatenazione di variazioni sulla stessa occorrenza**: una sola variazione attiva (`in_attesa_accettazione`/`accettata`) per `(slot_id, data)` — niente "scambia, poi ri-scambia la stessa data" in questo blocco. Vincolo UNIQUE lo impedisce a livello DB, non un limite applicativo aggirabile.
- UI (Fase 5).

## 1. Schema — nuova tabella `variazioni_ordinarie` (art. B.32)

```sql
CREATE TABLE variazioni_ordinarie (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo TEXT NOT NULL CHECK (tipo IN ('liberazione', 'recupero', 'scambio_temporaneo', 'utilizzo_occasionale')),
    slot_id UUID NOT NULL REFERENCES slot_settimana_tipo(id),
    data DATE NOT NULL,
    slot_destinazione_id UUID REFERENCES slot_settimana_tipo(id),
    data_destinazione DATE,
    richiesta_da_associazione_id UUID NOT NULL REFERENCES associazioni(id),
    richiesta_da_persona_fisica_id UUID NOT NULL REFERENCES persone_fisiche(id),
    controparte_associazione_id UUID REFERENCES associazioni(id),
    indisponibilita_id UUID REFERENCES indisponibilita_sopravvenute(id),
    stato TEXT NOT NULL DEFAULT 'accettata' CHECK (stato IN ('in_attesa_accettazione', 'accettata', 'rifiutata', 'annullata')),
    motivazione_rifiuto TEXT,
    creata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT variazioni_scambio_ha_controparte CHECK (
        (tipo = 'scambio_temporaneo') = (controparte_associazione_id IS NOT NULL)
    ),
    CONSTRAINT variazioni_destinazione_coerente CHECK (
        (tipo IN ('recupero', 'scambio_temporaneo')) = (slot_destinazione_id IS NOT NULL AND data_destinazione IS NOT NULL)
    )
);
-- Una sola variazione attiva per occorrenza: evita che due richieste in conflitto
-- sulla stessa fascia+data vengano entrambe accettate (niente TOCTOU applicativo).
CREATE UNIQUE INDEX variazioni_occorrenza_attiva_uq ON variazioni_ordinarie (slot_id, data)
    WHERE stato IN ('in_attesa_accettazione', 'accettata');
```

Nuova migration `000013_variazioni_ordinarie.up/down.sql`.

## 2. B.33 — Indisponibilità sopravvenute (solo backoffice)

### `POST /backoffice/slot/:id/indisponibilita`
`richiedeRuolo('admin', 'operatore')`. Body zod: `{dal, al, motivo, comunicataDa: 'istituzione_scolastica'|'ente', slotRecuperoId?}` (refine `al >= dal`, replica del CHECK `indisponibilita_date_valide`). `comunicataDa` è sempre inserita dall'operatore per conto della fonte reale (l'istituzione non ha accesso diretto) — campo puramente informativo su chi ha originato la comunicazione, non un attore di sistema. `slotRecuperoId` opzionale: l'operatore può proporre da subito una fascia di recupero (art. B.33 "propone, ove possibile, il recupero"); non vincola l'associazione, che può comunque richiederne uno diverso via B.32 `tipo='recupero'`. `notificata_alle_associazioni_il = now()` impostato subito all'INSERT (vedi assunzione sopra: notifica = visibilità via API, non email). `registraOperazione` (`azione: 'crea_indisponibilita'`).

### `GET /pubblico/associazioni/:id/indisponibilita`
`richiedeAutenticazionePubblico`, verifica abilitazione attiva (stesso pattern delle altre GET pubbliche). Query `?stagioneId=` opzionale (scoping abilitazione se presente, stesso principio già consolidato). Ritorna le indisponibilità che si sovrappongono a un'assegnazione attiva dell'associazione (`JOIN assegnazioni ON assegnazioni.slot_id = indisponibilita_sopravvenute.slot_id AND assegnazioni.associazione_id = :associazioneId AND assegnazioni.stato IN ('provvisoria','validata')`).

## 3. B.32 — Variazioni ordinarie (pubblico, tra associazioni)

Nessuna coda di validazione backoffice attiva: l'Ente/operatore non interviene nello scambio (istruzione esplicita del committente) — solo controlli di compatibilità automatici lato sistema, riuso diretto delle funzioni già scritte per la concertazione (`controlloDisciplinaCompatibile`, `controlloLimitiConcentrazione`, non-blocco-gara — vedi `concertazione.ts`), adattate per verificare lo stato dell'**occorrenza** (assegnazione permanente del template alla data richiesta, considerando anche eventuali `variazioni_ordinarie` già `accettata` sulla stessa `slot_id`+`data` grazie al vincolo UNIQUE sopra) invece dello stato "permanente" del template.

### `POST /pubblico/variazioni`
`richiedeAutenticazionePubblico`. Body zod (`schemaCreaVariazione`, `.superRefine` per la coerenza tipo↔campi):
```
tipo: 'liberazione'|'recupero'|'scambio_temporaneo'|'utilizzo_occasionale',
slotId: uuid, data: string (YYYY-MM-DD),
slotDestinazioneId?: uuid, dataDestinazione?: string,  -- richiesti se tipo IN (recupero, scambio_temporaneo)
controparteAssociazioneId?: uuid,                       -- richiesto solo se tipo = scambio_temporaneo
indisponibilitaId?: uuid,                                -- opzionale, solo per recupero (collega alla B.33 che lo origina)
```
Autorizzazione: `trovaAbilitazioneAttiva` sull'associazione richiedente per la stagione dello slot. Controlli strutturali eseguiti subito (riuso `controlloDisciplinaCompatibile`/`controlloLimitiConcentrazione` — quest'ultimo applicato al carico dell'occorrenza, non al template settimanale permanente, dato che la variazione è puntuale) su `slot_destinazione_id` (se presente) contro l'associazione beneficiaria.

Esito per tipo (nessuna controparte → esito immediato, **HTTP 200 in ogni caso**, `rifiutata` è un esito di dominio non un errore, stesso principio già usato in concertazione):
- `liberazione`, `recupero`, `utilizzo_occasionale`: `stato='accettata'` se i controlli passano, altrimenti `stato='rifiutata'` con `motivazioneRifiuto`.
- `scambio_temporaneo`: nasce `stato='in_attesa_accettazione'` (i controlli si eseguono solo alla conferma della controparte, sulla configurazione finale).

### `POST /pubblico/variazioni/:id/accetta`
Solo la `controparte_associazione_id` (abilitazione attiva verificata). Precondizione `stato='in_attesa_accettazione'` (409 altrimenti). Esegue i controlli strutturali e transiziona a `accettata`/`rifiutata` (200 in entrambi i casi).

### `POST /pubblico/variazioni/:id/annulla`
Solo il richiedente originale (`richiesta_da_persona_fisica_id`, più ri-verifica abilitazione attiva sulla propria associazione — stesso principio corretto nella final review del blocco precedente per la concertazione). Precondizione `stato='in_attesa_accettazione'` (409 altrimenti — una volta accettata/rifiutata non è più annullabile).

### `GET /backoffice/stagioni/:id/variazioni`
`richiedeRuolo('admin', 'operatore')`. Coda **sola lettura** di monitoraggio (filtro opzionale `?tipo=`/`?stato=`), nessuna azione di validazione — coerente con l'istruzione del committente ("l'ente non c'entra nulla" nello scambio).

Nota di persistenza: **nessuna scrittura su `assegnazioni`** — la variazione resta un record di occorrenza separato dal template permanente. Il suo utilizzo effettivo (es. per escludere il mancato-utilizzo dalla fascia liberata quel giorno) è responsabilità del blocco B.34-35 futuro, che leggerà `variazioni_ordinarie` insieme a `indisponibilita_sopravvenute`.

## Testing

`node --test` contro Postgres reale, server HTTP vero, nessun mock. Scenari minimi:
- Indisponibilità: creazione con/senza `slotRecuperoId`, lettura pubblica scoped per abilitazione, 403 senza abilitazione.
- Variazione `liberazione`/`utilizzo_occasionale`: esito accettata/rifiutata (disciplina incompatibile), vincolo UNIQUE occorrenza (seconda richiesta sulla stessa `slot_id`+`data` già accettata → rifiutata o 409 a seconda del path, da decidere in implementazione se emerge un caso ambiguo).
- Variazione `scambio_temporaneo`: ciclo completo richiesta→accetta→controlli eseguiti alla conferma; annullamento prima dell'accettazione; 409 su doppia accettazione.
- Variazione `recupero`: collegamento a un'indisponibilità esistente via `indisponibilitaId`.
- Coda backoffice: sola lettura, 403 per ruolo pubblico, nessun endpoint di scrittura raggiungibile da backoffice per questa risorsa.

## Assunzioni aperte (🔺, non bloccanti — da confermare con l'Ente in Fase 7)

1. "Notifica automatica" (B.33) implementata come visibilità via API pubblica, non invio email — le persone fisiche OIDC non garantiscono un claim email.
2. Nessuna coda di validazione backoffice per le variazioni ordinarie (B.32) — istruzione esplicita del committente: lo scambio resta tra associazioni, l'Ente non interviene. Il backoffice ha solo una vista di sola lettura per monitoraggio.
3. Una sola variazione attiva per occorrenza (`slot_id`+`data`) in questo blocco — niente concatenazione di variazioni sulla stessa fascia/data.
