# Registro CONI/Sport e Salute — reverse engineering API pubblica (2026-08-26)

**Stato**: solo esplorazione (reverse engineering via Playwright sul frontend pubblico), nessuna
implementazione. Salvato come possibile estensione futura del principio "once only" (stesso
pattern già fatto per l'anagrafica scuole MIUR, vedi `backend-node/src/anagraficaScuole.ts`)
alle associazioni sportive (ASD/SSD), in fase di accreditamento associazione
(`AccreditamentoDelegaView`).

## Sorgente

`https://registro.sportesalute.eu/#/registro/n/` — Registro nazionale delle attività sportive
dilettantistiche, sezione pubblica "Cerca ASD/SSD nel Registro pubblico". Nessun login richiesto
per la sezione pubblica.

## Endpoint trovati

### Ricerca lista

```
GET https://registro.sportesalute.eu/api/istruttoria/lista/
  ?istruttoria_societa_denominazione_f=<denominazione>       (substring, opzionale)
  &istruttoria_societa_codiceFiscale_f=<codice fiscale>       (match esatto, opzionale — testato da solo, funziona)
  &istruttoria_stato_id_f=10                                  (fisso lato frontend pubblico — "Domanda accolta")
  &istruttoria_societa_affiliazione_tipoDisciplina_f=13       (fisso lato frontend pubblico, significato non verificato)
  &chiamante=registroPubblico_n
  &start=0&length=10
  &order_by=societa__codiceFiscale
```

Denominazione e codice fiscale sono filtri indipendenti (testati sia insieme sia singolarmente).
Non verificato se `istruttoria_stato_id_f`/`tipoDisciplina_f` sono obbligatori per il backend o
solo un default del frontend — da testare omettendoli prima di un'eventuale implementazione.

**Risposta** (esempio reale, CF `91120740682`, "AMATORI PESCARA CALCIO A.S.D."):

```json
{
  "stato": 1,
  "payload": {
    "count": 1,
    "data": [
      {
        "id": 369813,
        "id_pad": "00369813",
        "societa__codiceFiscale": "91120740682",
        "societa__denominazione": "AMATORI PESCARA CALCIO A.S.D.",
        "societa__sedeLegale__regione__denominazione": "Abruzzo",
        "societa__sedeLegale__comune__denominazione": "Pescara",
        "societa__natura_giuridica": "Associazione senza personalità giuridica",
        "statoIstruttoria__descrizione": "Domanda accolta",
        "organismi_affiliazioni_attive": [],
        "presentazione_data": "2013-10-09T02:00:00+02:00",
        "approvazione_data": "2013-10-09T02:00:00+02:00",
        "societa__iconaVcf": "static/icons/age_10.png",
        "utenza": ""
      }
    ]
  },
  "errori": []
}
```

`id` è l'id interno dell'istruttoria (non il CF), usato per il dettaglio.

### Dettaglio

```
GET https://registro.sportesalute.eu/api/istruttoria/{id}/sidebar/?chiamante=registroPubblico_n
```

**Risposta** (stesso esempio):

```json
{
  "stato": 1,
  "payload": {
    "testata": { "testo": "91120740682" },
    "corpo": {
      "dati": [
        { "label": "Codice Fiscale", "value": "91120740682" },
        { "label": "Denominazione", "value": "AMATORI PESCARA CALCIO A.S.D." },
        { "label": "Legale rappresentante", "value": "RAIMONDO DI RIENZO" },
        { "label": "Regione", "value": "Abruzzo" },
        { "label": "Comune", "value": "Pescara" },
        { "label": "Organismi sportivi attivi", "value": "" },
        { "label": "Data presentazione", "value": "2013-10-09T02:00:00+02:00" },
        { "label": "Discipline attive", "value": "" },
        { "label": "Nr. attività sportive organizzate nell'ultimo anno", "value": 0 },
        { "label": "Nr. tesserati attivi", "value": 0 },
        { "label": "Personalità Giuridica", "value": "Associazione senza personalità giuridica" }
      ]
    }
  },
  "errori": []
}
```

Formato "label/value" pensato per un form generico, non una struttura dati pulita — da
riparsare per etichetta se mai consumato lato Node.

## Autenticazione / accesso

Nessuna richiesta (verificato con browser non autenticato, nessun cookie di sessione, nessun
Bearer token). Header inviati dal frontend: `X-Requested-With: XMLHttpRequest`, `Referer`,
`Accept: */*` — standard XHR, replicabili facilmente da un fetch server-side. **Non verificato**:
se il backend enforce questi header lato server (CORS/referer-check) o li ignora — un client
Node diretto potrebbe funzionare o essere rifiutato, da testare prima di contarci.

## Limiti rispetto all'anagrafica MIUR scuole già implementata

- **Nessun indirizzo completo della sede legale** — solo comune e regione, a differenza
  dell'anagrafica scuole che espone un indirizzo utilizzabile direttamente nel form
  `IstituzioneForm.tsx`. Per `AccreditamentoDelegaView` (che ha un campo indirizzo/sede
  associazione) questo endpoint precompilerebbe solo CF/denominazione/comune/regione/legale
  rappresentante/natura giuridica, non l'indirizzo.
- Filtro CF è match esatto (non parziale) — coerente con l'uso "digiti il CF, trovi
  l'associazione", diverso dalla ricerca per sottostringa su denominazione già fatta per le
  scuole.
- Significato esatto di `istruttoria_stato_id_f=10` e `tipoDisciplina_f=13` da chiarire (sembrano
  filtri di default del frontend pubblico, non necessariamente gli unici valori validi) prima di
  costruire una query più ampia lato backoffice.

## Possibile implementazione futura (non ancora progettata)

Stesso pattern già usato per `anagraficaScuole.ts`: modulo `anagraficaAssociazioni.ts` (o simile)
con URL fetch diretto (non serve dataset scaricabile come il MIUR — qui è un'API JSON già
paginata), ricerca per denominazione e/o CF, endpoint backoffice `GET
/backoffice/associazioni/anagrafica-ricerca?q=...` (o dove serva — probabilmente lato
`AccreditamentoDelegaView` pubblico, non backoffice, visto che è l'associazione stessa a
compilare la propria domanda di accreditamento). Da brainstormare come design a sé quando/se il
committente lo richiede esplicitamente — non c'è ancora un requisito formalizzato per questo,
solo l'esplorazione fatta oggi.
