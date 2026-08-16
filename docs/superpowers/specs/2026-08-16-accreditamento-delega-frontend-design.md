# AccreditamentoDelegaView: collegamento API reali — Design

## Contesto

Il blocco precedente (login OIDC pubblico) ha lasciato `AccreditamentoDelegaView` deliberatamente su dati mock (`App.tsx` la chiama con `entities={[]}`, `onAddNewEntity={() => {}}`, con un commento che marca il debito) perché `RepresentedEntity` (`types.ts`) ha una shape incompatibile con `EntitaRappresentata` (`api/deleghe.ts`, la vera risposta di `GET /pubblico/deleghe/mie`). Questo blocco chiude quel debito e collega la view — il primo tab visto dopo il login — al backend reale.

## Gap reali trovati durante l'analisi

- **Campo "Tipologia Ente" del mock non esiste nello schema reale.** `associazioni` (migration `000001_init.up.sql:187-194`) non ha colonna tipo; `schemaCreaAssociazione` (`pubblicoSchema.ts`) accetta solo `denominazione`, `codiceFiscalePartitaIva`, `rnaNumeroIscrizione` (opzionale), `dataCostituzione` (opzionale), `stagioneId`. Le istituzioni scolastiche non si autoaccreditano via questo flusso — CLAUDE.md le documenta come "iter di delega manuale" (gestite dal backoffice), non da `POST /pubblico/associazioni`.
- **Nessun selettore stagione nel frontend pubblico.** Sia `POST /pubblico/associazioni` sia `POST /pubblico/deleghe` richiedono `stagioneId`. `GET /stagioni` è già pubblico (non autenticato, `server.ts:273`), ma nessuna UI lo consuma ancora in `frontend-pubblico`.
- **Nessuna UI per la sub-delega** (`POST /pubblico/deleghe`, invito di un delegato/operatore su un'associazione già accreditata) — assente anche nel mock originale, feature nuova per questo blocco.

## Architettura

Nessuna nuova dipendenza. Estende i pattern già stabiliti nel blocco precedente (`api/*.ts` con `richiedi`/`ErroreRichiestaApi`, `AuthContext` per persona/entità/ricarica).

- **`api/stagioni.ts`** (nuovo): `listaStagioni(): Promise<Stagione[]>` → `GET /stagioni`.
- **`api/associazioni.ts`** (nuovo): `creaAssociazione(dati)` → `POST /pubblico/associazioni`; `caricaDocumento(associazioneId, file, tipo)` → `POST /pubblico/associazioni/:id/documenti`, `multipart/form-data` (campo file `'file'`, atteso da `multer(...).single('file')` in `documenti/storage.ts`), niente header `content-type` esplicito (il browser imposta il boundary).
- **`api/deleghe.ts`** (esteso): aggiunge `creaSubDelega(dati): Promise<EntitaRappresentata>` → `POST /pubblico/deleghe`.
- **`Header.tsx`** (esteso): nuovo dropdown stagione, accanto allo switcher associazioni. Carica `listaStagioni()` al mount, seleziona di default la prima stagione con `stato !== 'chiusa'` ordinata per `data_inizio DESC` (già l'ordine restituito dal backend), l'utente può cambiarla manualmente. Emette la selezione verso `App.tsx` via prop `stagioneId`/`setStagioneId` (stesso pattern props-drilling già in uso per `activeEntity`).
- **`App.tsx`**: nuovo state `stagioneId`, passato a `AccreditamentoDelegaView`. La stessa stagione selezionata sarà riusata dai blocchi successivi (WizardDomandaView, ecc.) — non duplicare la logica di selezione altrove quando arriveranno.
- **`types.ts`**: rimuove `RepresentedEntity` (chiude il debito Task 5). Nessun altro consumatore rimasto dopo la riscrittura di `AccreditamentoDelegaView` (verificare con grep prima di rimuovere, stesso giudizio già applicato nel blocco precedente).
- **`AccreditamentoDelegaView.tsx`** (riscritta): props `{ entities: EntitaRappresentata[]; stagioneId: string; onRicarica: () => void }` (sostituisce `onAddNewEntity` — dopo un create riuscito richiama `AuthContext.ricarica()` invece di un update ottimistico locale, coerente col resto dell'app che tratta il backend come sorgente di verità).
  - Lista associazioni: mostra **tutte** le entità (non solo `approvata` — a differenza dello switcher dell'Header, questa view è il posto giusto per vedere `in_attesa`/`respinta` insieme ad `approvata`).
  - Modale "Richiedi Nuova Delega Rappresentanza": form con denominazione, CF/P.IVA, RNA (opzionale), data costituzione (opzionale), upload PDF opzionale con select tipo (`statuto`/`atto_costitutivo`/`altro`). Submit: `creaAssociazione` poi, se un file è stato scelto, `caricaDocumento`; in caso di errore sull'upload (l'associazione è comunque creata) mostra un avviso distinto — "associazione creata, upload documento fallito, puoi ritentare" — non un errore generico che lascia intendere che nulla sia stato salvato.
  - Upload pensato per più chiamate indipendenti (una per documento): la UI permette di caricare un solo file nel modale di creazione, ma nulla nell'architettura assume "un solo documento per associazione" — `associazioni_documenti` è già una tabella multi-riga per associazione. Predisposizione per la richiesta emersa dall'ufficio (vedi "Fuori scope" sotto): aggiungere un nuovo tipo documento in futuro (es. matricola DAE) sarà un'aggiunta all'enum `tipo` (zod + select), non una modifica architetturale.
  - Nuova azione "Invita delegato" per card con `stato === 'approvata'`: form CF/nome/cognome/ruolo. Il `<select>` ruolo mostra `operatore` sempre, `rappresentante` solo se `ent.ruolo === 'rappresentante'` (rispecchia il vincolo lato backend — un delegante non-rappresentante non può assegnare ruolo rappresentante, `server.ts:1272-1275` — evita un submit destinato a un 403 leggibile ma evitabile).

## Testing

- `api/stagioni.test.ts`, `api/associazioni.test.ts`, `api/deleghe.test.ts` (estensione): unit test contro backend reale (pattern `backendReale.ts`/`creaPersonaTest.ts` già in uso), inclusa la request multipart per l'upload documento.
- `AccreditamentoDelegaView.test.tsx`: fetch/api mockati (`vi.spyOn`), copre creazione associazione (con e senza upload, incluso il caso upload-fallito-ma-associazione-creata), submit sub-delega con ruolo auto-limitato, stati vuoti/errore.
- `Header.test.tsx` (esteso): selezione stagione di default (prima non-chiusa), cambio manuale.
- Un `.realBackend.test.tsx` end-to-end (pattern già stabilito) che crea una persona di test, accredita un'associazione reale, verifica che compaia nella lista dopo `ricarica`.

## Fuori scope

- Le altre 4 view mock (WizardDomandaView, EsitiIsfView, ConcertazioneView, CalendarioDefinitivoView) — blocchi separati.
- Download/visualizzazione dei documenti già caricati dal cittadino (oggi solo il backoffice ha `GET /backoffice/associazioni/:id/documenti` — non esiste un equivalente pubblico). Non blocca questo blocco: l'upload resta "fire and forget" con conferma immediata, coerente con l'assenza di quell'endpoint.
- Selettore stagione riusato da altri blocchi — solo l'infrastruttura in `Header`/`App.tsx` viene posata qui, il collegamento agli altri tab arriva quando quei blocchi verranno fatti.
- **Documentazione aggiuntiva richiesta dall'ufficio** (comunicata durante questo design, non ancora specificata in un documento normativo): oltre alla delega, servirà in futuro raccogliere ulteriore documentazione — es. numero di matricola del DAE (defibrillatore semiautomatico esterno, obbligo impiantistico), probabilmente altro ancora da precisare. Nessun campo/tabella nuovo viene introdotto ora (nessuna richiesta scritta precisa, coerente con l'istruzione esplicita del committente di non introdurre logiche non esplicitamente scritte). Predisposizione minima applicata qui: `tipo` in `associazioni_documenti` è una colonna `TEXT` senza `CHECK` a livello DB (solo l'enum zod applicativo vincola i valori ammessi) — estendere l'elenco dei tipi documento ammessi in futuro sarà una modifica a un enum applicativo (`pubblicoSchema.ts` + select frontend), non una migration. Se in futuro la matricola DAE risulterà essere un *dato* (non un documento allegato) piuttosto che un file, andrà probabilmente su un'entità diversa da `associazioni_documenti` (es. `impianti`/`spazi`, dato che il DAE è un obbligo dell'impianto sportivo, non dell'associazione che lo usa) — da chiarire con l'Ente quando la richiesta sarà formalizzata, non assunto qui.
