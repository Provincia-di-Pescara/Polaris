# Backoffice — fondamenta (auth reale + API client + routing) — design

**Data**: 2026-08-10

## Obiettivo

Il frontend backoffice (`frontend-backoffice/`) è oggi uno scaffold React 19 puramente visivo: nessun router, nessuna autenticazione reale (un toggle admin/operatore finto in `Header.tsx`, nome utente hardcoded "Mario Rossi"), nessun client HTTP, ogni vista legge da `src/mockData.ts` statico. Il backend Node (Fase 4) è completo e verificato end-to-end. Questo blocco costruisce le fondamenta — login reale, gestione token, routing, guardia per ruolo — senza collegare ancora nessuna vista funzionale ai dati reali. È il primo di una serie di sotto-blocchi indipendenti (uno per frontend/area funzionale) verso "UI Fase 5" completa.

## Contesto rilevante del backend

- `POST /auth/login` → `{accessToken, refreshToken, ...}` nel body JSON (non cookie). `POST /auth/refresh` (rotation: ogni uso revoca il token e ne emette uno nuovo) e `POST /auth/logout` prendono `{refreshToken}` nel body. `GET /auth/me` (protetta, richiede `Authorization: Bearer <accessToken>`) ritorna l'utente corrente.
- Access token JWT, scadenza 15 minuti, algoritmo pinnato HS256. Lockout per-account dopo 5 password errate in 15 minuti (hardening Fase 4, appena chiuso) — il client deve gestire il 401 generico risultante come una normale credenziale errata, nessuna differenza visibile.
- CORS (`CORS_ALLOWED_ORIGINS`) e `helmet` già attivi lato backend (hardening Fase 4) ma non sfruttati in questo blocco: si usa un proxy Vite in sviluppo, quindi il browser vede tutto come stessa origin.

## Stile visivo

Nessun vincolo di riprodurre esattamente i componenti esistenti pixel-per-pixel. Vincolo: coerenza di stile — stessi CSS custom properties già in uso (`--pa-blue-primary`, `--pa-blue-dark`, `--pa-bg-gray`, `--pa-border`, `--pa-text-muted`, ecc.), stesse classi utility (`form-control`, `badge`), stesso linguaggio visivo (card bianche, bordi sottili, palette blu/teal, `lucide-react` per le icone). La schermata di login è un componente nuovo (non esiste un equivalente da copiare) ma segue questo stile.

## Decisioni di scope

1. **Token storage**: `localStorage` (`polaris_access_token`, `polaris_refresh_token`). Rischio XSS standard accettato — nessuna libreria terza iniettata nel bundle, `helmet` CSP già attivo lato backend, uso interno backoffice.
2. **Routing**: `react-router` (`createBrowserRouter`/`RouterProvider`). Una rotta per vista esistente, stessi id già usati come `currentTab` in `App.tsx` (`/control-room`, `/impianti-spazi`, `/deleghe-accreditamenti`, `/parametri-sistema`, `/audit-sorteggio`, `/statistiche`). `/login` unica rotta pubblica; tutte le altre dietro `<ProtectedRoute>`.
3. **TypeScript 7**: bump `typescript` da `^5.7.2` a `7.0.2` esatto (`--save-exact`), stesso stile del backend — allinea al target fissato in CLAUDE.md. Verificato con `tsc --noEmit` reale prima di procedere al resto del blocco (un bump che rompe il typecheck va isolato e risolto per primo, non scoperto a metà lavoro).
4. **Connettività dev**: proxy Vite (`server.proxy` in `vite.config.ts`, inoltra `/auth` e `/backoffice` verso `http://localhost:3000`). Nessuna configurazione CORS necessaria in sviluppo; il pattern regge anche dietro un reverse proxy path-based in produzione (stessa origin dal punto di vista del browser).
5. **Testing**: Vitest (stesso motore di build di Vite, zero config aggiuntiva) + Testing Library. Per client HTTP/auth: server Node reale (`creaApp(pool)`, stesso pattern del backend) avviato in test contro Postgres reale — mai mock di `fetch`, coerente col principio "mai mock" già consolidato nel progetto. Per componenti puramente di presentazione (`LoginView`): Testing Library standard, nessun backend necessario.

## Componenti

### `src/api/client.ts` (nuovo)

Wrapper unico su `fetch`. Firma indicativa:

```ts
export async function apiFetch(path: string, init?: RequestInit): Promise<Response>
```

- Allega `Authorization: Bearer <accessToken>` da `localStorage` se presente.
- Su risposta 401 (e solo se esiste un `refreshToken` in storage): un solo tentativo di `POST /auth/refresh`; se riesce, salva i nuovi token e ripete la richiesta originale una volta; se il refresh stesso fallisce (401), ripulisce lo storage e propaga un evento/redirect verso `/login` (vedi `AuthContext`).
- Nessun retry infinito, nessuna coda di richieste in attesa del refresh in questo blocco (YAGNI — il caso "più richieste 401 simultanee durante un refresh" è un raffinamento rimandabile a un blocco futuro se osservato in pratica).

### `src/auth/AuthContext.tsx` (nuovo)

```ts
interface Utente { id: string; ruolo: 'admin' | 'operatore'; nome: string; cognome: string }
interface AuthContextValue {
  utente: Utente | null;
  caricamento: boolean; // true durante il bootstrap iniziale (GET /auth/me)
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}
```

Al mount: se `accessToken` presente in storage, chiama `GET /auth/me` per popolare `utente` (bootstrap di sessione su refresh pagina). `login()` chiama `POST /auth/login`, salva i token, richiama `GET /auth/me`. `logout()` chiama `POST /auth/logout` (revoca server-side) poi ripulisce storage e stato, indipendentemente dall'esito della chiamata di rete (logout locale deve sempre riuscire).

### `src/auth/ProtectedRoute.tsx` (nuovo)

Componente/wrapper di rotta: se `caricamento` mostra uno stato di attesa minimale (non serve una view dedicata, un div centrato basta); se `utente === null` redirige a `/login`; altrimenti renderizza i figli.

### `src/components/LoginView.tsx` (nuovo)

Form email/password, submit → `AuthContext.login()`. Errore di credenziali (401) mostrato con lo stesso stile di errore/alert già presente altrove nello scaffold (se esiste un pattern di classe CSS per errori/alert in `mockData`/altri componenti, riusarlo — altrimenti un blocco testo rosso semplice coerente con la palette). Nessun "ricordami"/"password dimenticata" in questo blocco (fuori scope, non richiesto dal backend attuale).

### `src/components/Sidebar.tsx` (modifica minima)

Nessuna modifica alla struttura del menu o al filtro per `roles` (già esistente e corretto). Aggiunto un bottone nel footer usando l'icona `LogOut` già importata ma mai usata, che chiama `AuthContext.logout()`.

### `src/components/Header.tsx` (modifica)

Rimosso il toggle admin/operatore finto (`setRole`) e il nome hardcoded. Mostra `utente.nome utente.cognome` e l'etichetta di ruolo (stessa logica testuale già presente: "Amministratore Sistema" / "Funzionario Servizio Sport") da `AuthContext`, non più da uno stato locale mutabile.

### `src/App.tsx` (riscritto)

`<AuthProvider>` avvolge `<RouterProvider>`. Router: `/login` pubblica; tutte le altre rotte esistenti dentro un layout condiviso (`Sidebar` + `Header` + `<Outlet/>`) avvolto da `<ProtectedRoute>`. Le view esistenti (`ControlRoomView` ecc.) sono importate e renderizzate esattamente come oggi, senza modifiche interne — continuano a leggere `mockData.ts`.

## Errori

- 401 su qualunque chiamata autenticata dopo un refresh fallito → redirect a `/login` (gestito da `apiFetch`/`AuthContext`, non da ogni singolo componente).
- 403 (utente disattivato) e lockout (401 generico) → mostrati nel form di login come "credenziali non valide" (nessuna differenziazione visibile, coerente col principio "no enumerazione" già del backend).
- Errori di rete (backend irraggiungibile) → messaggio generico nel form di login; per le chiamate autenticate post-login, fuori scope di dettaglio in questo blocco (le view che consumeranno `apiFetch` nei blocchi successivi gestiranno i propri stati di errore).

## Testing

- `src/api/client.test.ts`: server reale (`creaApp(pool)`, porta random, Postgres reale) — login ok, credenziali sbagliate, refresh valido, refresh su token scaduto/rotato, logout invalida la sessione.
- `src/auth/AuthContext.test.tsx`: bootstrap con token in storage valido/assente/scaduto; `login()`/`logout()` aggiornano lo stato correttamente.
- `src/components/LoginView.test.tsx`: Testing Library — submit valido chiama `login`, submit con credenziali sbagliate mostra l'errore, non serve backend reale (mocka solo `AuthContext` via provider di test, non `fetch`).
- Nessun test end-to-end browser (Playwright ecc.) in questo blocco — verifica manuale nel browser reale (`pnpm dev` frontend + backend + Postgres) come passo finale, stesso principio già seguito per gli smoke test del backend.

## Fuori scope esplicito

- Collegamento delle viste funzionali esistenti (`ControlRoomView`, `ImpiantiSpaziView`, `DelegheAccreditamentiView`, `ParametriSistemaView`, `AuditSorteggioView`, `StatisticheView`) ai rispettivi endpoint — restano su `mockData.ts`, un blocco a sé per area.
- Frontend pubblico (`frontend-pubblico/`) — blocco separato, complicato dal flusso OIDC redirect-based invece del login locale.
- Coda di richieste multiple durante un refresh in corso (raffinamento futuro se necessario).
- "Ricordami"/recupero password/gestione multi-sessione visibile all'utente.
