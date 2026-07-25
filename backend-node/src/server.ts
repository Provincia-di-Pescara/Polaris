import express, { type Express, type Request } from 'express';
import rateLimit from 'express-rate-limit';
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

function ipRichiesta(req: Request): string | null {
  return req.ip ?? null;
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
      const url = await costruisciUrlAutorizzazione(pool);
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
