import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import { timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Db } from './db.ts';
import { listaStagioni, creaStagione } from './stagioni.ts';
import { eseguiLogin, eseguiLogout, eseguiRefresh } from './auth/login.ts';
import { eseguiCallbackOidc, eseguiLogoutPubblico, eseguiRefreshPubblico } from './auth/loginPubblico.ts';
import { ErroreCredenzialiNonValide, ErroreRefreshTokenNonValido, ErroreUtenteDisattivato } from './auth/errori.ts';
import {
  schemaAccettaInvitoUtente,
  schemaBootstrapPrimoAdmin,
  schemaBootstrapVerifica,
  schemaLoginRequest,
  schemaOidcCallback,
  schemaRefreshRequest,
} from './auth/schema.ts';
import {
  bootstrapDisponibile,
  richiediPrimoAdmin,
  verificaPrimoAdmin,
  ErroreBootstrapNonDisponibile,
  ErroreTokenVerificaNonValido,
} from './auth/bootstrapAdmin.ts';
import { creaTrasportoDaEnv, inviaEmail, type Email } from './email/smtp.ts';
import {
  richiedeAutenticazione,
  richiedeAutenticazionePubblico,
  type RequestAutenticata,
  type RequestAutenticataPubblico,
} from './auth/middleware.ts';
import { costruisciUrlAutorizzazione, ErroreOidcNonConfigurato, ErroreScambioCode, ErroreStatoNonValido } from './oidc/flow.ts';
import { leggiConfigOidcPubblica, scriviConfigOidc, ErroreClientSecretMancante } from './oidc/config.ts';
import { richiedeRuolo } from './auth/middleware.ts';
import { registraOperazione, listaOperazioni } from './repository/logOperazioni.ts';
import {
  creaClientMotore,
  type ClientMotore,
  ErroreMotoreIrraggiungibile,
  ErroreMotoreDominio,
} from './engine/client.ts';
import {
  creaUtenteInvitato,
  listaUtenti,
  trovaUtentePerId,
  aggiornaUtente,
  cambiaStatoUtente,
  impostaNuovoInvito,
  completaInvito,
  ErroreUltimoAdmin,
  ErroreTokenInvitoNonValido,
  aPubblico,
} from './repository/utentiBackoffice.ts';
import { revocaSessioniUtente } from './repository/sessioni.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato, ErroreStatoNonValidoPerTransizione, ErroreOrdineFasiNonRispettato, ErroreElaborazioneInCorso, ErroreRiferimentoNonValido, comeErroreRiferimentoNonValido } from './erroriDominio.ts';
import { creaDisciplina, listaDiscipline, aggiornaDisciplina } from './discipline.ts';
import { listaClassiAttivita } from './classiAttivita.ts';
import { creaIstituzione, listaIstituzioni, trovaIstituzionePerId, aggiornaIstituzione } from './istituzioni.ts';
import { creaImpianto, listaImpianti, trovaImpiantoPerId, aggiornaImpianto } from './impianti.ts';
import { creaSpazio, listaSpaziPerImpianto, trovaSpazioPerId, aggiornaSpazio } from './spazi.ts';
import { creaSlot, listaSlotPerStagione, trovaSlotPerId, aggiornaSlot, ErroreSovrapposizioneSlot } from './slot.ts';
import { leggiVersioneAttiva, leggiVersionePerId, listaVersioni, creaVersione } from './repository/parametrico.ts';
import { schemaCreaDisciplina, schemaAggiornaDisciplina, schemaCreaIstituzione, schemaAggiornaIstituzione, schemaCreaImpianto, schemaAggiornaImpianto, schemaQueryListaImpianti, schemaCreaSpazio, schemaAggiornaSpazio, schemaCreaSlot, schemaAggiornaSlot, schemaQueryListaSlot, schemaCreaStagione, schemaRespingiDelega, schemaQueryListaDeleghe, schemaImpostazioniOidc, schemaCreaUtenteBackoffice, schemaAggiornaUtenteBackoffice, schemaCambiaStatoUtenteBackoffice, schemaCreaVersioneParametrico, schemaCreaIndisponibilita, schemaFiltriVariazioni, schemaRegistraUtilizzo, schemaRigettaGiustificazione, schemaCreaProvvedimento, schemaQueryListaLogOperazioni } from './backofficeSchema.ts';
import { registraUtilizzo, trovaUtilizzoPerId, listaUtilizziPerAssegnazione, accogliGiustificazione, rigettaGiustificazione, presentaGiustificazione, listaUtilizziPerAssociazione } from './utilizziEffettivi.ts';
import { codaMancatiUtilizzi, creaProvvedimento, listaProvvedimentiPerAssegnazione, applicaDecadenza } from './provvedimenti.ts';
import { creaAssociazione, trovaAssociazionePerId, creaDocumentoAssociazione, listaDocumentiPerAssociazione, trovaDocumentoPerId, creaReferenteAssociazione, creaAssicurazioneAssociazione, listaReferentiPerAssociazione, listaAssicurazioniPerAssociazione } from './associazioni.ts';
import { listaOrganismiSportivi } from './organismiSportivi.ts';
import { schemaCreaAssociazione, schemaCaricaDocumento, schemaCreaDelega, schemaCreaDomanda, schemaCreaOsservazione, schemaCreaProposta, schemaAccettaProposta, schemaCreaVariazione, schemaAccettaVariazione, schemaPresentaGiustificazione } from './pubblicoSchema.ts';
import { uploadDocumento, percorsoStorageDocumenti } from './documenti/storage.ts';
import { MulterError } from 'multer';
import { readFile, unlink } from 'node:fs/promises';
import {
  creaAbilitazionePrincipale,
  trovaAbilitazioneAttiva,
  creaSubDelega,
  approvaAbilitazione,
  respingiAbilitazione,
  revocaAbilitazioneConCascata,
  listaAbilitazioni,
} from './abilitazioni.ts';
import {
  creaDomanda,
  trovaDomandaPerId,
  listaDomandePerAssociazione,
  ammettiDomanda,
  escludiDomanda,
  listaDomandeBackoffice,
  trovaDomandaConEsitoPerId,
  elencoEsitiPubblicati,
} from './domande.ts';
import { presentaOsservazione, trovaOsservazionePerId, accogliOsservazione, respingiOsservazione } from './osservazioni.ts';
import { pubblicaProposta, trovaPropostaProvvisoria } from './propostaProvvisoria.ts';
import { trovaPersonaFisicaPerCf, creaPersonaFisicaShell } from './repository/personeFisiche.ts';
import {
  creaProposta,
  trovaPropostaPerId,
  listaPropostePerAssociazione,
  listaPropostePerStagioneBackoffice,
  accettaProposta,
  annullaProposta,
  validaProposta,
  rigettaProposta,
} from './concertazione.ts';
import { ErroreConflittoFifoConcertazione } from './erroriDominio.ts';
import { approvaSettimanaTipoDefinitiva, trovaSettimanaTipoDefinitiva } from './settimanaTipoDefinitiva.ts';
import { confermaConvenzione, listaConvenzioniPerStagione } from './convenzioni.ts';
import { creaIndisponibilita, listaIndisponibilitaPerAssociazione } from './indisponibilita.ts';
import { creaVariazione, accettaVariazione, annullaVariazione, listaVariazioniPerStagione, trovaVariazionePerId, type TipoVariazione, type StatoVariazione } from './variazioni.ts';
import { listaSorteggiPerStagione, trovaSorteggioConCandidati } from './sorteggi.ts';
import { calcolaStatisticheStagione } from './statistiche.ts';

const COOKIE_STATE_OIDC = 'oidc_state';
const COOKIE_PATH_OIDC = '/auth/oidc';

function ipRichiesta(req: Request): string | null {
  return req.ip ?? null;
}

function segretoCookie(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    throw new Error('JWT_SECRET non impostata');
  }
  return s;
}

// multer(...).single('file') non è un middleware Express "normale": un errore al suo
// interno (es. MulterError per superamento di limits.fileSize) non chiama next(err) verso
// la catena della route ma finirebbe nel default error handler di Express — che risponde
// con una pagina HTML completa di stack trace e path assoluti del server, mai accettabile
// da esporre al client. Wrapper esplicito: intercetta l'errore invece di lasciarlo
// propagare. Solo il superamento del limite dimensione (LIMIT_FILE_SIZE) è davvero un
// "payload too large" (413) — qualunque altro errore multer (es. LIMIT_UNEXPECTED_FILE
// per un campo multipart sbagliato) è una richiesta malformata (400), non un file grande:
// confonderli con un 413 generico fuorviava chi debugga un errore diverso.
function gestisciUpload(req: Request, res: Response, next: NextFunction): void {
  uploadDocumento(req, res, (err: unknown) => {
    if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ errore: 'file troppo grande' });
      return;
    }
    if (err) {
      res.status(400).json({ errore: 'upload non valido' });
      return;
    }
    next();
  });
}

// Confronto a tempo costante: previene timing attack sul valore dello state (lo stesso
// motivo per cui le password si confrontano con timingSafeEqual, non con ===).
function confrontoSicuro(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// Entità+audit-log atomici (art. B.39): senza questo, un INSERT in log_operazioni fallito
// DOPO che la scrittura dell'entità è già committata lascerebbe l'entità creata/aggiornata
// ma senza traccia in audit — il client vedrebbe un 500 nonostante l'operazione sia
// effettivamente avvenuta. `azione` gira interamente su un client dedicato dentro
// BEGIN/COMMIT; qualunque eccezione (repository o registraOperazione) fa ROLLBACK di
// entrambe le scritture. Non usata dalle route /backoffice/spazi/*: creaSpazio/
// aggiornaSpazio (spazi.ts) aprono già una PROPRIA transazione interna per l'atomicità
// entità+join-table discipline compatibili (vedi commento lì) — annidare un'altra
// transazione attorno a quella richiederebbe di scomporle per condividere il client, non
// fatto in questo giro per limitare il rischio; l'audit log di quelle due route resta
// quindi scritto come query separata dopo il commit dell'entità (gap noto, vedi report).
async function eseguiInTransazione<T>(pool: Pool, azione: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const risultato = await azione(client);
    await client.query('COMMIT');
    return risultato;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const limitatoreLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// PKCE/state hanno già una protezione intrinseca (consumo one-shot, TTL breve), ma un
// rate limit sul solo /auth/oidc/start scoraggia comunque un flood di righe in
// oidc_stato_pkce da un singolo IP.
const limitatoreOidcStart = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Coda verso il motore Go (istruttoria/blocchi-gara/prima-assegnazione): ciascuna
// esecuzione tiene occupata una connessione pool per potenzialmente diversi minuti
// (ENGINE_TIMEOUT_MS). Il lock non-bloccante (Finding 2, vedi sotto) fa già fallire
// velocemente i tentativi concorrenti sulla STESSA stagione; questo limiter è una difesa
// aggiuntiva contro un flood da un singolo IP su stagioni diverse. Le tre route condividono
// UN SOLO limiter (bucket unico per IP, non per route/stagione, stesso pattern semplice di
// limitatoreLogin) — limit più alto di limitatoreLogin (10) perché qui un singolo IP admin
// che lavora su più stagioni nella stessa finestra è un caso operativo legittimo, non solo
// un sospetto di abuso.
const limitatoreEsecuzioneMotore = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Dipendenze iniettabili nei test (email finta, base URL fisso); i default arrivano
// dall'ambiente (SMTP_* per il trasporto di bootstrap, BACKOFFICE_BASE_URL per i link).
export interface DipendenzeApp {
  inviaEmail?: (email: Email) => Promise<void>;
  backofficeBaseUrl?: string;
  clientMotore?: ClientMotore;
}

function inviaEmailDaEnv(): ((email: Email) => Promise<void>) | null {
  const trasporto = creaTrasportoDaEnv();
  if (!trasporto) {
    return null;
  }
  return (email) => inviaEmail(trasporto, email);
}

export function creaApp(pool: Pool, dipendenze: DipendenzeApp = {}): Express {
  const inviaEmailFn = dipendenze.inviaEmail ?? inviaEmailDaEnv();
  const backofficeBaseUrl = dipendenze.backofficeBaseUrl ?? process.env.BACKOFFICE_BASE_URL ?? null;
  const clientMotore: ClientMotore | null =
    dipendenze.clientMotore ??
    (process.env.ENGINE_URL
      ? creaClientMotore(process.env.ENGINE_URL, Number(process.env.ENGINE_TIMEOUT_MS ?? 300000))
      : null);

  const app = express();

  if (process.env.TRUST_PROXY) {
    if (/^(true|false)$/i.test(process.env.TRUST_PROXY.trim())) {
      throw new Error(
        "TRUST_PROXY='true'/'false' non è supportato: usa un numero di hop, un IP/subnet, o un nome speciale Express come 'loopback' — vedi .env.example",
      );
    }
    const valoreNumerico = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(valoreNumerico) ? process.env.TRUST_PROXY : valoreNumerico);
  }

  app.use(helmet());

  const originiConsentite = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.use(cors({ origin: originiConsentite.length > 0 ? originiConsentite : false, credentials: true }));

  app.use(express.json());
  app.use(cookieParser(segretoCookie()));

  app.get('/healthz', (_req, res) => {
    res.status(200).send('ok');
  });

  app.get('/stagioni', async (_req, res) => {
    try {
      const stagioni = await listaStagioni(pool);
      res.status(200).json(stagioni);
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/discipline', async (_req, res) => {
    try {
      res.status(200).json(await listaDiscipline(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/classi-attivita', async (_req, res) => {
    try {
      res.status(200).json(await listaClassiAttivita(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/organismi-sportivi', async (_req, res) => {
    try {
      res.status(200).json(await listaOrganismiSportivi(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Bootstrap primo admin (wizard primo avvio) ---
  // Disponibile solo finché non esiste alcun utente backoffice verificato; l'account
  // viene creato inattivo e attivato dal link inviato all'email dichiarata.

  app.get('/auth/bootstrap/stato', async (_req, res) => {
    try {
      res.status(200).json({ disponibile: await bootstrapDisponibile(pool) });
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/auth/bootstrap/primo-admin', limitatoreLogin, async (req, res) => {
    const parsed = schemaBootstrapPrimoAdmin.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    if (!inviaEmailFn || !backofficeBaseUrl) {
      res.status(503).json({ errore: 'SMTP di bootstrap non configurato (SMTP_HOST/BACKOFFICE_BASE_URL in .env)' });
      return;
    }
    try {
      await richiediPrimoAdmin(pool, parsed.data, inviaEmailFn, backofficeBaseUrl);
      res.status(204).send();
    } catch (err) {
      if (err instanceof ErroreBootstrapNonDisponibile) {
        res.status(409).json({ errore: 'esiste già un account backoffice' });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/auth/bootstrap/verifica', limitatoreLogin, async (req, res) => {
    const parsed = schemaBootstrapVerifica.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      const utente = await verificaPrimoAdmin(pool, parsed.data.token);
      res.status(200).json({ email: utente.email });
    } catch (err) {
      if (err instanceof ErroreTokenVerificaNonValido) {
        res.status(401).json({ errore: 'token di verifica non valido o scaduto' });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Backoffice (locale, admin/operatore) ---

  app.post('/auth/login', limitatoreLogin, async (req, res) => {
    const parsed = schemaLoginRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }

    try {
      const esito = await eseguiLogin(pool, parsed.data.email, parsed.data.password, ipRichiesta(req));
      res.status(200).json(esito);
    } catch (err) {
      if (err instanceof ErroreCredenzialiNonValide) {
        res.status(401).json({ errore: 'credenziali non valide' });
        return;
      }
      if (err instanceof ErroreUtenteDisattivato) {
        res.status(403).json({ errore: 'utente disattivato' });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/auth/refresh', async (req, res) => {
    const parsed = schemaRefreshRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }

    try {
      const esito = await eseguiRefresh(pool, parsed.data.refreshToken, ipRichiesta(req));
      res.status(200).json(esito);
    } catch (err) {
      if (err instanceof ErroreRefreshTokenNonValido) {
        res.status(401).json({ errore: 'refresh token non valido o scaduto' });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/auth/logout', async (req, res) => {
    const parsed = schemaRefreshRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }

    await eseguiLogout(pool, parsed.data.refreshToken);
    res.status(204).send();
  });

  app.get('/auth/me', richiedeAutenticazione, (req: RequestAutenticata, res) => {
    res.status(200).json(req.utente);
  });

  // --- Pubblico (associazioni/scuole, OIDC SPID/CIE via pa-sso-proxy) ---

  app.get('/auth/oidc/start', limitatoreOidcStart, async (_req, res) => {
    try {
      const { url, state } = await costruisciUrlAutorizzazione(pool);
      // Lega lo state al browser che avvia il flusso (cookie firmato, HttpOnly): senza
      // questo, un attaccante può completare il PROPRIO login legittimo (code+state veri)
      // facendolo eseguire dal browser della vittima — la autenticherebbe come
      // l'attaccante (login CSRF/session fixation). PKCE da solo non basta: il
      // code_verifier è recuperato lato server via state, non dal browser, quindi
      // combacia comunque se l'attaccante usa il proprio state autentico.
      res.cookie(COOKIE_STATE_OIDC, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        maxAge: 5 * 60 * 1000,
        path: COOKIE_PATH_OIDC,
      });
      res.redirect(url);
    } catch (err) {
      if (err instanceof ErroreOidcNonConfigurato) {
        res.status(503).json({ errore: 'autenticazione OIDC non configurata' });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/auth/oidc/callback', async (req, res) => {
    const parsed = schemaOidcCallback.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }

    const stateCookie: unknown = req.signedCookies[COOKIE_STATE_OIDC];
    res.clearCookie(COOKIE_STATE_OIDC, { path: COOKIE_PATH_OIDC });

    if (typeof stateCookie !== 'string' || !confrontoSicuro(stateCookie, parsed.data.state)) {
      res.status(401).json({ errore: 'sessione di login non riconosciuta, riprovare' });
      return;
    }

    try {
      const esito = await eseguiCallbackOidc(pool, parsed.data.code, parsed.data.state, ipRichiesta(req));
      res.status(200).json(esito);
    } catch (err) {
      if (err instanceof ErroreStatoNonValido) {
        res.status(401).json({ errore: 'sessione di login scaduta o non valida, riprovare' });
        return;
      }
      if (err instanceof ErroreScambioCode || err instanceof ErroreOidcNonConfigurato) {
        res.status(502).json({ errore: 'autenticazione OIDC fallita' });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/auth/pubblico/refresh', async (req, res) => {
    const parsed = schemaRefreshRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }

    try {
      const esito = await eseguiRefreshPubblico(pool, parsed.data.refreshToken, ipRichiesta(req));
      res.status(200).json(esito);
    } catch (err) {
      if (err instanceof ErroreRefreshTokenNonValido) {
        res.status(401).json({ errore: 'refresh token non valido o scaduto' });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/auth/pubblico/logout', async (req, res) => {
    const parsed = schemaRefreshRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }

    await eseguiLogoutPubblico(pool, parsed.data.refreshToken);
    res.status(204).send();
  });

  app.get('/auth/pubblico/me', richiedeAutenticazionePubblico, (req: RequestAutenticataPubblico, res) => {
    res.status(200).json(req.persona);
  });

  // --- Backoffice: quadro delle disponibilità (Allegato B, Fase 1, art. B.2-B.4) ---
  // Aperto sia ad admin che operatore (SPEC: "operatore: CRUD palestre/slot").

  app.post(
    '/backoffice/discipline',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaDisciplina.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const disciplina = await eseguiInTransazione(pool, async (client) => {
          const d = await creaDisciplina(client, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_disciplina_sportiva',
            entitaTipo: 'discipline_sportive',
            dettaglio: d as unknown as Record<string, unknown>,
          });
          return d;
        });
        res.status(201).json(disciplina);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/discipline', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (_req, res) => {
    try {
      res.status(200).json(await listaDiscipline(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/discipline/:codice',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaDisciplina.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const codice = typeof req.params.codice === 'string' ? req.params.codice : '';
        const disciplina = await eseguiInTransazione(pool, async (client) => {
          const d = await aggiornaDisciplina(client, codice, parsed.data.denominazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'aggiorna_disciplina_sportiva',
            entitaTipo: 'discipline_sportive',
            dettaglio: d as unknown as Record<string, unknown>,
          });
          return d;
        });
        res.status(200).json(disciplina);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/backoffice/istituzioni',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaIstituzione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const istituzione = await eseguiInTransazione(pool, async (client) => {
          const i = await creaIstituzione(client, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_istituzione_scolastica',
            entitaTipo: 'istituzioni_scolastiche',
            entitaId: i.id,
            dettaglio: i as unknown as Record<string, unknown>,
          });
          return i;
        });
        res.status(201).json(istituzione);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/istituzioni', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (_req, res) => {
    try {
      res.status(200).json(await listaIstituzioni(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(
    '/backoffice/istituzioni/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const istituzione = await trovaIstituzionePerId(pool, id);
        if (!istituzione) {
          res.status(404).json({ errore: 'istituzione non trovata' });
          return;
        }
        res.status(200).json(istituzione);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/istituzioni/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaIstituzione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const istituzione = await eseguiInTransazione(pool, async (client) => {
          const i = await aggiornaIstituzione(client, id, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'aggiorna_istituzione_scolastica',
            entitaTipo: 'istituzioni_scolastiche',
            entitaId: i.id,
            dettaglio: i as unknown as Record<string, unknown>,
          });
          return i;
        });
        res.status(200).json(istituzione);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/backoffice/impianti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaImpianto.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const impianto = await eseguiInTransazione(pool, async (client) => {
          const i = await creaImpianto(client, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_impianto',
            entitaTipo: 'impianti',
            entitaId: i.id,
            dettaglio: i as unknown as Record<string, unknown>,
          });
          return i;
        });
        res.status(201).json(impianto);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/impianti', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    const parsed = schemaQueryListaImpianti.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      res.status(200).json(await listaImpianti(pool, parsed.data.istituzioneScolasticaId));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(
    '/backoffice/impianti/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const impianto = await trovaImpiantoPerId(pool, id);
        if (!impianto) {
          res.status(404).json({ errore: 'impianto non trovato' });
          return;
        }
        res.status(200).json(impianto);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/impianti/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaImpianto.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const impianto = await eseguiInTransazione(pool, async (client) => {
          const i = await aggiornaImpianto(client, id, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'aggiorna_impianto',
            entitaTipo: 'impianti',
            entitaId: i.id,
            dettaglio: i as unknown as Record<string, unknown>,
          });
          return i;
        });
        res.status(200).json(impianto);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/backoffice/impianti/:impiantoId/spazi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaSpazio.omit({ impiantoId: true }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const impiantoId = typeof req.params.impiantoId === 'string' ? req.params.impiantoId : '';
        // Non avvolta in eseguiInTransazione: creaSpazio (spazi.ts) apre già una propria
        // transazione Pool-based per l'atomicità entità+discipline compatibili (vedi
        // commento lì) — l'INSERT in log_operazioni sotto resta quindi una query separata,
        // dopo il commit dell'entità (gap noto, non atomico con l'audit log; vedi report).
        const spazio = await creaSpazio(pool, { ...parsed.data, impiantoId });
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_spazio_sportivo',
          entitaTipo: 'spazi_sportivi',
          entitaId: spazio.id,
          dettaglio: spazio as unknown as Record<string, unknown>,
        });
        res.status(201).json(spazio);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/impianti/:impiantoId/spazi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const impiantoId = typeof req.params.impiantoId === 'string' ? req.params.impiantoId : '';
        res.status(200).json(await listaSpaziPerImpianto(pool, impiantoId));
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/spazi/:id', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const spazio = await trovaSpazioPerId(pool, id);
      if (!spazio) {
        res.status(404).json({ errore: 'spazio sportivo non trovato' });
        return;
      }
      res.status(200).json(spazio);
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/spazi/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaSpazio.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        // Vedi commento nella POST sopra: non avvolta in eseguiInTransazione, stesso motivo.
        const spazio = await aggiornaSpazio(pool, id, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'aggiorna_spazio_sportivo',
          entitaTipo: 'spazi_sportivi',
          entitaId: spazio.id,
          dettaglio: spazio as unknown as Record<string, unknown>,
        });
        res.status(200).json(spazio);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/backoffice/stagioni/:stagioneId/slot',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaSlot.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const stagioneId = typeof req.params.stagioneId === 'string' ? req.params.stagioneId : '';
        const slot = await eseguiInTransazione(pool, async (client) => {
          const s = await creaSlot(client, { ...parsed.data, stagioneId });
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_slot_settimana_tipo',
            entitaTipo: 'slot_settimana_tipo',
            entitaId: s.id,
            dettaglio: s as unknown as Record<string, unknown>,
          });
          return s;
        });
        res.status(201).json(slot);
      } catch (err) {
        if (err instanceof ErroreSovrapposizioneSlot) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/stagioni/:stagioneId/slot',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const parsed = schemaQueryListaSlot.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const stagioneId = typeof req.params.stagioneId === 'string' ? req.params.stagioneId : '';
        res.status(200).json(await listaSlotPerStagione(pool, stagioneId, parsed.data.spazioId));
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/slot/:id', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const slot = await trovaSlotPerId(pool, id);
      if (!slot) {
        res.status(404).json({ errore: 'slot non trovato' });
        return;
      }
      res.status(200).json(slot);
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/slot/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaSlot.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const slot = await eseguiInTransazione(pool, async (client) => {
          const s = await aggiornaSlot(client, id, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'aggiorna_slot_settimana_tipo',
            entitaTipo: 'slot_settimana_tipo',
            entitaId: s.id,
            dettaglio: s as unknown as Record<string, unknown>,
          });
          return s;
        });
        res.status(200).json(slot);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreSovrapposizioneSlot) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/backoffice/stagioni',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaStagione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const stagione = await eseguiInTransazione(pool, async (client) => {
          const s = await creaStagione(client, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_stagione',
            entitaTipo: 'stagioni_sportive',
            entitaId: s.id,
            dettaglio: s as unknown as Record<string, unknown>,
          });
          return s;
        });
        res.status(201).json(stagione);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Pubblico: accreditamento associazione (Doc Principale art. 3-4, art. B.2) ---
  // Chi accredita diventa legale rappresentante (prima abilitazione, non delegata da
  // nessun'altra: creata_da_abilitazione_id resta NULL), passa comunque da approvazione
  // operatore (stato 'in_attesa', come ogni prima abilitazione — vedi migration 000007).

  app.post(
    '/pubblico/associazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaAssociazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      // Validazione anti-frode: chi sottoscrive deve essere davvero la persona che il
      // modulo dichiara stia agendo (delegato se compilato, altrimenti il RL) — art. 53
      // Doc Principale, tracciabilità della vera persona fisica operante. Confronto
      // case-insensitive/trim: i claim OIDC e il testo libero del form possono differire
      // per maiuscole/spazi senza che sia un mismatch reale.
      const normalizza = (s: string) => s.trim().toLowerCase();
      const nomeAtteso = parsed.data.delegatoNome ?? parsed.data.rappresentanteLegaleNome;
      const cognomeAtteso = parsed.data.delegatoCognome ?? parsed.data.rappresentanteLegaleCognome;
      if (normalizza(req.persona!.nome) !== normalizza(nomeAtteso) || normalizza(req.persona!.cognome) !== normalizza(cognomeAtteso)) {
        res.status(400).json({
          errore: 'la persona autenticata non corrisponde al Rappresentante Legale o al Delegato dichiarato nel modulo',
        });
        return;
      }
      try {
        const associazione = await eseguiInTransazione(pool, async (client) => {
          const a = await creaAssociazione(client, parsed.data);
          await creaAbilitazionePrincipale(client, {
            personaFisicaId: req.persona!.sub,
            associazioneId: a.id,
            stagioneId: parsed.data.stagioneId,
            // Riusa la stessa condizione del controllo anti-frode sopra: se è stato
            // dichiarato un Delegato (ed è lui a combaciare con la persona autenticata,
            // altrimenti la richiesta è già stata respinta con 400), il titolo deve
            // riflettere quella capacità dichiarata — vedi Finding 5.
            titolo: parsed.data.delegatoNome !== undefined ? 'delegato' : 'legale_rappresentante',
          });
          await creaReferenteAssociazione(client, { associazioneId: a.id, tipo: 'sicurezza', ...parsed.data.referenteSicurezza });
          await creaReferenteAssociazione(client, { associazioneId: a.id, tipo: 'emergenze_dae', ...parsed.data.referenteEmergenzeDae });
          await creaAssicurazioneAssociazione(client, { associazioneId: a.id, tipo: 'rct', ...parsed.data.assicurazioneRct });
          if (parsed.data.assicurazioneRco) {
            await creaAssicurazioneAssociazione(client, { associazioneId: a.id, tipo: 'rco', ...parsed.data.assicurazioneRco });
          }
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: a.id, ruolo: 'rappresentante' },
            azione: 'accreditamento_associazione',
            entitaTipo: 'associazioni',
            entitaId: a.id,
            dettaglio: a as unknown as Record<string, unknown>,
          });
          return a;
        });
        res.status(201).json(associazione);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/pubblico/associazioni/:id/documenti',
    richiedeAutenticazionePubblico,
    gestisciUpload,
    async (req: RequestAutenticataPubblico, res) => {
      const associazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const file = req.file;
      if (!file) {
        res.status(415).json({ errore: 'file mancante o mimetype non consentito (solo application/pdf)' });
        return;
      }
      const parsed = schemaCaricaDocumento.safeParse(req.body);
      if (!parsed.success) {
        await unlink(file.path).catch(() => {});
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const associazione = await trovaAssociazionePerId(pool, associazioneId);
        if (!associazione) {
          await unlink(file.path).catch(() => {});
          res.status(404).json({ errore: 'associazione non trovata' });
          return;
        }
        const abilitazione = await pool.query(
          `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato IN ('in_attesa', 'approvata') LIMIT 1`,
          [req.persona!.sub, associazioneId],
        );
        if (abilitazione.rows.length === 0) {
          await unlink(file.path).catch(() => {});
          res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione' });
          return;
        }
        // Il mimetype dichiarato dal client non è fidato (fileFilter di multer lo usa solo
        // per scartare subito i casi ovvi): verifica sui primi byte reali del file salvato.
        const intestazione = (await readFile(file.path)).subarray(0, 5).toString('utf8');
        if (intestazione !== '%PDF-') {
          await unlink(file.path).catch(() => {});
          res.status(415).json({ errore: 'il contenuto del file non è un PDF valido' });
          return;
        }
        const documento = await eseguiInTransazione(pool, async (client) => {
          const d = await creaDocumentoAssociazione(client, {
            associazioneId,
            tipo: parsed.data.tipo,
            filePath: file.filename,
          });
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId, ruolo: null },
            azione: 'carica_documento_associazione',
            entitaTipo: 'associazioni_documenti',
            entitaId: d.id,
            dettaglio: d as unknown as Record<string, unknown>,
          });
          return d;
        });
        res.status(201).json(documento);
      } catch (err) {
        await unlink(file.path).catch(() => {});
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/associazioni/:associazioneId/documenti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const associazioneId = typeof req.params.associazioneId === 'string' ? req.params.associazioneId : '';
        const associazione = await trovaAssociazionePerId(pool, associazioneId);
        if (!associazione) {
          res.status(404).json({ errore: 'associazione non trovata' });
          return;
        }
        res.status(200).json(await listaDocumentiPerAssociazione(pool, associazioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/associazioni/:id/dettagli-accreditamento',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const associazioneId = typeof req.params.id === 'string' ? req.params.id : '';
        const associazione = await trovaAssociazionePerId(pool, associazioneId);
        if (!associazione) {
          res.status(404).json({ errore: 'associazione non trovata' });
          return;
        }
        const [referenti, assicurazioni] = await Promise.all([
          listaReferentiPerAssociazione(pool, associazioneId),
          listaAssicurazioniPerAssociazione(pool, associazioneId),
        ]);
        res.status(200).json({ referenti, assicurazioni });
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/documenti/:id/scarica',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const documento = await trovaDocumentoPerId(pool, id);
        if (!documento) {
          res.status(404).json({ errore: 'documento non trovato' });
          return;
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        res.sendFile(documento.filePath, { root: percorsoStorageDocumenti() }, (err) => {
          if (err && !res.headersSent) {
            res.status(404).json({ errore: 'file non trovato su disco' });
          }
        });
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/deleghe', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    const parsed = schemaQueryListaDeleghe.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      res.status(200).json(await listaAbilitazioni(pool, parsed.data));
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post(
    '/pubblico/deleghe',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaDelega.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const delegante = await trovaAbilitazioneAttiva(
          pool,
          req.persona!.sub,
          parsed.data.associazioneId,
          parsed.data.stagioneId,
        );
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        if (parsed.data.ruolo === 'rappresentante' && delegante.ruolo !== 'rappresentante') {
          res.status(403).json({ errore: 'solo un delegante con ruolo rappresentante può assegnare ruolo rappresentante' });
          return;
        }
        const subDelega = await eseguiInTransazione(pool, async (client) => {
          let target = await trovaPersonaFisicaPerCf(client, parsed.data.codiceFiscale);
          if (!target) {
            target = await creaPersonaFisicaShell(client, {
              codiceFiscale: parsed.data.codiceFiscale,
              nome: parsed.data.nome,
              cognome: parsed.data.cognome,
            });
          }
          const sub = await creaSubDelega(client, {
            personaFisicaId: target.id,
            associazioneId: parsed.data.associazioneId,
            stagioneId: parsed.data.stagioneId,
            ruolo: parsed.data.ruolo,
            creataDaAbilitazioneId: delegante.id,
          });
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'delega_creata',
            entitaTipo: 'abilitazioni',
            entitaId: sub.id,
            dettaglio: sub as unknown as Record<string, unknown>,
          });
          return sub;
        });
        res.status(201).json(subDelega);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Le proprie deleghe: nessun filtro stagione (una persona può averne su stagioni
  // diverse), tutti gli stati (la UI deve poter mostrare anche in_attesa/respinta,
  // non solo approvata).
  app.get('/pubblico/deleghe/mie', richiedeAutenticazionePubblico, async (req: RequestAutenticataPubblico, res) => {
    try {
      // Belt-and-braces: verificaAccessTokenPubblico garantisce già che `sub` sia
      // una stringa non vuota, ma questo filtro è un confine di autorizzazione
      // (vedi listaAbilitazioni) — meglio un 401 esplicito che affidarsi solo a
      // quella garanzia a monte.
      const personaFisicaId = req.persona!.sub;
      if (!personaFisicaId) {
        res.status(401).json({ errore: 'Sessione non riconosciuta.' });
        return;
      }
      res.status(200).json(await listaAbilitazioni(pool, { personaFisicaId }));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/deleghe/:id/approva',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const abilitazione = await eseguiInTransazione(pool, async (client) => {
          const a = await approvaAbilitazione(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'approva_delega',
            entitaTipo: 'abilitazioni',
            entitaId: a.id,
            dettaglio: a as unknown as Record<string, unknown>,
          });
          return a;
        });
        res.status(200).json(abilitazione);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/deleghe/:id/respingi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaRespingiDelega.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const abilitazione = await eseguiInTransazione(pool, async (client) => {
          const a = await respingiAbilitazione(client, id, req.utente!.sub, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'respingi_delega',
            entitaTipo: 'abilitazioni',
            entitaId: a.id,
            dettaglio: a as unknown as Record<string, unknown>,
          });
          return a;
        });
        res.status(200).json(abilitazione);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/deleghe/:id/revoca',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const revocate = await eseguiInTransazione(pool, async (client) => {
          const lista = await revocaAbilitazioneConCascata(client, id);
          for (const a of lista) {
            await registraOperazione(client, {
              attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
              azione: 'revoca_delega',
              entitaTipo: 'abilitazioni',
              entitaId: a.id,
              dettaglio: a as unknown as Record<string, unknown>,
            });
          }
          return lista;
        });
        res.status(200).json(revocate);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/impostazioni/oidc',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (_req, res) => {
      try {
        const config = await leggiConfigOidcPubblica(pool);
        if (!config) {
          res.status(404).json({ errore: 'configurazione OIDC non ancora impostata' });
          return;
        }
        res.status(200).json(config);
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/impostazioni/oidc',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaImpostazioniOidc.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const config = await eseguiInTransazione(pool, async (client) => {
          await scriviConfigOidc(client, parsed.data, req.utente!.sub);
          // entitaId omesso: impostazioni_sistema ha PK testuale (chiave), non UUID —
          // stesso caso già gestito per discipline_sportive (vedi CLAUDE.md). Il
          // dettaglio NON include mai clientSecret, nemmeno cifrato.
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'aggiorna_impostazioni_oidc',
            entitaTipo: 'impostazioni_sistema',
            dettaglio: { issuer: parsed.data.issuer, clientId: parsed.data.clientId, redirectUri: parsed.data.redirectUri },
          });
          return leggiConfigOidcPubblica(client);
        });
        res.status(200).json(config);
      } catch (err) {
        if (err instanceof ErroreClientSecretMancante) {
          res.status(400).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/backoffice/utenti',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaUtenteBackoffice.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      if (!inviaEmailFn || !backofficeBaseUrl) {
        res.status(503).json({ errore: 'SMTP non configurato (SMTP_HOST/BACKOFFICE_BASE_URL in .env)' });
        return;
      }
      try {
        const { utente, token } = await eseguiInTransazione(pool, async (client) => {
          const { utente: u, token: t } = await creaUtenteInvitato(client, parsed.data, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: u.id,
            dettaglio: { email: u.email, nome: u.nome, cognome: u.cognome, ruolo: u.ruolo },
          });
          return { utente: u, token: t };
        });
        // Invio email FUORI dalla transazione (già commessa sopra): stesso pattern di
        // reset-password, non tiene occupata una connessione del pool per la durata SMTP.
        // Se l'invio fallisce, l'utente resta comunque creato in_attesa_verifica — un
        // admin può rigenerare l'invito con reset-password se l'email si perde.
        await inviaEmailFn({
          a: utente.email,
          oggetto: 'POLARIS — invito account backoffice',
          testo: [
            `Buongiorno ${utente.nome} ${utente.cognome},`,
            '',
            'è stato creato per lei un account sul backoffice POLARIS. Per attivarlo e impostare la password apra questo link:',
            '',
            `${backofficeBaseUrl}/utenti/accetta-invito?token=${token}`,
            '',
            'Il link scade tra 24 ore.',
          ].join('\n'),
        });
        res.status(201).json(aPubblico(utente));
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/utenti', richiedeAutenticazione, richiedeRuolo('admin'), async (_req, res) => {
    try {
      res.status(200).json((await listaUtenti(pool)).map(aPubblico));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/utenti/:id', richiedeAutenticazione, richiedeRuolo('admin'), async (req, res) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const utente = await trovaUtentePerId(pool, id);
      if (!utente) {
        res.status(404).json({ errore: 'utente non trovato' });
        return;
      }
      res.status(200).json(aPubblico(utente));
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put(
    '/backoffice/utenti/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaAggiornaUtenteBackoffice.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const utente = await eseguiInTransazione(pool, async (client) => {
          const u = await aggiornaUtente(client, id, parsed.data);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'aggiorna_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: u.id,
            dettaglio: { nome: u.nome, cognome: u.cognome, ruolo: u.ruolo },
          });
          return u;
        });
        res.status(200).json(aPubblico(utente));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreUltimoAdmin) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/utenti/:id/stato',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCambiaStatoUtenteBackoffice.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const utente = await eseguiInTransazione(pool, async (client) => {
          const u = await cambiaStatoUtente(client, id, parsed.data.stato, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'cambia_stato_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: u.id,
            dettaglio: { stato: u.stato },
          });
          return u;
        });
        res.status(200).json(aPubblico(utente));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreUltimoAdmin) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/backoffice/utenti/:id/reset-password',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      if (!inviaEmailFn || !backofficeBaseUrl) {
        res.status(503).json({ errore: 'SMTP non configurato (SMTP_HOST/BACKOFFICE_BASE_URL in .env)' });
        return;
      }
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const risultato = await eseguiInTransazione(pool, async (client) => {
          const esito = await impostaNuovoInvito(client, id, req.utente!.sub);
          if (!esito) {
            return null;
          }
          await revocaSessioniUtente(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'richiedi_reset_password_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: id,
          });
          return esito;
        });
        if (!risultato) {
          res.status(404).json({ errore: 'utente non trovato' });
          return;
        }
        await inviaEmailFn({
          a: risultato.utente.email,
          oggetto: 'POLARIS — reimposta la password del tuo account backoffice',
          testo: [
            `Buongiorno ${risultato.utente.nome} ${risultato.utente.cognome},`,
            '',
            'è stato richiesto un reset della password del suo account backoffice POLARIS. Per impostarne una nuova apra questo link:',
            '',
            `${backofficeBaseUrl}/utenti/accetta-invito?token=${risultato.token}`,
            '',
            'Il link scade tra 24 ore. Le sessioni attive precedenti sono state disconnesse.',
          ].join('\n'),
        });
        res.status(200).json(aPubblico(risultato.utente));
      } catch (err) {
        if (err instanceof ErroreUltimoAdmin || err instanceof ErroreUtenteDisattivato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post('/backoffice/utenti/accetta-invito', limitatoreLogin, async (req, res) => {
    const parsed = schemaAccettaInvitoUtente.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      const utente = await eseguiInTransazione(pool, async (client) => {
        const u = await completaInvito(client, parsed.data.token, parsed.data.password);
        await registraOperazione(client, {
          attore: { tipo: 'backoffice', utenteBackofficeId: u.id, ruolo: u.ruolo },
          azione: 'accetta_invito_utente_backoffice',
          entitaTipo: 'utenti_backoffice',
          entitaId: u.id,
        });
        return u;
      });
      res.status(200).json(aPubblico(utente));
    } catch (err) {
      if (err instanceof ErroreTokenInvitoNonValido) {
        res.status(400).json({ errore: err.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/parametrico', richiedeAutenticazione, richiedeRuolo('admin'), async (_req, res) => {
    try {
      const versione = await leggiVersioneAttiva(pool);
      if (!versione) {
        res.status(404).json({ errore: 'nessuna versione parametrica trovata' });
        return;
      }
      res.status(200).json(versione);
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/parametrico/versioni', richiedeAutenticazione, richiedeRuolo('admin'), async (_req, res) => {
    try {
      res.status(200).json(await listaVersioni(pool));
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/parametrico/versioni/:id', richiedeAutenticazione, richiedeRuolo('admin'), async (req, res) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const versione = await leggiVersionePerId(pool, id);
      if (!versione) {
        res.status(404).json({ errore: 'versione non trovata' });
        return;
      }
      res.status(200).json(versione);
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post(
    '/backoffice/parametrico',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const parsed = schemaCreaVersioneParametrico.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const versione = await eseguiInTransazione(pool, async (client) => {
          const v = await creaVersione(client, parsed.data, req.utente!.sub);
          const { csdScaglioni, ...dettaglioSenzaScaglioni } = v;
          void csdScaglioni;
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_versione_parametrico',
            entitaTipo: 'parametrico_versioni',
            entitaId: v.id,
            dettaglio: dettaglioSenzaScaglioni as unknown as Record<string, unknown>,
          });
          return v;
        });
        res.status(201).json(versione);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Coda verso il motore Go (art. B.7/B.12/B.17 — orchestrazione, nessuna logica
  // di calcolo qui, solo trasporto + guardrail di concorrenza/ordine fasi) ---

  // Validazione esplicita PRIMA di aprire la transazione/chiamare il motore: senza questa
  // guardia un stagioneId malformato su /istruttoria arriverebbe a invocare il motore Go
  // reale (nessuna query DB intermedia lo intercetta, a differenza di blocchi-gara/
  // prima-assegnazione che passano comunque da verificaIstruttoriaEseguita), col rischio
  // di un ErroreMotoreDominio mappato a 500 invece del 400 richiesto per un id malformato.
  const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function validaStagioneIdUuid(stagioneId: string): void {
    if (!REGEX_UUID.test(stagioneId)) {
      throw new ErroreRiferimentoNonValido('stagioneId malformato');
    }
  }

  async function verificaIstruttoriaEseguita(client: PoolClient, stagioneId: string): Promise<boolean> {
    const r = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM fabbisogni_riconosciuti fr
         JOIN domande d ON d.id = fr.domanda_id
         WHERE d.stagione_id = $1
       ) AS exists`,
      [stagioneId],
    );
    return r.rows[0]!.exists;
  }

  // Finding 1 (review finale "coda motore Go"): nessuna delle 4 route verificava mai che
  // la stagione esistesse davvero. Un UUID sintatticamente valido ma inesistente arrivava
  // fino al motore Go (che risponde comunque, filtrando su uno stagione_id senza righe) o
  // veniva scambiato per "istruttoria non eseguita" (409 invece di 404). Un'unica funzione
  // condivisa — accetta sia PoolClient (dentro le transazioni delle 3 POST) sia Pool (per
  // la GET storico, sola lettura) tramite l'interfaccia minima Db.
  async function verificaStagioneEsiste(db: Db, stagioneId: string): Promise<void> {
    const r = await db.query<{ exists: boolean }>('SELECT EXISTS(SELECT 1 FROM stagioni_sportive WHERE id = $1) AS exists', [
      stagioneId,
    ]);
    if (!r.rows[0]!.exists) {
      throw new ErroreNonTrovato('stagione non trovata');
    }
  }

  function gestisciEsecuzioneMotore(err: unknown, res: Response): void {
    if (err instanceof ErroreNonTrovato) {
      res.status(404).json({ errore: err.message });
      return;
    }
    if (err instanceof ErroreElaborazioneInCorso) {
      res.status(409).json({ errore: err.message });
      return;
    }
    if (err instanceof ErroreOrdineFasiNonRispettato) {
      res.status(409).json({ errore: err.message });
      return;
    }
    if (err instanceof ErroreStatoNonValidoPerTransizione) {
      res.status(409).json({ errore: err.message });
      return;
    }
    if (err instanceof ErroreMotoreIrraggiungibile) {
      // Finding 5 (review finale "coda motore Go"): il ROLLBACK della transazione (innescato
      // da questo errore) rilascia SUBITO il lock advisory, ma non sappiamo se il motore Go
      // stia ancora effettivamente eseguendo lato suo (il nostro timeout è solo lato client,
      // vedi engine/client.ts). Un retry immediato dell'admin dopo un 502 può quindi avviare
      // una SECONDA esecuzione concorrente sulla stessa stagione. Non c'è ancora un fix
      // strutturale disponibile: richiederebbe che il motore Go segnali "sto ancora
      // eseguendo" o che marchi l'elaborazione come conclusa/fallita anche su timeout lato
      // client, entrambi fuori scope qui. L'unica rete di sicurezza reale è
      // assegnazioni_slot_attiva_uq lato DB (rigetta la seconda scrittura in conflitto), ma
      // arriverebbe come errore Postgres grezzo mappato a 500, non un 409 leggibile.
      // Consiglio operativo: prima di ritentare dopo un 502, controllare
      // GET .../elaborazioni per lo stato dell'esecuzione precedente.
      res.status(502).json({ errore: 'motore non raggiungibile' });
      return;
    }
    if (err instanceof ErroreMotoreDominio) {
      res.status(500).json({ errore: err.message });
      return;
    }
    const erroreRiferimento = comeErroreRiferimentoNonValido(err);
    if (erroreRiferimento) {
      res.status(400).json({ errore: erroreRiferimento.message });
      return;
    }
    res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
  }

  app.post(
    '/backoffice/stagioni/:id/istruttoria',
    limitatoreEsecuzioneMotore,
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!clientMotore) {
        res.status(500).json({ errore: 'motore non configurato' });
        return;
      }
      try {
        validaStagioneIdUuid(stagioneId);
        const risultato = await eseguiInTransazione(pool, async (client) => {
          // Finding 2 (review finale "coda motore Go"): pg_try_advisory_xact_lock, non
          // pg_advisory_xact_lock — non-bloccante. La versione bloccante teneva occupata
          // una connessione del pool (max:10, vedi db.ts) per l'intera attesa+esecuzione
          // (fino a ENGINE_TIMEOUT_MS, default 300000ms) di una richiesta accodata dietro
          // un'altra sulla stessa stagione, rischiando di affamare OGNI altra route
          // dell'app (login incluso) sotto un flood o anche solo due click ravvicinati
          // dell'admin.
          const lock = await client.query<{ pg_try_advisory_xact_lock: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1))', [
            stagioneId,
          ]);
          if (!lock.rows[0]!.pg_try_advisory_xact_lock) {
            throw new ErroreElaborazioneInCorso('elaborazione già in corso per questa stagione');
          }
          await verificaStagioneEsiste(client, stagioneId);
          const r = await clientMotore.eseguiIstruttoria(stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'esegui_istruttoria',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: r as unknown as Record<string, unknown>,
          });
          return r;
        });
        res.status(200).json(risultato);
      } catch (err) {
        gestisciEsecuzioneMotore(err, res);
      }
    },
  );

  app.post(
    '/backoffice/stagioni/:id/blocchi-gara',
    limitatoreEsecuzioneMotore,
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!clientMotore) {
        res.status(500).json({ errore: 'motore non configurato' });
        return;
      }
      try {
        validaStagioneIdUuid(stagioneId);
        const risultato = await eseguiInTransazione(pool, async (client) => {
          const lock = await client.query<{ pg_try_advisory_xact_lock: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1))', [
            stagioneId,
          ]);
          if (!lock.rows[0]!.pg_try_advisory_xact_lock) {
            throw new ErroreElaborazioneInCorso('elaborazione già in corso per questa stagione');
          }
          await verificaStagioneEsiste(client, stagioneId);
          if (!(await verificaIstruttoriaEseguita(client, stagioneId))) {
            throw new ErroreOrdineFasiNonRispettato('istruttoria non ancora eseguita per questa stagione');
          }
          const r = await clientMotore.eseguiBlocchiGara(stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'esegui_blocchi_gara',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: r as unknown as Record<string, unknown>,
          });
          return r;
        });
        res.status(200).json(risultato);
      } catch (err) {
        gestisciEsecuzioneMotore(err, res);
      }
    },
  );

  app.post(
    '/backoffice/stagioni/:id/prima-assegnazione',
    limitatoreEsecuzioneMotore,
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!clientMotore) {
        res.status(500).json({ errore: 'motore non configurato' });
        return;
      }
      try {
        validaStagioneIdUuid(stagioneId);
        const risultato = await eseguiInTransazione(pool, async (client) => {
          const lock = await client.query<{ pg_try_advisory_xact_lock: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1))', [
            stagioneId,
          ]);
          if (!lock.rows[0]!.pg_try_advisory_xact_lock) {
            throw new ErroreElaborazioneInCorso('elaborazione già in corso per questa stagione');
          }
          await verificaStagioneEsiste(client, stagioneId);
          if (!(await verificaIstruttoriaEseguita(client, stagioneId))) {
            throw new ErroreOrdineFasiNonRispettato('istruttoria non ancora eseguita per questa stagione');
          }
          const r = await clientMotore.eseguiPrimaAssegnazione(stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'esegui_prima_assegnazione',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: r as unknown as Record<string, unknown>,
          });
          return r;
        });
        res.status(200).json(risultato);
      } catch (err) {
        gestisciEsecuzioneMotore(err, res);
      }
    },
  );

  app.post(
    '/backoffice/stagioni/:id/riassegnazione-residua',
    limitatoreEsecuzioneMotore,
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!clientMotore) {
        res.status(500).json({ errore: 'motore non configurato' });
        return;
      }
      try {
        validaStagioneIdUuid(stagioneId);
        const risultato = await eseguiInTransazione(pool, async (client) => {
          const lock = await client.query<{ pg_try_advisory_xact_lock: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1))', [
            stagioneId,
          ]);
          if (!lock.rows[0]!.pg_try_advisory_xact_lock) {
            throw new ErroreElaborazioneInCorso('elaborazione già in corso per questa stagione');
          }
          await verificaStagioneEsiste(client, stagioneId);
          const stagione = await client.query<{ stato: string }>('SELECT stato FROM stagioni_sportive WHERE id = $1', [stagioneId]);
          if (stagione.rows[0]!.stato !== 'concertazione') {
            throw new ErroreStatoNonValidoPerTransizione('la stagione non è in fase di concertazione');
          }
          // art. B.24: la finestra di concertazione ha una fine — le proposte già accettate
          // da tutte le parti ma non ancora decise dal backoffice (B.27-28) devono essere
          // validate/rigettate ESPLICITAMENTE prima di chiudere, per non far scavalcare uno
          // scambio già consensuale tra associazioni dalla riassegnazione algoritmica.
          const pendenti = await client.query(
            `SELECT 1 FROM concertazione_proposte WHERE stagione_id = $1 AND stato = 'accettata_da_tutti' LIMIT 1`,
            [stagioneId],
          );
          if ((pendenti.rowCount ?? 0) > 0) {
            throw new ErroreStatoNonValidoPerTransizione(
              'esistono proposte di concertazione accettate da tutte le parti non ancora validate o rigettate',
            );
          }
          // Le proposte mai arrivate a piena accettazione decadono automaticamente alla
          // chiusura della finestra (nessuna parte ha ancora un interesse consolidato).
          await client.query(
            `UPDATE concertazione_proposte SET stato = 'annullata' WHERE stagione_id = $1 AND stato = 'in_attesa_accettazione'`,
            [stagioneId],
          );
          const r = await clientMotore.eseguiRiassegnazioneResidua(stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'riassegnazione_residua',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: r as unknown as Record<string, unknown>,
          });
          return r;
        });
        res.status(200).json(risultato);
      } catch (err) {
        gestisciEsecuzioneMotore(err, res);
      }
    },
  );

  app.get(
    '/backoffice/stagioni/:id/elaborazioni',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        validaStagioneIdUuid(stagioneId);
        await verificaStagioneEsiste(pool, stagioneId);
        const r = await pool.query(
          `SELECT id, stagione_id, tipo, parametrico_versione_id, iniziata_il, conclusa_il,
                  stato, numero_round_eseguiti, log_dettaglio
           FROM elaborazioni
           WHERE stagione_id = $1
           ORDER BY iniziata_il DESC`,
          [stagioneId],
        );
        res.status(200).json(
          r.rows.map((row) => ({
            id: row.id,
            stagioneId: row.stagione_id,
            tipo: row.tipo,
            parametricoVersioneId: row.parametrico_versione_id,
            iniziataIl: (row.iniziata_il as Date).toISOString(),
            conclusaIl: row.conclusa_il ? (row.conclusa_il as Date).toISOString() : null,
            stato: row.stato,
            numeroRoundEseguiti: row.numero_round_eseguiti,
            logDettaglio: row.log_dettaglio,
          })),
        );
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/log-operazioni', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req: RequestAutenticata, res) => {
    const parsed = schemaQueryListaLogOperazioni.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
      return;
    }
    try {
      const righe = await listaOperazioni(pool, {
        entitaTipo: parsed.data.entitaTipo,
        azione: parsed.data.azione,
        dataDa: parsed.data.dataDa,
        dataA: parsed.data.dataA,
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      });
      // `dettaglio` può portare payload di operazioni admin-only (es.
      // crea_utente_backoffice, crea_versione_parametrico) a cui un operatore
      // non ha accesso a livello di route; `ipAddress` è dato personale (GDPR).
      // Un operatore vede la lista/azioni/entità ma non questi due campi.
      const righePerRuolo =
        req.utente!.ruolo === 'admin'
          ? righe
          : righe.map(({ dettaglio, ipAddress, ...resto }) => resto);
      res.status(200).json(righePerRuolo);
    } catch (err) {
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(
    '/backoffice/stagioni/:id/sorteggi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        validaStagioneIdUuid(stagioneId);
        await verificaStagioneEsiste(pool, stagioneId);
        res.status(200).json(await listaSorteggiPerStagione(pool, stagioneId));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/sorteggi/:id',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        const sorteggio = await trovaSorteggioConCandidati(pool, id);
        if (!sorteggio) {
          res.status(404).json({ errore: 'sorteggio non trovato' });
          return;
        }
        res.status(200).json(sorteggio);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/stagioni/:id/statistiche',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        validaStagioneIdUuid(stagioneId);
        await verificaStagioneEsiste(pool, stagioneId);
        const statistiche = await calcolaStatisticheStagione(pool, stagioneId);
        res.status(200).json(statistiche);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Approvazione settimana tipo definitiva (art. B.30) ---

  app.post(
    '/backoffice/stagioni/:id/approva-definitiva',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const esito = await eseguiInTransazione(pool, async (client) => {
          // C2/I1 (final review): stesso advisory lock non-bloccante delle 4 route
          // motore-Go — senza, un secondo admin (o la stessa persona in due tab) poteva
          // chiamare approva-definitiva mentre una riassegnazione-residua era ancora in
          // corso contro il motore Go (fino a ENGINE_TIMEOUT_MS, default 5 minuti): lo
          // snapshot delle convenzioni verrebbe preso prima che le assegnazioni della
          // riassegnazione residua siano committate, e approva-definitiva non è
          // ri-eseguibile (richiede stato='concertazione').
          const lock = await client.query<{ pg_try_advisory_xact_lock: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1))', [
            stagioneId,
          ]);
          if (!lock.rows[0]!.pg_try_advisory_xact_lock) {
            throw new ErroreElaborazioneInCorso('elaborazione già in corso per questa stagione');
          }
          // Stessa chiusura della finestra di concertazione fatta da riassegnazione-residua
          // (art. B.24/B.27): 409 se restano proposte accettate da tutte le parti ma non
          // ancora decise dal backoffice, poi annullamento bulk di quelle mai arrivate a
          // piena accettazione — approva-definitiva è un altro modo di chiudere la finestra,
          // non deve lasciarne aperte di pendenti dietro di sé.
          const pendenti = await client.query(
            `SELECT 1 FROM concertazione_proposte WHERE stagione_id = $1 AND stato = 'accettata_da_tutti' LIMIT 1`,
            [stagioneId],
          );
          if ((pendenti.rowCount ?? 0) > 0) {
            throw new ErroreStatoNonValidoPerTransizione(
              'esistono proposte di concertazione accettate da tutte le parti non ancora validate o rigettate',
            );
          }
          await client.query(
            `UPDATE concertazione_proposte SET stato = 'annullata' WHERE stagione_id = $1 AND stato = 'in_attesa_accettazione'`,
            [stagioneId],
          );
          const e = await approvaSettimanaTipoDefinitiva(client, stagioneId);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'approva_settimana_tipo_definitiva',
            entitaTipo: 'stagioni_sportive',
            entitaId: stagioneId,
            dettaglio: { convenzioniCreate: e.convenzioniCreate, assegnazioniSenzaIstituzioneSaltate: e.assegnazioniSenzaIstituzioneSaltate },
          });
          return e;
        });
        res.status(200).json(esito);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreElaborazioneInCorso) {
          res.status(409).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Convenzioni (art. B.31) ---

  app.get(
    '/backoffice/stagioni/:id/convenzioni',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stato = req.query.stato === 'in_attesa' || req.query.stato === 'perfezionata' ? req.query.stato : undefined;
      try {
        res.status(200).json(await listaConvenzioniPerStagione(pool, stagioneId, stato));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/convenzioni/:id/conferma',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const convenzione = await eseguiInTransazione(pool, async (client) => {
          const c = await confermaConvenzione(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'conferma_convenzione',
            entitaTipo: 'convenzioni',
            entitaId: c.id,
            dettaglio: { stato: c.stato },
          });
          return c;
        });
        res.status(200).json(convenzione);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Pubblico: settimana tipo definitiva (art. B.30-31) ---

  app.get(
    '/pubblico/stagioni/:id/settimana-tipo-definitiva',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        res.status(200).json(await trovaSettimanaTipoDefinitiva(pool, stagioneId));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Pubblico: slot della settimana tipo (per il wizard domanda) ---

  app.get(
    '/pubblico/stagioni/:id/slot',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const disciplinaCodice = typeof req.query.disciplinaCodice === 'string' ? req.query.disciplinaCodice : undefined;
      try {
        const condizioneDisciplina = disciplinaCodice
          ? `AND EXISTS (
               SELECT 1 FROM spazio_disciplina_compatibile sdc
               WHERE sdc.spazio_id = sp.id AND sdc.disciplina_codice = $2
             )`
          : '';
        const parametri = disciplinaCodice ? [stagioneId, disciplinaCodice] : [stagioneId];
        const r = await pool.query(
          `SELECT s.id, i.denominazione AS impianto_denominazione, sp.denominazione AS spazio_denominazione,
                  s.giorno_settimana, s.orario_inizio::text, s.orario_fine::text, s.durata_minuti, s.pregiata
           FROM slot_settimana_tipo s
           JOIN spazi_sportivi sp ON sp.id = s.spazio_id
           JOIN impianti i ON i.id = sp.impianto_id
           WHERE s.stagione_id = $1 AND s.indisponibile_permanente = false
           ${condizioneDisciplina}
           ORDER BY i.denominazione, sp.denominazione, s.giorno_settimana, s.orario_inizio`,
          parametri,
        );
        res.status(200).json(
          r.rows.map((row) => ({
            id: row.id,
            impiantoDenominazione: row.impianto_denominazione,
            spazioDenominazione: row.spazio_denominazione,
            giornoSettimana: row.giorno_settimana,
            orarioInizio: row.orario_inizio,
            orarioFine: row.orario_fine,
            durataMinuti: row.durata_minuti,
            pregiata: row.pregiata,
          })),
        );
      } catch (err) {
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Pubblico: presentazione domanda (Allegato B art. B.5-B.6) ---

  app.post(
    '/pubblico/domande',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaDomanda.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, parsed.data.associazioneId, parsed.data.stagioneId);
      if (!delegante) {
        res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
        return;
      }
      try {
        const domanda = await eseguiInTransazione(pool, async (client) => {
          const d = await creaDomanda(client, parsed.data, req.persona!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'crea_domanda',
            entitaTipo: 'domande',
            entitaId: d.id,
            dettaglio: d as unknown as Record<string, unknown>,
          });
          return d;
        });
        res.status(201).json(domanda);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/pubblico/associazioni/:associazioneId/domande',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const associazioneId = typeof req.params.associazioneId === 'string' ? req.params.associazioneId : '';
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      try {
        // Se stagioneId è passato dal client, scopiamo anche la verifica di abilitazione a
        // quella stagione (I2): altrimenti la richiesta è cross-stagione per definizione,
        // e verifichiamo solo che esista un'abilitazione su QUALCHE stagione.
        const abilitazione = stagioneId
          ? await pool.query(
              `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stagione_id = $3 AND stato IN ('in_attesa', 'approvata') LIMIT 1`,
              [req.persona!.sub, associazioneId, stagioneId],
            )
          : await pool.query(
              `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato IN ('in_attesa', 'approvata') LIMIT 1`,
              [req.persona!.sub, associazioneId],
            );
        if (abilitazione.rows.length === 0) {
          res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione' });
          return;
        }
        res.status(200).json(await listaDomandePerAssociazione(pool, associazioneId, stagioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/pubblico/domande/:id', richiedeAutenticazionePubblico, async (req: RequestAutenticataPubblico, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    try {
      const domanda = await trovaDomandaPerId(pool, id);
      if (!domanda) {
        res.status(404).json({ errore: 'domanda non trovata' });
        return;
      }
      // La domanda ha sempre una stagione precisa: la verifica di abilitazione DEVE essere
      // scoped a quella stagione (I2), non basta un'abilitazione su un'altra stagione della
      // stessa associazione.
      const abilitazione = await pool.query(
        `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stagione_id = $3 AND stato IN ('in_attesa', 'approvata') LIMIT 1`,
        [req.persona!.sub, domanda.associazioneId, domanda.stagioneId],
      );
      if (abilitazione.rows.length === 0) {
        res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione per questa stagione' });
        return;
      }
      res.status(200).json(domanda);
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Backoffice: verifica ammissibilità domanda (art. B.7) ---

  app.put(
    '/backoffice/domande/:id/ammetti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const domanda = await eseguiInTransazione(pool, async (client) => {
          const d = await ammettiDomanda(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'ammetti_domanda',
            entitaTipo: 'domande',
            entitaId: d.id,
            dettaglio: { stato: d.stato },
          });
          return d;
        });
        res.status(200).json(domanda);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/domande/:id/escludi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaRespingiDelega.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const domanda = await eseguiInTransazione(pool, async (client) => {
          const d = await escludiDomanda(client, id, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'escludi_domanda',
            entitaTipo: 'domande',
            entitaId: d.id,
            dettaglio: { stato: d.stato, motivazioneEsclusione: d.motivazioneEsclusione },
          });
          return d;
        });
        res.status(200).json(domanda);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get('/backoffice/domande', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    try {
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      res.status(200).json(await listaDomandeBackoffice(pool, stagioneId));
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/backoffice/domande/:id', richiedeAutenticazione, richiedeRuolo('admin', 'operatore'), async (req, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    try {
      const domanda = await trovaDomandaConEsitoPerId(pool, id);
      if (!domanda) {
        res.status(404).json({ errore: 'domanda non trovata' });
        return;
      }
      res.status(200).json(domanda);
    } catch (err) {
      const erroreRiferimento = comeErroreRiferimentoNonValido(err);
      if (erroreRiferimento) {
        res.status(400).json({ errore: erroreRiferimento.message });
        return;
      }
      res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Pubblicazione proposta provvisoria (art. B.23) ---

  app.post(
    '/backoffice/stagioni/:id/pubblica-proposta',
    richiedeAutenticazione,
    richiedeRuolo('admin'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        await eseguiInTransazione(pool, async (client) => {
          await pubblicaProposta(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'pubblica_proposta_provvisoria',
            entitaTipo: 'stagioni_sportive',
            entitaId: id,
            dettaglio: null,
          });
        });
        res.status(200).json({ ok: true });
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/pubblico/stagioni/:id/proposta',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        res.status(200).json(await trovaPropostaProvvisoria(pool, id));
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Proposte di concertazione (art. B.24-B.26) ---

  app.post(
    '/pubblico/stagioni/:id/concertazione/proposte',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaCreaProposta.safeParse({ ...req.body, stagioneId });
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      const stagione = await pool.query<{ stato: string }>(`SELECT stato FROM stagioni_sportive WHERE id = $1`, [stagioneId]);
      if (stagione.rows[0]?.stato !== 'concertazione') {
        res.status(409).json({ errore: 'la stagione non è in fase di concertazione' });
        return;
      }
      const associazioniCoinvolte = new Set(
        parsed.data.slot.flatMap((s) => [s.associazioneCedenteId, s.associazioneRiceventeId].filter((x): x is string => x != null)),
      );
      const associazioneProponente = parsed.data.proponenteAssociazioneId;
      if (!associazioniCoinvolte.has(associazioneProponente)) {
        res.status(400).json({ errore: 'proponenteAssociazioneId deve essere una delle associazioni coinvolte nella proposta' });
        return;
      }
      const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, associazioneProponente, stagioneId);
      if (!delegante) {
        res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
        return;
      }
      try {
        const proposta = await eseguiInTransazione(pool, async (client) => {
          const p = await creaProposta(client, parsed.data, req.persona!.sub, associazioneProponente);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: associazioneProponente, ruolo: delegante.ruolo },
            azione: 'crea_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: p.id,
            dettaglio: p as unknown as Record<string, unknown>,
          });
          return p;
        });
        res.status(201).json(proposta);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/pubblico/stagioni/:id/concertazione/proposte',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const abilitazioni = await pool.query<{ associazione_id: string }>(
          `SELECT associazione_id FROM abilitazioni WHERE persona_fisica_id = $1 AND stagione_id = $2 AND stato = 'approvata'`,
          [req.persona!.sub, stagioneId],
        );
        const risultati = [];
        for (const riga of abilitazioni.rows) {
          risultati.push(...(await listaPropostePerAssociazione(pool, riga.associazione_id, stagioneId)));
        }
        const senzaDuplicati = [...new Map(risultati.map((p) => [p.id, p])).values()];
        res.status(200).json(senzaDuplicati);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/pubblico/concertazione/proposte/:id',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const proposta = await trovaPropostaPerId(pool, id);
        if (!proposta) {
          res.status(404).json({ errore: 'proposta non trovata' });
          return;
        }
        const parteAssociazioni = proposta.parti.map((p) => p.associazioneId);
        const abilitazione = await pool.query(
          `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = ANY($2) AND stagione_id = $3 AND stato = 'approvata' LIMIT 1`,
          [req.persona!.sub, parteAssociazioni, proposta.stagioneId],
        );
        if ((abilitazione.rowCount ?? 0) === 0) {
          res.status(403).json({ errore: 'la propria associazione non è parte di questa proposta' });
          return;
        }
        res.status(200).json(proposta);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/pubblico/concertazione/proposte/:id/accetta',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaAccettaProposta.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const proposta = await trovaPropostaPerId(pool, id);
        if (!proposta) {
          res.status(404).json({ errore: 'proposta non trovata' });
          return;
        }
        const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, parsed.data.associazioneId, proposta.stagioneId);
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        const aggiornata = await eseguiInTransazione(pool, async (client) => {
          const p = await accettaProposta(client, id, parsed.data.associazioneId, req.persona!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'accetta_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: p.id,
            dettaglio: { stato: p.stato },
          });
          return p;
        });
        res.status(200).json(aggiornata);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/pubblico/concertazione/proposte/:id/annulla',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const proposta = await trovaPropostaPerId(pool, id);
        if (!proposta) {
          res.status(404).json({ errore: 'proposta non trovata' });
          return;
        }
        if (proposta.proponentePersonaFisicaId !== req.persona!.sub) {
          res.status(403).json({ errore: 'solo il proponente può annullare la proposta' });
          return;
        }
        // I5 final review: solo il proponente originale non basta — la sua abilitazione
        // sull'associazione proponente potrebbe essere stata revocata nel frattempo (stesso
        // pattern di controllo usato da ogni altra route pubblica di scrittura).
        const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, proposta.proponenteAssociazioneId, proposta.stagioneId);
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        const aggiornata = await eseguiInTransazione(pool, async (client) => {
          const p = await annullaProposta(client, id);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: proposta.proponenteAssociazioneId, ruolo: delegante.ruolo },
            azione: 'annulla_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: p.id,
            dettaglio: { stato: p.stato },
          });
          return p;
        });
        res.status(200).json(aggiornata);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Backoffice: validazione delle proposte di concertazione (art. B.27-B.28) ---

  app.get(
    '/backoffice/stagioni/:id/concertazione/proposte',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stato = typeof req.query.stato === 'string' ? (req.query.stato as never) : undefined;
      try {
        res.status(200).json(await listaPropostePerStagioneBackoffice(pool, stagioneId, stato));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/concertazione/proposte/:id/valida',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const esito = await eseguiInTransazione(pool, async (client) => {
          const e = await validaProposta(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'valida_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: id,
            dettaglio: { esito: e.esito, motivazione: e.motivazione ?? null },
          });
          return e;
        });
        res.status(200).json(esito);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione || err instanceof ErroreConflittoFifoConcertazione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/concertazione/proposte/:id/rigetta',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaRespingiDelega.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const proposta = await eseguiInTransazione(pool, async (client) => {
          const p = await rigettaProposta(client, id, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'rigetta_proposta_concertazione',
            entitaTipo: 'concertazione_proposte',
            entitaId: p.id,
            dettaglio: { stato: p.stato, motivazioneRigetto: p.motivazioneRigetto },
          });
          return p;
        });
        res.status(200).json(proposta);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Pubblico: pubblicazione esiti istruttoria (art. B.10) ---

  app.get(
    '/pubblico/stagioni/:stagioneId/domande/esiti',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const stagioneId = typeof req.params.stagioneId === 'string' ? req.params.stagioneId : '';
      try {
        res.status(200).json(await elencoEsitiPubblicati(pool, stagioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Pubblico: presentazione osservazione (art. B.11) ---

  app.post(
    '/pubblico/domande/:id/osservazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const domandaId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaCreaOsservazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const domanda = await trovaDomandaPerId(pool, domandaId);
        if (!domanda) {
          res.status(404).json({ errore: 'domanda non trovata' });
          return;
        }
        const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, domanda.associazioneId, domanda.stagioneId);
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        const ruoloDelegante = delegante.ruolo;
        const osservazione = await eseguiInTransazione(pool, async (client) => {
          const o = await presentaOsservazione(client, {
            domandaId,
            personaFisicaId: req.persona!.sub,
            testo: parsed.data.testo,
          });
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: domanda.associazioneId, ruolo: ruoloDelegante },
            azione: 'presenta_osservazione',
            entitaTipo: 'osservazioni_istruttoria',
            entitaId: o.id,
            dettaglio: o as unknown as Record<string, unknown>,
          });
          // I6: traccia anche la transizione di riesame_stato della domanda (a differenza
          // di ammetti_domanda/escludi_domanda, non era mai registrata contro l'entità
          // 'domande') — solo quando avviene davvero (non su una seconda osservazione su
          // una domanda già a riesame_stato='richiesto').
          if (o.domandaTransitata) {
            await registraOperazione(client, {
              attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: domanda.associazioneId, ruolo: ruoloDelegante },
              azione: 'osservazione_richiede_riesame',
              entitaTipo: 'domande',
              entitaId: domandaId,
              dettaglio: { riesameStato: o.nuovoRiesameStato },
            });
          }
          return o;
        });
        // domandaTransitata/nuovoRiesameStato sono canale interno verso questa route
        // (I6/audit), non parte del contratto HTTP pubblico di un'osservazione (N3).
        const { domandaTransitata: _dt, nuovoRiesameStato: _nrs, ...osservazionePubblica } = osservazione;
        res.status(201).json(osservazionePubblica);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Backoffice: decisione osservazione (art. B.11) ---

  app.put(
    '/backoffice/osservazioni/:id/accogli',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const osservazione = await eseguiInTransazione(pool, async (client) => {
          const o = await accogliOsservazione(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'accogli_osservazione',
            entitaTipo: 'osservazioni_istruttoria',
            entitaId: o.id,
            dettaglio: { stato: o.stato },
          });
          // I6: traccia la transizione della domanda solo se il riesame si è davvero
          // consolidato in questa chiamata (restano altre osservazioni in_esame altrimenti).
          if (o.domandaTransitata) {
            await registraOperazione(client, {
              attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
              azione: 'consolida_riesame_domanda',
              entitaTipo: 'domande',
              entitaId: o.domandaId,
              dettaglio: { riesameStato: o.nuovoRiesameStato },
            });
          }
          return o;
        });
        const { domandaTransitata: _dt, nuovoRiesameStato: _nrs, ...osservazionePubblica } = osservazione;
        res.status(200).json(osservazionePubblica);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/osservazioni/:id/respingi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaRespingiDelega.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const osservazione = await eseguiInTransazione(pool, async (client) => {
          const o = await respingiOsservazione(client, id, req.utente!.sub, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'respingi_osservazione',
            entitaTipo: 'osservazioni_istruttoria',
            entitaId: o.id,
            dettaglio: { stato: o.stato, decisioneMotivazione: o.decisioneMotivazione },
          });
          if (o.domandaTransitata) {
            await registraOperazione(client, {
              attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
              azione: 'consolida_riesame_domanda',
              entitaTipo: 'domande',
              entitaId: o.domandaId,
              dettaglio: { riesameStato: o.nuovoRiesameStato },
            });
          }
          return o;
        });
        const { domandaTransitata: _dt, nuovoRiesameStato: _nrs, ...osservazionePubblica } = osservazione;
        res.status(200).json(osservazionePubblica);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Indisponibilità sopravvenute (art. B.33) ---

  app.post(
    '/backoffice/slot/:id/indisponibilita',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const slotId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaCreaIndisponibilita.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const indisponibilita = await eseguiInTransazione(pool, async (client) => {
          const ind = await creaIndisponibilita(client, { slotId, ...parsed.data });
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_indisponibilita',
            entitaTipo: 'indisponibilita_sopravvenute',
            entitaId: ind.id,
            dettaglio: ind as unknown as Record<string, unknown>,
          });
          return ind;
        });
        res.status(201).json(indisponibilita);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/pubblico/associazioni/:id/indisponibilita',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const associazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      try {
        const abilitazione = stagioneId
          ? await pool.query(
              `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stagione_id = $3 AND stato = 'approvata' LIMIT 1`,
              [req.persona!.sub, associazioneId, stagioneId],
            )
          : await pool.query(
              `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato = 'approvata' LIMIT 1`,
              [req.persona!.sub, associazioneId],
            );
        if ((abilitazione.rowCount ?? 0) === 0) {
          res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione' });
          return;
        }
        res.status(200).json(await listaIndisponibilitaPerAssociazione(pool, associazioneId, stagioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Variazioni ordinarie (art. B.32) — interamente tra associazioni, nessuna
  // validazione backoffice attiva (istruzione esplicita del committente) ---

  app.post(
    '/pubblico/variazioni',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const parsed = schemaCreaVariazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, parsed.data.associazioneId, parsed.data.stagioneId);
      if (!delegante) {
        res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
        return;
      }
      try {
        const variazione = await eseguiInTransazione(pool, async (client) => {
          const v = await creaVariazione(client, parsed.data, req.persona!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'crea_variazione_ordinaria',
            entitaTipo: 'variazioni_ordinarie',
            entitaId: v.id,
            dettaglio: v as unknown as Record<string, unknown>,
          });
          return v;
        });
        res.status(201).json(variazione);
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/pubblico/variazioni/:id/accetta',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaAccettaVariazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        // Lookup pre-flight DENTRO il try (I2 final review): fuori, un UUID malformato nel
        // path scappava come 22P02 non gestito → 500 invece di 400.
        const variazione = await trovaVariazionePerId(pool, id);
        if (!variazione) {
          res.status(404).json({ errore: 'variazione non trovata' });
          return;
        }
        const stagione = await pool.query<{ stagione_id: string }>(
          `SELECT stagione_id FROM slot_settimana_tipo WHERE id = $1`,
          [variazione.slotId],
        );
        const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, parsed.data.associazioneId, stagione.rows[0]!.stagione_id);
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        const aggiornata = await eseguiInTransazione(pool, async (client) => {
          const v = await accettaVariazione(client, id, parsed.data.associazioneId);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId: parsed.data.associazioneId, ruolo: delegante.ruolo },
            azione: 'accetta_variazione_ordinaria',
            entitaTipo: 'variazioni_ordinarie',
            entitaId: v.id,
            dettaglio: { stato: v.stato, motivazioneRifiuto: v.motivazioneRifiuto },
          });
          return v;
        });
        res.status(200).json(aggiornata);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/pubblico/variazioni/:id/annulla',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const variazione = await trovaVariazionePerId(pool, id);
        if (!variazione) {
          res.status(404).json({ errore: 'variazione non trovata' });
          return;
        }
        if (variazione.richiestaDaPersonaFisicaId !== req.persona!.sub) {
          res.status(403).json({ errore: 'solo il richiedente può annullare la variazione' });
          return;
        }
        // Essere stati il richiedente non basta: l'abilitazione va ancora verificata attiva
        // al momento dell'annullamento (M4 final review — un delegato revocato poteva
        // continuare ad annullare le proprie richieste). Serve anche a ottenere il `ruolo`
        // da registrare nell'audit log (art. B.39), che prima mancava.
        const stagione = await pool.query<{ stagione_id: string }>(
          `SELECT stagione_id FROM slot_settimana_tipo WHERE id = $1`,
          [variazione.slotId],
        );
        const delegante = await trovaAbilitazioneAttiva(
          pool,
          req.persona!.sub,
          variazione.richiestaDaAssociazioneId,
          stagione.rows[0]!.stagione_id,
        );
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        const aggiornata = await eseguiInTransazione(pool, async (client) => {
          const v = await annullaVariazione(client, id);
          await registraOperazione(client, {
            attore: {
              tipo: 'pubblico',
              personaFisicaId: req.persona!.sub,
              associazioneId: variazione.richiestaDaAssociazioneId,
              ruolo: delegante.ruolo,
            },
            azione: 'annulla_variazione_ordinaria',
            entitaTipo: 'variazioni_ordinarie',
            entitaId: v.id,
            dettaglio: { stato: v.stato },
          });
          return v;
        });
        res.status(200).json(aggiornata);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/stagioni/:id/variazioni',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req, res) => {
      const stagioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaFiltriVariazioni.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      const filtri: { tipo?: TipoVariazione; stato?: StatoVariazione } = {};
      if (parsed.data.tipo) filtri.tipo = parsed.data.tipo;
      if (parsed.data.stato) filtri.stato = parsed.data.stato;
      try {
        res.status(200).json(await listaVariazioniPerStagione(pool, stagioneId, filtri));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Rilevazione utilizzo effettivo (art. B.34) ---

  app.post(
    '/backoffice/assegnazioni/:id/utilizzi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const assegnazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaRegistraUtilizzo.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const utilizzo = await eseguiInTransazione(pool, async (client) => {
          const u = await registraUtilizzo(client, { assegnazioneId, ...parsed.data });
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'registra_utilizzo_effettivo',
            entitaTipo: 'utilizzi_effettivi',
            entitaId: u.id,
            dettaglio: u as unknown as Record<string, unknown>,
          });
          return u;
        });
        res.status(201).json(utilizzo);
      } catch (err) {
        // I2 (final review): utilizzi_effettivi_occorrenza_uq — la stessa occorrenza non può
        // essere rilevata due volte (conterebbe due volte verso le soglie B.35).
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/assegnazioni/:id/utilizzi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const assegnazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        res.status(200).json(await listaUtilizziPerAssegnazione(pool, assegnazioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/utilizzi/:id/accogli-giustificazione',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        const aggiornato = await eseguiInTransazione(pool, async (client) => {
          const u = await accogliGiustificazione(client, id, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'accoglie_giustificazione',
            entitaTipo: 'utilizzi_effettivi',
            entitaId: u.id,
            dettaglio: { esito: u.esito },
          });
          return u;
        });
        res.status(200).json(aggiornato);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put(
    '/backoffice/utilizzi/:id/rigetta-giustificazione',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaRigettaGiustificazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const aggiornato = await eseguiInTransazione(pool, async (client) => {
          const u = await rigettaGiustificazione(client, id, req.utente!.sub, parsed.data.motivazione);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'rigetta_giustificazione',
            entitaTipo: 'utilizzi_effettivi',
            entitaId: u.id,
            dettaglio: { motivazione: parsed.data.motivazione },
          });
          return u;
        });
        res.status(200).json(aggiornato);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Coda mancati utilizzi + provvedimenti (art. B.35) ---

  app.get(
    '/backoffice/associazioni/:id/mancati-utilizzi',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const associazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      if (!stagioneId) {
        res.status(400).json({ errore: 'stagioneId è richiesto come query param' });
        return;
      }
      try {
        res.status(200).json(await codaMancatiUtilizzi(pool, associazioneId, stagioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post(
    '/backoffice/assegnazioni/:id/provvedimenti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const assegnazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaCreaProvvedimento.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const provvedimento = await eseguiInTransazione(pool, async (client) => {
          const riga = await client.query<{ associazione_id: string; stato: string }>(
            `SELECT associazione_id, stato FROM assegnazioni WHERE id = $1`,
            [assegnazioneId],
          );
          if ((riga.rowCount ?? 0) === 0) {
            throw new ErroreNonTrovato('assegnazione non trovata');
          }
          const associazioneId = riga.rows[0]!.associazione_id;
          // M3 (final review): la guardia di stato esisteva solo per 'decadenza' (dentro
          // applicaDecadenza, che scrive assegnazioni.stato). Una diffida su un'assegnazione
          // già decaduta/sostituita è un atto senza oggetto — 409, senza scrivere nulla.
          if (!['provvisoria', 'validata'].includes(riga.rows[0]!.stato)) {
            throw new ErroreStatoNonValidoPerTransizione(
              `l'assegnazione non è più in uno stato su cui emettere provvedimenti (stato '${riga.rows[0]!.stato}')`,
            );
          }
          if (parsed.data.tipo === 'decadenza') {
            await applicaDecadenza(client, assegnazioneId, parsed.data.motivazione);
          }
          const p = await creaProvvedimento(client, {
            associazioneId, assegnazioneId, tipo: parsed.data.tipo,
            motivazione: parsed.data.motivazione, emessoDa: req.utente!.sub,
          });
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'emette_provvedimento_mancato_utilizzo',
            entitaTipo: 'provvedimenti_mancato_utilizzo',
            entitaId: p.id,
            dettaglio: p as unknown as Record<string, unknown>,
          });
          return p;
        });
        res.status(201).json(provvedimento);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/backoffice/assegnazioni/:id/provvedimenti',
    richiedeAutenticazione,
    richiedeRuolo('admin', 'operatore'),
    async (req: RequestAutenticata, res) => {
      const assegnazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      try {
        res.status(200).json(await listaProvvedimentiPerAssegnazione(pool, assegnazioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // --- Giustificazione mancato utilizzo (pubblico) + lettura storico (art. B.34-35) ---

  app.post(
    '/pubblico/utilizzi/:id/giustificazione',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      const parsed = schemaPresentaGiustificazione.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ errore: 'richiesta non valida', dettagli: parsed.error.issues });
        return;
      }
      try {
        const utilizzo = await trovaUtilizzoPerId(pool, id);
        if (!utilizzo) {
          res.status(404).json({ errore: 'utilizzo non trovato' });
          return;
        }
        const contesto = await pool.query<{ associazione_id: string; stagione_id: string }>(
          `SELECT a.associazione_id, st.stagione_id
           FROM assegnazioni a JOIN slot_settimana_tipo st ON st.id = a.slot_id
           WHERE a.id = $1`,
          [utilizzo.assegnazioneId],
        );
        const { associazione_id: associazioneId, stagione_id: stagioneId } = contesto.rows[0]!;
        const delegante = await trovaAbilitazioneAttiva(pool, req.persona!.sub, associazioneId, stagioneId);
        if (!delegante) {
          res.status(403).json({ errore: 'nessuna abilitazione attiva propria su questa associazione per questa stagione' });
          return;
        }
        const aggiornato = await eseguiInTransazione(pool, async (client) => {
          const u = await presentaGiustificazione(client, id, parsed.data.testo);
          await registraOperazione(client, {
            attore: { tipo: 'pubblico', personaFisicaId: req.persona!.sub, associazioneId, ruolo: delegante.ruolo },
            azione: 'presenta_giustificazione_mancato_utilizzo',
            entitaTipo: 'utilizzi_effettivi',
            entitaId: u.id,
            dettaglio: { giustificazioneTesto: u.giustificazioneTesto },
          });
          return u;
        });
        res.status(200).json(aggiornato);
      } catch (err) {
        if (err instanceof ErroreNonTrovato) {
          res.status(404).json({ errore: err.message });
          return;
        }
        if (err instanceof ErroreStatoNonValidoPerTransizione) {
          res.status(409).json({ errore: err.message });
          return;
        }
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get(
    '/pubblico/associazioni/:id/utilizzi',
    richiedeAutenticazionePubblico,
    async (req: RequestAutenticataPubblico, res) => {
      const associazioneId = typeof req.params.id === 'string' ? req.params.id : '';
      const stagioneId = typeof req.query.stagioneId === 'string' ? req.query.stagioneId : undefined;
      try {
        const abilitazione = stagioneId
          ? await pool.query(
              `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stagione_id = $3 AND stato = 'approvata' LIMIT 1`,
              [req.persona!.sub, associazioneId, stagioneId],
            )
          : await pool.query(
              `SELECT 1 FROM abilitazioni WHERE persona_fisica_id = $1 AND associazione_id = $2 AND stato = 'approvata' LIMIT 1`,
              [req.persona!.sub, associazioneId],
            );
        if ((abilitazione.rowCount ?? 0) === 0) {
          res.status(403).json({ errore: 'nessuna abilitazione propria su questa associazione' });
          return;
        }
        res.status(200).json(await listaUtilizziPerAssociazione(pool, associazioneId, stagioneId));
      } catch (err) {
        const erroreRiferimento = comeErroreRiferimentoNonValido(err);
        if (erroreRiferimento) {
          res.status(400).json({ errore: erroreRiferimento.message });
          return;
        }
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  return app;
}
