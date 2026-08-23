# Runbook — Deploy e redeploy (Portainer)

Stack deployato su una VM via **Portainer, stack da repository Git** (non da shell — vedi `docker-compose.yml` per il compose stesso, `docs/claude/cicd-docker.md` per la topologia completa: rete privata, Traefik esterno file-based davanti al reverse proxy interno di ogni frontend).

## Canale immagine (`IMAGE_TAG`)

Ogni servizio applicativo (`engine`/`backend`/`frontend-pubblico`/`frontend-backoffice`) usa `ghcr.io/provincia-di-pescara/polaris-<servizio>:${IMAGE_TAG:-latest}` in `docker-compose.yml` — un'unica variabile decide il canale per tutti e 4 insieme. Schema tag completo in `docs/claude/cicd-docker.md`.

Nell'editor dello stack Portainer, sezione **Environment variables**, imposta `IMAGE_TAG`:

| Valore | Cosa scarica |
|---|---|
| `latest` (default se assente) | Ultima release vera taggata `vX.Y.Z` (nessun trattino) |
| `dev` | Ultimo build da push su `master` **o** da un tag pre-release (`vX.Y.Z-dev.N`, `-rc.N`, ecc.) — canale mobile, si sposta ad ogni push |
| `vX.Y.Z` | Una release esatta, pinnata — per rollback puntuale |
| `vX.Y.Z-dev.N` | Un build pre-release esatto, pinnato — stesso digest di `dev` al momento in cui è stato pushato, ma non si muove più dopo |

## Redeploy

⚠️ **`dev` e `latest` sono canali mobili**: il *nome* del tag non cambia quando il contenuto cambia. Un semplice "Update the stack" in Portainer **non** ripulla l'immagine se localmente esiste già un'immagine con quel tag — serve esplicitamente:

- Redeploy manuale: nell'editor dello stack, spunta **"Re-pull image and redeploy"** prima di confermare (non il redeploy semplice).
- Webhook automatico (se configurato): verificare che sia stato creato con l'opzione di re-pull attiva — un webhook "silenzioso" che non forza il re-pull ridistribuisce l'immagine vecchia già presente sulla VM.

Un tag `vX.Y.Z`/`vX.Y.Z-dev.N` esatto (pinnato) non ha questo problema — quel digest non cambia mai, ripullarlo è un no-op sicuro anche senza la spunta.

## Verificare quale immagine gira davvero

Da Portainer, senza shell: **Containers → `<nome container>` → dettagli** mostra l'Image ID (digest) effettivamente in esecuzione — confrontabile con quello mostrato nella pagina del pacchetto su GHCR (`ghcr.io/provincia-di-pescara/polaris-<servizio>`, tab "Versions", ogni digest elenca i tag che lo puntano in quel momento) per confermare che il redeploy abbia davvero preso il build atteso, non uno vecchio in cache.

## Migration

Girano da sole nell'entrypoint del container `backend` ad ogni avvio/redeploy — nessuna azione manuale richiesta, nessun job/servizio dedicato nello stack. Idempotenti: un redeploy senza nuove migration stampa `no change` nei log del container e prosegue normalmente. Dettagli/motivazione in `docs/claude/cicd-docker.md`.
