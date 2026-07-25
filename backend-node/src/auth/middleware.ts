import type { NextFunction, Request, Response } from 'express';
import { verificaAccessToken, type PayloadAccessToken } from './jwt.ts';
import { verificaAccessTokenPubblico, type PayloadAccessTokenPubblico } from './jwtPubblico.ts';

export interface RequestAutenticata extends Request {
  utente?: PayloadAccessToken;
}

export interface RequestAutenticataPubblico extends Request {
  persona?: PayloadAccessTokenPubblico;
}

function estraiBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length);
}

export function richiedeAutenticazione(req: RequestAutenticata, res: Response, next: NextFunction): void {
  const token = estraiBearer(req);
  if (!token) {
    res.status(401).json({ errore: 'token mancante' });
    return;
  }
  try {
    req.utente = verificaAccessToken(token);
    next();
  } catch {
    res.status(401).json({ errore: 'token non valido o scaduto' });
  }
}

export function richiedeAutenticazionePubblico(req: RequestAutenticataPubblico, res: Response, next: NextFunction): void {
  const token = estraiBearer(req);
  if (!token) {
    res.status(401).json({ errore: 'token mancante' });
    return;
  }
  try {
    req.persona = verificaAccessTokenPubblico(token);
    next();
  } catch {
    res.status(401).json({ errore: 'token non valido o scaduto' });
  }
}
