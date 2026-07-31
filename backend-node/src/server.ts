import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { listaStagioni, creaStagione } from './stagioni.ts';
import { eseguiLogin, eseguiLogout, eseguiRefresh } from './auth/login.ts';
import { eseguiCallbackOidc, eseguiLogoutPubblico, eseguiRefreshPubblico } from './auth/loginPubblico.ts';
import { ErroreCredenzialiNonValide, ErroreRefreshTokenNonValido, ErroreUtenteDisattivato } from './auth/errori.ts';
import {
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
import { registraOperazione } from './repository/logOperazioni.ts';
import { creaUtenteInvitato, listaUtenti, trovaUtentePerId, aPubblico } from './repository/utentiBackoffice.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato, comeErroreRiferimentoNonValido } from './erroriDominio.ts';
import { creaDisciplina, listaDiscipline, aggiornaDisciplina } from './discipline.ts';
import { creaIstituzione, listaIstituzioni, trovaIstituzionePerId, aggiornaIstituzione } from './istituzioni.ts';
import { creaImpianto, listaImpianti, trovaImpiantoPerId, aggiornaImpianto } from './impianti.ts';
import { creaSpazio, listaSpaziPerImpianto, trovaSpazioPerId, aggiornaSpazio } from './spazi.ts';
import { creaSlot, listaSlotPerStagione, trovaSlotPerId, aggiornaSlot, ErroreSovrapposizioneSlot } from './slot.ts';
import { schemaCreaDisciplina, schemaAggiornaDisciplina, schemaCreaIstituzione, schemaAggiornaIstituzione, schemaCreaImpianto, schemaAggiornaImpianto, schemaQueryListaImpianti, schemaCreaSpazio, schemaAggiornaSpazio, schemaCreaSlot, schemaAggiornaSlot, schemaQueryListaSlot, schemaCreaStagione, schemaRespingiDelega, schemaImpostazioniOidc, schemaCreaUtenteBackoffice } from './backofficeSchema.ts';
import { creaAssociazione, trovaAssociazionePerId, creaDocumentoAssociazione } from './associazioni.ts';
import { schemaCreaAssociazione, schemaCaricaDocumento, schemaCreaDelega } from './pubblicoSchema.ts';
import { uploadDocumento } from './documenti/storage.ts';
import { MulterError } from 'multer';
import { readFile, unlink } from 'node:fs/promises';
import {
  creaAbilitazionePrincipale,
  trovaAbilitazioneAttiva,
  creaSubDelega,
  approvaAbilitazione,
  respingiAbilitazione,
  revocaAbilitazioneConCascata,
} from './abilitazioni.ts';
import { trovaPersonaFisicaPerCf, creaPersonaFisicaShell } from './repository/personeFisiche.ts';

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

// Dipendenze iniettabili nei test (email finta, base URL fisso); i default arrivano
// dall'ambiente (SMTP_* per il trasporto di bootstrap, BACKOFFICE_BASE_URL per i link).
export interface DipendenzeApp {
  inviaEmail?: (email: Email) => Promise<void>;
  backofficeBaseUrl?: string;
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

  const app = express();
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
      try {
        const associazione = await eseguiInTransazione(pool, async (client) => {
          const a = await creaAssociazione(client, parsed.data);
          await creaAbilitazionePrincipale(client, {
            personaFisicaId: req.persona!.sub,
            associazioneId: a.id,
            stagioneId: parsed.data.stagioneId,
          });
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
        const utente = await eseguiInTransazione(pool, async (client) => {
          const { utente: u, token } = await creaUtenteInvitato(client, parsed.data, req.utente!.sub);
          await registraOperazione(client, {
            attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
            azione: 'crea_utente_backoffice',
            entitaTipo: 'utenti_backoffice',
            entitaId: u.id,
            dettaglio: { email: u.email, nome: u.nome, cognome: u.cognome, ruolo: u.ruolo },
          });
          await inviaEmailFn({
            a: u.email,
            oggetto: 'POLARIS — invito account backoffice',
            testo: [
              `Buongiorno ${u.nome} ${u.cognome},`,
              '',
              'è stato creato per lei un account sul backoffice POLARIS. Per attivarlo e impostare la password apra questo link:',
              '',
              `${backofficeBaseUrl}/utenti/accetta-invito?token=${token}`,
              '',
              'Il link scade tra 24 ore.',
            ].join('\n'),
          });
          return u;
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

  return app;
}
