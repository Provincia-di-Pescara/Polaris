# Frontend pubblico: login OIDC reale + entità rappresentate + pannello OIDC backoffice — Design

## Contesto

Il frontend pubblico (`frontend-pubblico/`, React 19) è ancora uno scaffold con dati finti (`mockData.ts`): l'`Header` mostra una persona hardcoded ("Marco Rossi", "Autenticato via SPID (L2)") e un elenco statico di associazioni rappresentate. Il backend Node ha invece già un flusso OIDC SPID/CIE completo e testato (`docs/claude/oidc-spid-cie.md`): `GET /auth/oidc/start`, `POST /auth/oidc/callback`, `POST /auth/pubblico/refresh`, `POST /auth/pubblico/logout`, `GET /auth/pubblico/me` — mai collegato a un frontend reale, mai verificato in un browser.

Obiettivo di questo blocco: collegare `Header`/`App` del frontend pubblico al login OIDC reale, sostituendo i dati hardcoded con la persona e le associazioni realmente autenticate/delegate. Questo è il prerequisito di ogni blocco successivo (le altre 5 view restano mock per ora, ma da questo blocco in poi l'app avrà una sessione reale su cui costruire).

**Gap reale trovato durante l'analisi**: non esiste alcun endpoint per "quali associazioni posso rappresentare" per la persona autenticata (`GET /backoffice/deleghe` è solo per operatori di backoffice, `POST /pubblico/deleghe` crea ma non lista). Serve una nuova rotta pubblica.

**Secondo gap reale trovato**: il backend espone `GET`/`PUT /backoffice/impostazioni/oidc` (documentato come "fatto" in `docs/claude/oidc-spid-cie.md`) ma non esiste alcuna view nel frontend backoffice per usarlo — solo un endpoint HTTP raggiungibile a mano. Senza una UI, nessuno può configurare `issuer`/`clientId`/`clientSecret`/`redirectUri` per testare il login pubblico se non scrivendo query dirette sul DB. Incluso in questo blocco perché è un prerequisito pratico per verificare il resto.

**Riferimento di pattern**: [Comune-di-Montesilvano/ComunicaPA](https://github.com/Comune-di-Montesilvano/ComunicaPA) `apps/frontend-citizen/src/App.tsx` — stesso protocollo OIDC lato backend, frontend citizen senza router library: redirect pieno per login, pathname `/oidc/callback` controllato a mano per lo scambio code/state, token in `localStorage`, bottone logout unico. Verificato che il nostro design coincide con un pattern realmente funzionante, non solo teorico.

## Architettura

Nessuna nuova dipendenza runtime (`frontend-pubblico/package.json` non ha router — resta così, coerente con l'assenza di route multiple reali: l'app è a tab, non a pagine).

`App.tsx` diventa un gate a tre stati, basato su `window.location.pathname` e presenza token in `localStorage`:

1. `pathname === '/oidc/callback'` → `OidcCallbackView`: legge `code`/`state`/`error` da `window.location.search`, chiama `scambiaCallbackOidc`, salva i token, fa `window.history.replaceState` verso `/` e ricarica lo stato applicativo. Errori (state mismatch, `error` dal provider, rete) mostrati in chiaro con un link per ritentare.
2. Nessun token in storage → `LoginView`: pagina di landing istituzionale con un bottone "Accedi con SPID/CIE" che fa `avviaLoginOidc()` (redirect pieno a `GET /auth/oidc/start`).
3. Token presente → carica `leggiPersonaAutenticata()` + `leggiEntitaRappresentate()` in un `useEffect` all'avvio; se una delle due risponde 401 e anche il refresh fallisce (stesso comportamento della classe `ErroreSessioneScaduta` già usata nel backoffice), torna allo stato "nessun token" pulendo lo storage. A caricamento riuscito, renderizza l'app esistente (`Header` + tab) con dati reali.

## Backend — nuovo endpoint

`GET /pubblico/deleghe/mie` (`richiedeAutenticazionePubblico`): restituisce le abilitazioni della persona autenticata (`req.persona.sub`), tutti gli stati (`in_attesa`/`approvata`/`respinta`/`revocata`), nessun filtro di stagione (una persona può avere deleghe su stagioni diverse).

Implementato aggiungendo un filtro opzionale `personaFisicaId` a `listaAbilitazioni` (`backend-node/src/abilitazioni.ts`) — non una funzione duplicata. La rotta in `server.ts` chiama la stessa funzione già usata da `GET /backoffice/deleghe`, passando `personaFisicaId: req.persona.sub`.

## Frontend pubblico — file

- `src/types.ts` (modificato): `PersonaAutenticata { id, nome, cognome, codiceFiscale }`; `RepresentedEntity` riallineata ai campi reali di `AbilitazioneConDettagli` (stato: `'in_attesa' | 'approvata' | 'respinta' | 'revocata'`, non più l'enum inventato `'approvato'|'in_attesa'|'richiesto'`).
- `src/api/client.ts` (nuovo): fetch wrapper condiviso, mirror di `frontend-backoffice/src/api/client.ts` ma per la sessione pubblica — chiavi storage `polaris_pubblico_access_token`/`polaris_pubblico_refresh_token`, refresh verso `/auth/pubblico/refresh`, `ErroreSessioneScaduta` sulla stessa logica.
- `src/api/auth.ts` (nuovo): `avviaLoginOidc()`, `scambiaCallbackOidc(code, state)`, `leggiPersonaAutenticata()`, `eseguiLogout()`.
- `src/api/deleghe.ts` (nuovo): `leggiEntitaRappresentate()`.
- `src/components/LoginView.tsx` (nuovo).
- `src/components/OidcCallbackView.tsx` (nuovo).
- `src/components/Header.tsx` (modificato): riceve persona + entities reali via props, aggiunge bottone logout; se `entities` è vuoto mostra uno stato "Nessuna associazione accreditata" invece dello switcher.
- `src/App.tsx` (riscritto): il gate a tre stati sopra descritto.
- `src/mockData.ts`: resta per le view non ancora collegate (le altre 5), rimossa solo la entity fittizia dell'header.

## Backend — pannello OIDC backoffice

Nessuna modifica backend (`GET`/`PUT /backoffice/impostazioni/oidc` già completi).

## Frontend backoffice — file

- `src/api/impostazioniOidc.ts` (nuovo): `leggiConfigOidc()` (mappa 404 → `null`, configurazione non ancora impostata), `salvaConfigOidc(input)` (PUT, `clientSecret` omesso se l'utente non lo tocca in modifica).
- `src/components/ImpostazioniOidcView.tsx` (nuovo): form `issuer`/`clientId`/`clientSecret`/`redirectUri`, stesso pattern di `ParametriSistemaView.tsx` (card, badge di stato, errori). Campo `clientSecret` vuoto per default in modifica con placeholder "invariato" quando `clientSecretConfigurato === true`; obbligatorio solo al primo salvataggio (mappa `400`/`ErroreClientSecretMancante` a messaggio in italiano).
- `src/components/Sidebar.tsx` (modificato): nuova voce `impostazioni-oidc`, `roles: ['admin']`.
- Routing: nuova route in `BackofficeLayout`/router esistente (stesso punto dove sono registrate le altre view).

## Testing

**Backend**: `abilitazioni.test.ts` (filtro `personaFisicaId`), nuovo `server.deleghe.mie.test.ts` (o estensione di `server.deleghe.test.ts`): 401 senza token, scoping (una persona non vede le abilitazioni di un'altra), 200 con lista vuota.

**Frontend pubblico**: unit test per `api/client.ts`/`api/auth.ts`/`api/deleghe.ts` (mirror dei test backoffice); test componente per `LoginView`, `OidcCallbackView` (successo, `state` mismatch, `error` dal provider), `Header` (persona/entities reali, logout); un test end-to-end `App.realBackend.test.tsx` (pattern già usato nel backoffice) che verifica l'intero gate con backend reale — dato che non possiamo generare un vero `code` OIDC in un test HTTP puro, questo test copre landing→redirect-attempt e "già autenticato"→render Header, non lo scambio callback completo (quello resta coperto dai test dedicati di `OidcCallbackView` con fetch mockato più dai test backend già esistenti su `POST /auth/oidc/callback`).

**Frontend backoffice**: `ImpostazioniOidcView.test.tsx` (fetch mockato) + `ImpostazioniOidcView.realBackend.test.tsx` (backend reale, ruolo admin vs operatore-negato).

**Verifica manuale end-to-end in browser**: l'helper mock-IdP già scritto per `backend-node/src/auth/loginPubblico.test.ts` (RSA vera, stesso protocollo `client_secret_basic`) viene adattato in uno script standalone dev-only (`backend-node/scripts/mock-idp.mjs` o simile, non incluso in build/Docker) per poter cliccare il flusso di login reale in un browser durante la verifica di questo blocco: configuro l'IdP mock via `ImpostazioniOidcView`, click "Accedi con SPID/CIE", verifico redirect, consenso, callback, `Header` popolato, logout.

## Fuori scope (blocchi successivi)

- Le altre 5 view pubbliche (`AccreditamentoDelegaView`, `WizardDomandaView`, `EsitiIsfView`, `ConcertazioneView`, `CalendarioDefinitivoView`) restano su dati mock — un blocco a testa.
- Verifica contro il vero `pa-sso-proxy` (serve accesso a credenziali reali, non disponibile da qui — resta il residuo noto già documentato).
- Provider hardcoded a `'spid'` in `loginPubblico.ts` — placeholder esplicito già noto, non toccato qui.
