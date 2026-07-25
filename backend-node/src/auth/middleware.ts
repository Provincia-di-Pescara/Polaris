import type { NextFunction, Request, Response } from 'express';
import { verificaAccessToken, type PayloadAccessToken } from './jwt.ts';

export interface RequestAutenticata extends Request {
  utente?: PayloadAccessToken;
}

export function richiedeAutenticazione(req: RequestAutenticata, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ errore: 'token mancante' });
    return;
  }

  const token = header.slice('Bearer '.length);
  try {
    req.utente = verificaAccessToken(token);
    next();
  } catch {
    res.status(401).json({ errore: 'token non valido o scaduto' });
  }
}
