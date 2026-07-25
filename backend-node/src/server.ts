import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { listaStagioni } from './stagioni.ts';

export function creaApp(pool: Pool): Express {
  const app = express();

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

  return app;
}
