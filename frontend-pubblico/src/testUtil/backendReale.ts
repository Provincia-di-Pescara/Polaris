import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend-pubblico/src/testUtil/ -> ../../../backend-node (radice del monorepo, poi dentro backend-node)
const BACKEND_DIR = path.resolve(__dirname, '../../../backend-node');

export interface BackendReale {
  baseUrl: string;
  chiudi: () => Promise<void>;
}

export async function avviaBackendReale(): Promise<BackendReale> {
  const dsn = process.env.TEST_DATABASE_URL;
  if (!dsn) {
    throw new Error('TEST_DATABASE_URL non impostata');
  }
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const baseUrl = `http://127.0.0.1:${porta}`;

  const child: ChildProcess = spawn('node', ['src/index.ts'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: dsn,
      PORT: String(porta),
      JWT_SECRET: process.env.JWT_SECRET ?? 'segreto-di-test-non-usare-in-produzione',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrAccumulato = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrAccumulato += chunk.toString('utf8');
  });

  await new Promise<void>((resolve, reject) => {
    // Ferma definitivamente il polling non appena la promise si risolve in un modo
    // o nell'altro — senza, un successo tardivo dopo un timeout/reject continuava
    // a schedulare setTimeout all'infinito (nessuno li cancellava più).
    let fermo = false;

    const timeoutId = setTimeout(() => {
      if (fermo) return;
      fermo = true;
      child.kill('SIGKILL');
      reject(new Error(`backend reale non avviato entro 15s\n--- stderr ---\n${stderrAccumulato}`));
    }, 15000);

    child.once('error', (err) => {
      if (fermo) return;
      fermo = true;
      clearTimeout(timeoutId);
      reject(err);
    });

    // Intercetta un'uscita anticipata (es. crash all'avvio per un errore di
    // configurazione) — l'evento 'error' sopra copre solo il fallimento dello
    // spawn stesso, non un processo che parte e poi muore con exit code != 0.
    child.once('exit', (code) => {
      if (fermo) return;
      fermo = true;
      clearTimeout(timeoutId);
      reject(new Error(`backend reale uscito precocemente (code ${code})\n--- stderr ---\n${stderrAccumulato}`));
    });

    const provaConnessione = async (): Promise<void> => {
      if (fermo) return;
      try {
        const r = await fetch(`${baseUrl}/healthz`);
        if (r.ok) {
          fermo = true;
          clearTimeout(timeoutId);
          resolve();
          return;
        }
      } catch {
        // backend non ancora in ascolto, riprova
      }
      if (!fermo) {
        setTimeout(() => {
          provaConnessione();
        }, 200);
      }
    };
    provaConnessione();
  });

  return {
    baseUrl,
    chiudi: () =>
      new Promise<void>((resolve) => {
        const forzaChiusura = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(forzaChiusura);
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
}
