import express, { type Express, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { listaStagioni } from './stagioni.ts';
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
import { richiedeRuolo } from './auth/middleware.ts';
import { registraOperazione } from './repository/logOperazioni.ts';
import { ErroreValoreDuplicato, ErroreNonTrovato } from './erroriDominio.ts';
import { creaDisciplina, listaDiscipline, aggiornaDisciplina } from './discipline.ts';
import { creaIstituzione, listaIstituzioni, trovaIstituzionePerId, aggiornaIstituzione } from './istituzioni.ts';
import { schemaCreaDisciplina, schemaAggiornaDisciplina, schemaCreaIstituzione, schemaAggiornaIstituzione } from './backofficeSchema.ts';

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
        const disciplina = await creaDisciplina(pool, parsed.data);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_disciplina_sportiva',
          entitaTipo: 'discipline_sportive',
          dettaglio: disciplina as unknown as Record<string, unknown>,
        });
        res.status(201).json(disciplina);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
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
        const disciplina = await aggiornaDisciplina(pool, codice, parsed.data.denominazione);
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'aggiorna_disciplina_sportiva',
          entitaTipo: 'discipline_sportive',
          dettaglio: disciplina as unknown as Record<string, unknown>,
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
        const istituzione = await creaIstituzione(pool, parsed.data as { denominazione: string; codiceMeccanografico?: string; indirizzo?: string });
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'crea_istituzione_scolastica',
          entitaTipo: 'istituzioni_scolastiche',
          entitaId: istituzione.id,
          dettaglio: istituzione as unknown as Record<string, unknown>,
        });
        res.status(201).json(istituzione);
      } catch (err) {
        if (err instanceof ErroreValoreDuplicato) {
          res.status(409).json({ errore: err.message });
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
        const istituzione = await aggiornaIstituzione(pool, id, parsed.data as { denominazione: string; codiceMeccanografico?: string; indirizzo?: string });
        await registraOperazione(pool, {
          attore: { tipo: 'backoffice', utenteBackofficeId: req.utente!.sub, ruolo: req.utente!.ruolo },
          azione: 'aggiorna_istituzione_scolastica',
          entitaTipo: 'istituzioni_scolastiche',
          entitaId: istituzione.id,
          dettaglio: istituzione as unknown as Record<string, unknown>,
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
        res.status(500).json({ errore: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  return app;
}
