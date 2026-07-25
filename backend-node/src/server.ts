import express, { type Express, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { listaStagioni } from './stagioni.ts';
import { eseguiLogin, eseguiLogout, eseguiRefresh } from './auth/login.ts';
import { eseguiCallbackOidc, eseguiLogoutPubblico, eseguiRefreshPubblico } from './auth/loginPubblico.ts';
import { ErroreCredenzialiNonValide, ErroreRefreshTokenNonValido, ErroreUtenteDisattivato } from './auth/errori.ts';
import { schemaLoginRequest, schemaOidcCallback, schemaRefreshRequest } from './auth/schema.ts';
import {
  richiedeAutenticazione,
  richiedeAutenticazionePubblico,
  type RequestAutenticata,
  type RequestAutenticataPubblico,
} from './auth/middleware.ts';
import { costruisciUrlAutorizzazione, ErroreOidcNonConfigurato, ErroreScambioCode, ErroreStatoNonValido } from './oidc/flow.ts';

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

export function creaApp(pool: Pool): Express {
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

  return app;
}
